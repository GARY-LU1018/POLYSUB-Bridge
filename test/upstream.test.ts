import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServerUpstream } from "../src/upstream.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const directory of temporaryDirectories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

function createFakeCodex(
  delayMs: number | null,
  respondToInitialize = true,
  capturePath?: string
): { directory: string; command: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "polysub-upstream-"));
  temporaryDirectories.push(directory);
  writeFileSync(
    path.join(directory, "app-server"),
    `const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  ${capturePath ? `require("node:fs").appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify(message) + "\\n");` : ""}
  ${respondToInitialize ? 'if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: {} });' : ""}
  if (message.method === "thread/start") send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "thread-1" } } });
  if (message.method === "turn/start") {
    send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-1" } } });
    ${delayMs === null ? "" : `setTimeout(() => send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } }), ${delayMs});`}
  }
  if (message.method === "turn/interrupt") send({ jsonrpc: "2.0", id: message.id, result: {} });
});`,
    "utf8"
  );
  return { directory, command: process.execPath };
}

describe("Codex App Server upstream", () => {
  it("does not force network denial into the App Server sandbox policy", async () => {
    const capturePath = path.join(os.tmpdir(), `polysub-upstream-network-${Date.now()}.ndjson`);
    const fake = createFakeCodex(10, true, capturePath);
    const upstream = new CodexAppServerUpstream(fake.command, fake.directory);
    try {
      await upstream.callTool(
        "codex",
        { prompt: "network policy", cwd: fake.directory, sandbox: "read-only", "approval-policy": "never" },
        500
      );

      const messages = readFileSync(capturePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
      const turnStart = messages.find((message) => message.method === "turn/start");
      expect(turnStart?.params?.sandboxPolicy).toEqual({ type: "readOnly" });
      expect(turnStart?.params?.sandboxPolicy).not.toHaveProperty("networkAccess");
    } finally {
      await upstream.close();
      rmSync(capturePath, { force: true });
    }
  });

  it("does not interrupt a turn that completes after the communication timeout", async () => {
    const fake = createFakeCodex(800);
    const upstream = new CodexAppServerUpstream(fake.command, fake.directory);
    try {
      const result = await upstream.callTool(
        "codex",
        { prompt: "long task", cwd: fake.directory, sandbox: "read-only", "approval-policy": "never" },
        500
      );

      expect(result.structuredContent).toMatchObject({ threadId: "thread-1", turnId: "turn-1", status: "completed" });
    } finally {
      await upstream.close();
    }
  });

  it("fails a genuinely unresponsive control-plane request", async () => {
    const fake = createFakeCodex(null, false);
    const upstream = new CodexAppServerUpstream(fake.command, fake.directory);
    try {
      await expect(
        upstream.callTool(
          "codex",
          { prompt: "unresponsive setup", cwd: fake.directory, sandbox: "read-only", "approval-policy": "never" },
          20
        )
      ).rejects.toThrow("App Server request timed out: initialize");
    } finally {
      await upstream.close();
    }
  });

  it("treats upstream close as explicit cancellation of active work", async () => {
    const fake = createFakeCodex(null);
    const upstream = new CodexAppServerUpstream(fake.command, fake.directory);
    const work = upstream.callTool(
      "codex",
      { prompt: "cancel me", cwd: fake.directory, sandbox: "read-only", "approval-policy": "never" },
      100
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    await upstream.close();
    await expect(work).rejects.toThrow("App Server upstream closed.");
  });
});
