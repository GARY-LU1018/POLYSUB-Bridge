import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolResult = CallToolResult;

export type CodexUpstream = {
  listTools(): Promise<unknown>;
  callTool(name: string, args: Record<string, unknown>, communicationTimeoutMs: number): Promise<ToolResult>;
  close(): Promise<void>;
};

type RpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
};

type PendingRequest = {
  method: string;
  resolve: (message: RpcMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type TurnContext = {
  cwd: string;
  sandbox: "read-only" | "workspace-write";
};

type TurnWaiter = {
  text: string;
  sawDelta: boolean;
  resolve: (value: { turnId: string; status: string; text: string }) => void;
  reject: (error: Error) => void;
};

export class CodexAppServerUpstream implements CodexUpstream {
  private child?: ChildProcessWithoutNullStreams;
  private connecting?: Promise<void>;
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly threads = new Map<string, TurnContext>();
  private readonly turns = new Map<string, TurnWaiter>();

  constructor(
    private readonly codexCommand: string,
    private readonly allowedRoot: string
  ) {}

  async listTools(): Promise<unknown> {
    return {
      executor: "codex app-server",
      protocol: "JSON-RPC over newline-delimited stdio",
      methods: ["initialize", "thread/start", "turn/start", "turn/interrupt"],
      publicBridgeTools: [
        "bridge_status",
        "codex_read",
        "codex_run",
        "codex_reply",
        "codex_job_status",
        "codex_completion_next",
        "codex_completion_ack"
      ]
    };
  }

  async callTool(name: string, args: Record<string, unknown>, communicationTimeoutMs: number): Promise<ToolResult> {
    if (name === "codex") {
      const prompt = stringArg(args, "prompt");
      const cwd = stringArg(args, "cwd");
      const sandbox = sandboxArg(args.sandbox);
      const approvalPolicy = approvalArg(args["approval-policy"]);
      await this.ensureConnected(communicationTimeoutMs);
      const thread = await this.request("thread/start", {
        cwd,
        approvalPolicy,
        sandbox,
        ephemeral: true
      }, communicationTimeoutMs);
      const threadId = stringPath(thread.result, ["thread", "id"]);
      if (!threadId) {
        throw new Error("App Server thread/start returned no thread id.");
      }
      this.threads.set(threadId, { cwd, sandbox });
      return this.runTurn(threadId, prompt, cwd, sandbox, approvalPolicy, communicationTimeoutMs);
    }

    if (name === "codex-reply") {
      const threadId = stringArg(args, "threadId");
      const prompt = stringArg(args, "prompt");
      const context = this.threads.get(threadId);
      if (!context) {
        throw new Error("App Server thread is not tracked by this bridge process.");
      }
      await this.ensureConnected(communicationTimeoutMs);
      return this.runTurn(threadId, prompt, context.cwd, context.sandbox, "never", communicationTimeoutMs);
    }

    throw new Error("Unsupported upstream tool: " + name);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("App Server upstream closed."));
      this.pending.delete(id);
    }
    for (const [threadId, waiter] of this.turns) {
      waiter.reject(new Error("App Server upstream closed."));
      this.turns.delete(threadId);
    }
    const child = this.child;
    this.child = undefined;
    this.connecting = undefined;
    if (child && !child.killed) {
      child.kill();
    }
  }

  private async runTurn(
    threadId: string,
    prompt: string,
    cwd: string,
    sandbox: "read-only" | "workspace-write",
    approvalPolicy: "untrusted" | "on-request" | "never",
    communicationTimeoutMs: number
  ): Promise<ToolResult> {
    if (this.turns.has(threadId)) {
      throw new Error("An App Server turn is already active for this thread.");
    }

    // `turn/start` is a control-plane request. The turn completion below is
    // work execution and must not inherit this request timeout.
    const waiter = this.waitForTurn(threadId);
    let response: RpcMessage;
    try {
      response = await this.request("turn/start", {
        threadId,
        cwd,
        approvalPolicy,
        sandboxPolicy: {
          type: sandbox === "read-only" ? "readOnly" : "workspaceWrite"
        },
        input: [{ type: "text", text: prompt }]
      }, communicationTimeoutMs);
    } catch (error) {
      this.cancelTurn(threadId, error instanceof Error ? error : new Error(String(error)), true);
      throw error;
    }

    const turnId = stringPath(response.result, ["turn", "id"]);
    if (!turnId) {
      this.cancelTurn(threadId, new Error("App Server turn/start returned no turn id."));
      throw new Error("App Server turn/start returned no turn id.");
    }

    const completed = await waiter;
    return {
      content: [{ type: "text", text: completed.text }],
      structuredContent: {
        threadId,
        turnId,
        status: completed.status,
        output: completed.text
      }
    };
  }

  private waitForTurn(threadId: string): Promise<{ turnId: string; status: string; text: string }> {
    return new Promise((resolve, reject) => {
      this.turns.set(threadId, {
        text: "",
        sawDelta: false,
        resolve,
        reject
      });
    });
  }

  private cancelTurn(threadId: string, error: Error, interrupt = false): void {
    const waiter = this.turns.get(threadId);
    if (!waiter) {
      return;
    }
    this.turns.delete(threadId);
    waiter.reject(error);
    if (interrupt) {
      // A failed/ambiguous turn/start is a communication failure, not a
      // normal long-running turn. Best-effort interruption prevents an
      // orphaned App Server turn without applying a wall-clock limit to work.
      void this.request("turn/interrupt", { threadId }, 5000).catch(() => undefined);
    }
  }

  private async ensureConnected(communicationTimeoutMs: number): Promise<void> {
    if (this.closed) {
      throw new Error("App Server upstream is closed.");
    }
    if (this.child) {
      return;
    }
    if (!this.connecting) {
      this.connecting = this.connect(communicationTimeoutMs).finally(() => {
        this.connecting = undefined;
      });
    }
    await this.connecting;
  }

  private async connect(communicationTimeoutMs: number): Promise<void> {
    const child = spawn(this.codexCommand, ["app-server"], {
      cwd: this.allowedRoot,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });
    this.child = child;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      this.handleMessage(line);
    });
    child.stderr.on("data", () => {
      // App Server diagnostics are intentionally not forwarded to MCP callers.
    });
    child.on("error", (error) => {
      this.failPending(new Error("App Server process error: " + error.message));
    });
    child.on("close", (code, signal) => {
      if (this.child === child) {
        this.child = undefined;
      }
      if (!this.closed) {
        this.failPending(new Error("App Server process exited: " + (code ?? signal ?? 0)));
      }
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codex-gpt-bridge",
        title: "Codex GPT Bridge App Server adapter",
        version: "0.1.0"
      }
    }, communicationTimeoutMs);
    this.send({ method: "initialized" });
  }

  private request(method: string, params: Record<string, unknown>, communicationTimeoutMs: number): Promise<RpcMessage> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("App Server request timed out: " + method));
      }, communicationTimeoutMs);
      this.pending.set(id, {
        method,
        resolve,
        reject,
        timer
      });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.child || this.child.stdin.destroyed) {
      throw new Error("App Server stdin is not available.");
    }
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  private handleMessage(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error("App Server " + pending.method + " failed: " + safeJson(message.error)));
      } else {
        pending.resolve(message);
      }
      return;
    }

    const method = message.method;
    const params = message.params || {};
    const threadId = stringValue(params.threadId);
    if (method === "item/agentMessage/delta" && threadId) {
      const waiter = this.turns.get(threadId);
      if (waiter) {
        waiter.text += stringValue(params.delta) || "";
        waiter.sawDelta = true;
      }
      return;
    }
    if (method === "item/completed" && threadId) {
      const waiter = this.turns.get(threadId);
      const item = params.item;
      if (waiter && !waiter.sawDelta && isRecord(item) && item.type === "agentMessage") {
        waiter.text += stringValue(item.text) || "";
      }
      return;
    }
    if (method === "turn/completed" && threadId) {
      const waiter = this.turns.get(threadId);
      if (!waiter) {
        return;
      }
      this.turns.delete(threadId);
      const turn = isRecord(params.turn) ? params.turn : {};
      const status = stringValue(turn.status) || stringValue(params.status) || "completed";
      const turnId = stringValue(turn.id) || stringValue(params.turnId) || "";
      if (status !== "completed") {
        waiter.reject(new Error("App Server turn ended with status: " + status));
        return;
      }
      waiter.resolve({ turnId, status, text: waiter.text });
      return;
    }
    if (message.id !== undefined) {
      try {
        this.send({ id: message.id, error: { code: -32601, message: "Server requests are disabled by bridge policy." } });
      } catch {
        // The process failure will reject the active requests.
      }
    }
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    for (const [threadId, waiter] of this.turns) {
      waiter.reject(error);
      this.turns.delete(threadId);
    }
  }
}

export { CodexAppServerUpstream as CodexStdioUpstream };

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = stringValue(args[name]);
  if (!value) {
    throw new Error("Missing upstream argument: " + name);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sandboxArg(value: unknown): "read-only" | "workspace-write" {
  if (value === "read-only" || value === "workspace-write") {
    return value;
  }
  throw new Error("Unsupported App Server sandbox policy.");
}

function approvalArg(value: unknown): "untrusted" | "on-request" | "never" {
  if (value === "untrusted" || value === "on-request" || value === "never") {
    return value;
  }
  throw new Error("Unsupported App Server approval policy.");
}

function stringPath(value: Record<string, unknown> | undefined, path: string[]): string | undefined {
  let current: unknown = value;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return stringValue(current);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return "unserializable error";
  }
}
