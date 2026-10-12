import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolResult } from "./upstream.js";

export type CompletionOperation = "codex_read" | "codex_run" | "codex_reply";
export type ContinuationState = "pending" | "acknowledged";

export type CompletionContinuation = {
  tool: "codex_job_status";
  arguments: { taskId: string };
  state: ContinuationState;
};

export type DurableCompletion = {
  seq: number;
  completionId: string;
  taskId: string;
  operation: CompletionOperation;
  payload: string;
  result: ToolResult;
  sessionCorrelation?: string;
  createdAt: number;
  acknowledgedAt?: number;
  continuation: CompletionContinuation;
};

type OutboxState = {
  version: 1;
  nextSeq: number;
  records: DurableCompletion[];
};

export function defaultCompletionOutboxPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEX_GPT_BRIDGE_STATE_DIR?.trim();
  const stateDir = configured || path.join(env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "bridge-state");
  return path.join(stateDir, "completion-outbox.json");
}

/**
 * Small, single-Bridge-process durable store. Passing null creates an in-memory
 * store for tests; the default path is persistent machine-local Bridge state.
 */
export class DurableCompletionOutbox {
  private state: OutboxState;
  private readonly filePath: string | null;

  constructor(filePath: string | null = defaultCompletionOutboxPath()) {
    this.filePath = filePath;
    this.state = filePath ? loadState(filePath) : { version: 1, nextSeq: 1, records: [] };
  }

  get path(): string | null {
    return this.filePath;
  }

  get size(): number {
    return this.state.records.length;
  }

  persist(input: {
    taskId: string;
    operation: CompletionOperation;
    payload: string;
    result: ToolResult;
    sessionCorrelation?: string;
    now?: number;
  }): DurableCompletion {
    const existing = this.state.records.find((candidate) => candidate.taskId === input.taskId);
    if (existing) {
      return cloneRecord(existing);
    }

    const now = input.now ?? Date.now();
    const record: DurableCompletion = {
      seq: this.state.nextSeq++,
      completionId: randomUUID(),
      taskId: input.taskId,
      operation: input.operation,
      payload: input.payload,
      result: input.result,
      ...(input.sessionCorrelation ? { sessionCorrelation: input.sessionCorrelation } : {}),
      createdAt: now,
      continuation: {
        tool: "codex_job_status",
        arguments: { taskId: input.taskId },
        state: "pending"
      }
    };
    this.state.records.push(record);
    this.pruneAcknowledged();
    this.save();
    return cloneRecord(record);
  }

  getByTaskId(taskId: string): DurableCompletion | undefined {
    const record = this.state.records.find((candidate) => candidate.taskId === taskId && candidate.acknowledgedAt === undefined);
    return record ? cloneRecord(record) : undefined;
  }

  /** Read the next unacknowledged completion without consuming it. */
  read(input: { after?: number; taskId: string; sessionCorrelation?: string }): DurableCompletion | undefined {
    const after = input.after ?? 0;
    const eligible = this.state.records.filter(
      (record) =>
        record.seq > after &&
        record.acknowledgedAt === undefined &&
        record.taskId === input.taskId &&
        (!input.sessionCorrelation || !record.sessionCorrelation || record.sessionCorrelation === input.sessionCorrelation)
    );
    const record = eligible[0];
    if (!record) {
      return undefined;
    }
    return cloneRecord(record);
  }

  /** Mark a completion handled only after the receiver has processed it. */
  acknowledge(taskId: string, now = Date.now()): DurableCompletion | undefined {
    const record = this.state.records.find((candidate) => candidate.taskId === taskId);
    if (!record) return undefined;
    if (record.acknowledgedAt !== undefined) return cloneRecord(record);
    record.acknowledgedAt = now;
    record.continuation.state = "acknowledged";
    this.save();
    return cloneRecord(record);
  }

  private pruneAcknowledged(): void {
    if (this.state.records.length <= 1000) {
      return;
    }
    this.state.records = this.state.records.filter((record) => !record.acknowledgedAt || record.seq > this.state.nextSeq - 1000);
  }

  private save(): void {
    if (!this.filePath) {
      return;
    }
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporaryPath, "w", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(this.state), "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Windows does not expose Unix mode bits consistently; the file remains local state.
    }
  }
}

export function readSessionCorrelation(meta: unknown): string | undefined {
  if (!isRecord(meta)) {
    return undefined;
  }
  const raw = meta["openai/session"];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (isRecord(raw)) {
    for (const key of ["id", "sessionId", "conversationId"]) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function loadState(filePath: string): OutboxState {
  if (!existsSync(filePath)) {
    return { version: 1, nextSeq: 1, records: [] };
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<OutboxState>;
  if (parsed.version !== 1 || !Number.isInteger(parsed.nextSeq) || !Array.isArray(parsed.records)) {
    throw new Error(`Invalid completion outbox state: ${filePath}`);
  }
  if (!parsed.records.every(isTaskCompletionRecord)) {
    throw new Error(`Invalid completion outbox task identity: ${filePath}`);
  }
  const records = parsed.records as DurableCompletion[];
  for (const record of records) {
    record.continuation.state = continuationStateFor(record);
  }
  return {
    version: 1,
    nextSeq: parsed.nextSeq as number,
    records
  };
}

function continuationStateFor(record: DurableCompletion): ContinuationState {
  if (record.acknowledgedAt !== undefined) return "acknowledged";
  return "pending";
}

function isTaskCompletionRecord(value: unknown): value is DurableCompletion {
  if (!isRecord(value) || typeof value.taskId !== "string" || !value.taskId.trim()) {
    return false;
  }
  const continuation = value.continuation;
  return (
    isRecord(continuation) &&
    continuation.tool === "codex_job_status" &&
    isRecord(continuation.arguments) &&
    continuation.arguments.taskId === value.taskId
  );
}

function cloneRecord(record: DurableCompletion): DurableCompletion {
  return JSON.parse(JSON.stringify(record)) as DurableCompletion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
