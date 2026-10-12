import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableCompletionOutbox, readSessionCorrelation } from "../src/completionOutbox.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("durable completion outbox", () => {
  it("persists a pending completion before Blue-Wake and reloads it later", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "polysub-completion-outbox-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "completion-outbox.json");
    const result = { content: [{ type: "text" as const, text: "Codex finished" }] };
    const firstStore = new DurableCompletionOutbox(filePath);
    const written = firstStore.persist({
      taskId: "job-1",
      operation: "codex_run",
      payload: JSON.stringify({ task_id: "job-1", completed: true }),
      result,
      sessionCorrelation: "session-1",
      now: 1000
    });

    expect(written.seq).toBe(1);
    expect(written.continuation.state).toBe("pending");

    const reloaded = new DurableCompletionOutbox(filePath);
    expect(reloaded.read({ after: 0, taskId: "job-1", sessionCorrelation: "session-1" })).toMatchObject({
      taskId: "job-1",
      payload: JSON.stringify({ task_id: "job-1", completed: true }),
      result,
      sessionCorrelation: "session-1",
      continuation: { state: "pending" }
    });
  });

  it("keeps a completion readable after an abandoned receiver and hides it only after direct acknowledgement", () => {
    const store = new DurableCompletionOutbox(null);
    store.persist({
      taskId: "job-2",
      operation: "codex_read",
      payload: "payload",
      result: { content: [{ type: "text", text: "result" }] }
    });

    expect(store.read({ after: 0, taskId: "job-2" })?.continuation.state).toBe("pending");
    expect(store.read({ after: 0, taskId: "job-2" })?.taskId).toBe("job-2");

    const acknowledged = store.acknowledge("job-2", 200);
    expect(acknowledged).toMatchObject({
      taskId: "job-2",
      acknowledgedAt: 200,
      continuation: { state: "acknowledged" }
    });
    expect(store.read({ after: 0, taskId: "job-2" })).toBeUndefined();
    expect(store.acknowledge("job-2", 300)).toMatchObject({ acknowledgedAt: 200 });
  });

  it("normalizes legacy claimed or held records back to pending until they are acknowledged", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "polysub-completion-state-migration-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "completion-outbox.json");
    const store = new DurableCompletionOutbox(filePath);
    store.persist({
      taskId: "job-legacy-held",
      operation: "codex_run",
      payload: "payload",
      result: { content: [{ type: "text", text: "result" }] },
      now: 100
    });

    const state = JSON.parse(readFileSync(filePath, "utf8")) as { records: Array<Record<string, unknown>> };
    state.records[0].claimToken = "old-claim";
    state.records[0].deliveryUncertainAt = 200;
    state.records[0].continuation = { state: "held", tool: "codex_job_status", arguments: { taskId: "job-legacy-held" } };
    writeFileSync(filePath, JSON.stringify(state), "utf8");

    const reloaded = new DurableCompletionOutbox(filePath);
    expect(reloaded.read({ after: 0, taskId: "job-legacy-held" })).toMatchObject({
      taskId: "job-legacy-held",
      continuation: { state: "pending" }
    });
  });

  it("reads the supported session shape and keeps unknown metadata fail-closed", () => {
    expect(readSessionCorrelation({ "openai/session": "session-3" })).toBe("session-3");
    expect(readSessionCorrelation({ "openai/session": { id: "session-4" } })).toBe("session-4");
    expect(readSessionCorrelation({ "openai/session": { opaque: true } })).toBeUndefined();
    expect(readSessionCorrelation(undefined)).toBeUndefined();
  });
});
