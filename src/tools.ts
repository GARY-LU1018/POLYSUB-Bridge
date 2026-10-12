import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig, SandboxMode } from "./config.js";
import { CODEX_COMMUNICATION_TIMEOUT_MS, enforceSandbox, findSensitiveFiles, resolveAllowedCwd } from "./config.js";
import type { CodexUpstream, ToolResult } from "./upstream.js";
import { extractThreadId, SessionRegistry } from "./sessionRegistry.js";
import { BLUE_WAKE_RESOURCE_URI } from "./blueWake.js";
import { DurableCompletionOutbox, readSessionCorrelation, type DurableCompletion } from "./completionOutbox.js";

type CodexJobStatus = "running" | "completed" | "failed" | "timed_out";

export type CodexJob = {
  taskId: string;
  operation: "codex_read" | "codex_run" | "codex_reply";
  createdAt: number;
  updatedAt: number;
  cwd?: string;
  sandbox?: SandboxMode;
  status: CodexJobStatus;
  sessionCorrelation?: string;
  result?: ToolResult;
  error?: string;
  promise: Promise<void>;
};

type CodexJobCompletedHandler = (job: Readonly<CodexJob>) => void;

export class CodexJobRegistry {
  private readonly jobs = new Map<string, CodexJob>();

  constructor(private readonly onCompleted?: CodexJobCompletedHandler) {}

  get size(): number {
    return this.jobs.size;
  }

  get(taskId: string): CodexJob | undefined {
    return this.jobs.get(taskId);
  }

  start(
    input: Omit<CodexJob, "createdAt" | "updatedAt" | "status" | "promise" | "result" | "error">,
    run: () => Promise<ToolResult>,
    onComplete?: (result: ToolResult) => void
  ): CodexJob {
    if (this.jobs.has(input.taskId)) {
      throw new Error(`Task ID is already active: ${input.taskId}`);
    }
    const now = Date.now();
    const job: CodexJob = {
      ...input,
      createdAt: now,
      updatedAt: now,
      status: "running",
      promise: Promise.resolve()
    };
    job.promise = Promise.resolve()
      .then(run)
      .then((result) => {
        job.status = "completed";
        job.result = result;
        job.updatedAt = Date.now();
        onComplete?.(result);
        try {
          this.onCompleted?.(job);
        } catch (error) {
          console.error("Codex completion event failed:", error);
        }
      })
      .catch((error: unknown) => {
        job.status = isTimeoutError(error) ? "timed_out" : "failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.updatedAt = Date.now();
      });
    this.jobs.set(job.taskId, job);
    this.prune();
    return job;
  }

  private prune(): void {
    if (this.jobs.size <= 1000) {
      return;
    }
    const sorted = [...this.jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const job of sorted.slice(0, this.jobs.size - 1000)) {
      this.jobs.delete(job.taskId);
    }
  }
}

export function registerBridgeTools(
  server: McpServer,
  config: BridgeConfig,
  upstream: CodexUpstream,
  sessions: SessionRegistry,
  jobs: CodexJobRegistry,
  completionOutbox = new DurableCompletionOutbox(null)
): void {
  server.registerTool(
    "bridge_status",
    {
      title: "Bridge Status",
      description:
        "Read-only status check. Returns bridge safety policy, allowed local roots, tracked session count, and the current Codex App Server adapter. Does not start Codex and does not read project files.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const tools = await upstream.listTools();
      return textResult({
        bridge: "codex-gpt-bridge",
        auth: config.token && !config.noAuth ? "bearer-token" : "none",
        allowedRoots: config.allowedRoots,
        defaultSandbox: config.defaultSandbox,
        allowWorkspaceWrite: config.allowWorkspaceWrite,
        allowDangerFullAccess: config.allowDangerFullAccess,
        defaultCwd: config.allowedRoots.length === 1 ? config.allowedRoots[0] : null,
        defaultApprovalPolicy: config.defaultApprovalPolicy,
        fastReturnMs: config.fastReturnMs,
        trackedSessions: sessions.size(),
        trackedJobs: jobs.size,
        upstreamTools: tools
      });
    }
  );

  server.registerTool(
    "codex_read",
    {
      title: "Read Project With Codex",
      description:
        "Run a read-only local Codex inspection in an allowed working directory. The caller must provide the canonical taskId for this work. The bridge forces Codex read-only and does not permit file modifications. App Server communication has a fixed control-plane timeout; an active Codex turn is allowed to run until completion, error, or explicit cancellation. If Codex does not finish before the bridge fast-return deadline, this tool returns the same taskId and automatically mounts the completion receiver when Blue-Wake is enabled.",
      ...blueWakeAutoMountMeta(config),
      inputSchema: {
        taskId: taskIdSchema(),
        prompt: z.string().min(1).describe("Read-only inspection or analysis prompt for Codex."),
        cwd: z
          .string()
          .min(1)
          .optional()
          .describe("Absolute working directory inside the configured allowed roots. Defaults to the only allowed root.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args, extra) => {
      const cwd = resolveAllowedCwd(args.cwd, config.allowedRoots);
      enforceSensitiveFilePreflight(config, cwd, "run Codex");
      const sandbox: SandboxMode = "read-only";
      const payload: Record<string, unknown> = {
        prompt: args.prompt,
        cwd,
        sandbox,
        "approval-policy": config.defaultApprovalPolicy
      };
      return runCodexWithFastReturn({
        jobs,
        config,
        taskId: args.taskId,
        operation: "codex_read",
        cwd,
        sandbox,
        sessionCorrelation: readSessionCorrelation(extra._meta),
        run: () => upstream.callTool("codex", payload, CODEX_COMMUNICATION_TIMEOUT_MS),
        onComplete: (result) => {
          const threadId = extractThreadId(result);
          if (threadId) {
            sessions.record({
              threadId,
              cwd,
              sandbox,
              createdAt: Date.now()
            });
          }
        }
      });
    }
  );

  server.registerTool(
    "codex_run",
    {
      title: "Run Codex",
      description:
        "Start a local Codex session in an allowed working directory using the bridge sandbox policy. The caller must provide the canonical taskId for this work. Prefer codex_read for read-only project inspections. App Server communication has a fixed control-plane timeout; an active Codex turn is allowed to run until completion, error, or explicit cancellation. If Codex does not finish before the bridge fast-return deadline, this tool returns the same taskId and automatically mounts the completion receiver when Blue-Wake is enabled.",
      ...blueWakeAutoMountMeta(config),
      inputSchema: {
        taskId: taskIdSchema(),
        prompt: z.string().min(1).describe("Task prompt for Codex."),
        cwd: z
          .string()
          .min(1)
          .optional()
          .describe("Absolute working directory inside the configured allowed roots. Defaults to the only allowed root."),
        sandbox: sandboxSchema(config).optional().describe("Codex sandbox mode. Defaults to bridge policy.")
      },
      annotations: codexToolAnnotations(config)
    },
    async (args, extra) => {
      const cwd = resolveAllowedCwd(args.cwd, config.allowedRoots);
      enforceSensitiveFilePreflight(config, cwd, "run Codex");
      const sandbox = enforceSandbox(config, args.sandbox as SandboxMode | undefined);
      rejectDangerSandbox(sandbox);
      const payload: Record<string, unknown> = {
        prompt: args.prompt,
        cwd,
        sandbox,
        "approval-policy": config.defaultApprovalPolicy
      };
      return runCodexWithFastReturn({
        jobs,
        config,
        taskId: args.taskId,
        operation: "codex_run",
        cwd,
        sandbox,
        sessionCorrelation: readSessionCorrelation(extra._meta),
        run: () => upstream.callTool("codex", payload, CODEX_COMMUNICATION_TIMEOUT_MS),
        onComplete: (result) => {
          const threadId = extractThreadId(result);
          if (threadId) {
            sessions.record({
              threadId,
              cwd,
              sandbox,
              createdAt: Date.now()
            });
          }
        }
      });
    }
  );

  server.registerTool(
    "codex_reply",
    {
      title: "Reply To Codex",
      description:
        "Continue a Codex session that was first created through this bridge. The caller must provide the canonical taskId for this work. App Server communication has a fixed control-plane timeout; an active Codex turn is allowed to run until completion, error, or explicit cancellation. If Codex does not finish before the bridge fast-return deadline, this tool returns the same taskId and automatically mounts the completion receiver when Blue-Wake is enabled.",
      ...blueWakeAutoMountMeta(config),
      inputSchema: {
        taskId: taskIdSchema(),
        threadId: z.string().min(1).describe("Thread id returned by codex_read or codex_run."),
        prompt: z.string().min(1).describe("Follow-up prompt for the same Codex session.")
      },
      annotations: codexToolAnnotations(config)
    },
    async (args, extra) => {
      const session = sessions.get(args.threadId);
      if (!session) {
        throw new Error("Unknown Codex thread id. Start the session through codex_read or codex_run on this bridge first.");
      }
      enforceSensitiveFilePreflight(config, session.cwd, "continue Codex");
      return runCodexWithFastReturn({
        jobs,
        config,
        taskId: args.taskId,
        operation: "codex_reply",
        cwd: session.cwd,
        sandbox: session.sandbox,
        sessionCorrelation: readSessionCorrelation(extra._meta),
        run: () =>
          upstream.callTool(
            "codex-reply",
            {
              threadId: args.threadId,
              prompt: args.prompt
            },
            CODEX_COMMUNICATION_TIMEOUT_MS
          )
      });
    }
  );

  server.registerTool(
    "codex_job_status",
    {
      title: "Codex Job Status",
      description:
        "Check a long-running codex_read, codex_run, or codex_reply work item by its caller-provided taskId. Poll this tool until status is completed, failed, or timed_out.",
      inputSchema: {
        taskId: taskIdSchema().describe("Canonical taskId returned by codex_read, codex_run, or codex_reply.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const job = jobs.get(args.taskId);
      if (!job) {
        const persisted = completionOutbox.getByTaskId(args.taskId);
        if (!persisted) {
          throw new Error("Unknown taskId. Start a long-running job through codex_read, codex_run, or codex_reply first.");
        }
        return textResult({
          status: "completed",
          taskId: persisted.taskId,
          operation: persisted.operation,
          result: persisted.result,
          completion: completionView(persisted)
        });
      }
      if (job.status === "running") {
        return textResult({
          status: "running",
          taskId: job.taskId,
          operation: job.operation,
          createdAt: new Date(job.createdAt).toISOString(),
          ageMs: Date.now() - job.createdAt,
          message: "Codex is still running. Call codex_job_status again with this taskId."
        });
      }
      if (job.status === "failed") {
        return textResult({
          status: "failed",
          taskId: job.taskId,
          operation: job.operation,
          error: job.error || "Codex job failed."
        });
      }
      if (job.status === "timed_out") {
        return textResult({
          status: "timed_out",
          taskId: job.taskId,
          operation: job.operation,
          error: job.error || "Codex job timed out."
        });
      }
      return textResult({
        status: "completed",
        taskId: job.taskId,
        operation: job.operation,
        result: job.result,
        completion: completionOutbox.getByTaskId(job.taskId) ? completionView(completionOutbox.getByTaskId(job.taskId)!) : null
      });
    }
  );

  server.registerTool(
    "codex_completion_next",
    {
      title: "Read durable Codex completion",
      description:
        "Read the next pending Codex completion from the durable outbox. Reading does not consume, acknowledge, or execute the continuation. When the host supplies openai/session metadata, results are scoped to that correlation; otherwise session correlation is UNKNOWN.",
      inputSchema: {
        after: z.number().int().nonnegative().optional().describe("Return only a completion with a higher durable sequence number."),
        taskId: taskIdSchema().describe("Return only the completion for this canonical taskId.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args, extra) => {
      const sessionCorrelation = readSessionCorrelation(extra._meta);
      const completion = completionOutbox.read({
        after: args.after,
        taskId: args.taskId,
        sessionCorrelation
      });
      return textResult({
        completion: completion ? completionView(completion) : null,
        sessionCorrelation: sessionCorrelation || null,
        sessionCorrelationStatus: sessionCorrelation ? "available" : "UNKNOWN"
      });
    }
  );

  server.registerTool(
    "codex_completion_ack",
    {
      title: "Acknowledge Codex completion",
      description:
        "Mark a pending Codex completion handled after ChatGPT has safely processed its result. This is the only operation that removes it from future durable reads.",
      inputSchema: {
        taskId: taskIdSchema().describe("Canonical taskId from the durable completion payload.")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const completion = completionOutbox.acknowledge(args.taskId);
      if (!completion) {
        throw new Error("Completion acknowledgement rejected: no completion exists for this taskId.");
      }
      return textResult({ acknowledged: true, completion: completionView(completion) });
    }
  );
}

async function runCodexWithFastReturn(input: {
  jobs: CodexJobRegistry;
  config: BridgeConfig;
  taskId: string;
  operation: "codex_read" | "codex_run" | "codex_reply";
  cwd: string;
  sandbox: SandboxMode;
  sessionCorrelation?: string;
  run: () => Promise<ToolResult>;
  onComplete?: (result: ToolResult) => void;
}): Promise<ToolResult> {
  const job = input.jobs.start(
    {
      taskId: input.taskId,
      operation: input.operation,
      cwd: input.cwd,
      sandbox: input.sandbox,
      sessionCorrelation: input.sessionCorrelation
    },
    input.run,
    input.onComplete
  );
  const fastReturnMs = Math.min(input.config.fastReturnMs, CODEX_COMMUNICATION_TIMEOUT_MS);
  const state = await Promise.race([job.promise.then(() => "settled" as const), delay(fastReturnMs).then(() => "running" as const)]);
  if (state === "running") {
    return structuredTextResult({
      status: "running",
      taskId: job.taskId,
      operation: job.operation,
      message: "Codex is still running. The callback receiver is attached when Blue-Wake is enabled; use codex_job_status with this taskId as the deterministic result continuation."
    });
  }
  if (job.status === "completed" && job.result) {
    const result = job.result;
    return {
      ...result,
      structuredContent: {
        ...(isRecord(result.structuredContent) ? result.structuredContent : {}),
        status: "completed",
        taskId: job.taskId,
        operation: job.operation
      }
    };
  }
  throw new Error(job.error || "Codex job failed.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

function sandboxSchema(config: BridgeConfig) {
  return config.allowWorkspaceWrite ? z.enum(["read-only", "workspace-write"]) : z.enum(["read-only"]);
}

function taskIdSchema() {
  return z.string().trim().min(1).max(128).describe("Caller-provided canonical Task ID for this work.");
}

function blueWakeAutoMountMeta(config: BridgeConfig): { _meta?: Record<string, unknown> } {
  if (!config.enableBlueWake) {
    return {};
  }
  return {
    _meta: {
      ui: { resourceUri: BLUE_WAKE_RESOURCE_URI },
      "openai/toolInvocation/invoking": "Preparing automatic Codex completion receiver",
      "openai/toolInvocation/invoked": "Automatic Codex completion receiver attached"
    }
  };
}

function enforceSensitiveFilePreflight(config: BridgeConfig, cwd: string, operation: "run Codex" | "continue Codex"): void {
  if (!config.secretScan) {
    return;
  }
  const sensitiveFiles = findSensitiveFiles(cwd);
  if (sensitiveFiles.length > 0) {
    throw new Error(
      `Refusing to ${operation} because sensitive-looking files were found: ${sensitiveFiles.join(", ")}. Move them outside the allowed root or set CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1 if you accept the risk.`
    );
  }
}

function rejectDangerSandbox(sandbox: SandboxMode): void {
  if (sandbox === "danger-full-access") {
    throw new Error("danger-full-access is not exposed through ChatGPT bridge tools.");
  }
}

function codexToolAnnotations(config: BridgeConfig) {
  const readOnly =
    config.defaultSandbox === "read-only" &&
    !config.allowWorkspaceWrite &&
    !config.allowDangerFullAccess;

  return {
    readOnlyHint: readOnly,
    destructiveHint: config.allowWorkspaceWrite || config.allowDangerFullAccess,
    idempotentHint: false,
    openWorldHint: false
  };
}

function completionView(completion: DurableCompletion): Record<string, unknown> {
  return {
    seq: completion.seq,
    completionId: completion.completionId,
    taskId: completion.taskId,
    operation: completion.operation,
    payload: completion.payload,
    result: completion.result,
    sessionCorrelation: completion.sessionCorrelation || null,
    createdAt: new Date(completion.createdAt).toISOString(),
    acknowledgedAt: completion.acknowledgedAt ? new Date(completion.acknowledgedAt).toISOString() : null,
    continuation: completion.continuation
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function textResult(value: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function structuredTextResult(value: Record<string, unknown>): ToolResult {
  return {
    ...textResult(value),
    structuredContent: value
  };
}
