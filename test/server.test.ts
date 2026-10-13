import { afterEach, describe, expect, it } from "vitest";
import vm from "node:vm";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { DurableCompletionOutbox } from "../src/completionOutbox.js";
import type { CodexUpstream, ToolResult } from "../src/upstream.js";

class FakeUpstream implements CodexUpstream {
  async listTools(): Promise<unknown> {
    return { tools: [] };
  }

  async callTool(): Promise<ToolResult> {
    return { content: [{ type: "text", text: "ok" }] };
  }

  async close(): Promise<void> {}
}

class DeferredUpstream extends FakeUpstream {
  private pending: Array<{ resolve: (result: ToolResult) => void; reject: (error: Error) => void }> = [];

  override async callTool(): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  resolveNext(): void {
    const pending = this.pending.shift();
    if (!pending) {
      throw new Error("No pending upstream call.");
    }
    pending.resolve({
      content: [
        {
          type: "text",
          text: JSON.stringify({ threadId: "thread-1", content: "done" })
        }
      ]
    });
  }

  rejectNext(error = new Error("upstream failed")): void {
    const pending = this.pending.shift();
    if (!pending) {
      throw new Error("No pending upstream call.");
    }
    pending.reject(error);
  }
}

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("http server", () => {
  it("serves health without auth", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });

    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("returns JSON for OAuth metadata probes in no-auth tunnel mode", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: "oauth_metadata_not_configured" });
  });

  it("requires bearer token on /mcp when configured", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_TOKEN: "secret"
    });

    const denied = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json"
      },
      body: "{}"
    });
    expect(allowed.status).not.toBe(401);
  });

  it("keeps async Codex jobs across stateless HTTP MCP requests", async () => {
    const upstream = new DeferredUpstream();
    const baseUrl = await start(
      {
        CODEX_GPT_BRIDGE_NO_AUTH: "1",
        CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5",
        CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
      },
      upstream
    );
    const client = new Client({
      name: "http-test-client",
      version: "0.0.0"
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const started = parseToolJson(
      await client.callTool({
        name: "codex_run", arguments: { taskId: "test-run",
          prompt: "slow"
        }
      })
    );
    expect(started.status).toBe("running");
    expect(typeof started.taskId).toBe("string");

    upstream.resolveNext();
    const completed = await waitForJobStatus(client, started.taskId, "completed");
    expect(completed.status).toBe("completed");
    expect(JSON.stringify(completed.result)).toContain("thread-1");

    await client.close();
  });

  it("retrieves and acknowledges a durable completion independently of Blue-Wake", async () => {
    const upstream = new DeferredUpstream();
    const baseUrl = await start(
      {
        CODEX_GPT_BRIDGE_NO_AUTH: "1",
        CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5"
      },
      upstream
    );
    const client = new Client({ name: "durable-completion-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const started = parseToolJson(
      await client.callTool({
        name: "codex_run", arguments: { taskId: "test-run", prompt: "durable" },
        _meta: { "openai/session": "session-durable" }
      })
    );
    upstream.resolveNext();
    await waitForJobStatus(client, started.taskId, "completed");

    const next = parseToolJson(
      await client.callTool({
        name: "codex_completion_next",
        arguments: { after: 0, taskId: started.taskId },
        _meta: { "openai/session": "session-durable" }
      })
    );
    expect(next.sessionCorrelationStatus).toBe("available");
    expect(next.completion).toMatchObject({
      taskId: started.taskId,
      sessionCorrelation: "session-durable",
      continuation: { state: "pending", tool: "codex_job_status" }
    });

    const acknowledged = parseToolJson(
      await client.callTool({
        name: "codex_completion_ack",
        arguments: { taskId: started.taskId },
        _meta: { "openai/session": "session-durable" }
      })
    );
    expect(acknowledged.acknowledged).toBe(true);
    expect(
      parseToolJson(
        await client.callTool({
          name: "codex_completion_next",
          arguments: { after: 0, taskId: started.taskId },
          _meta: { "openai/session": "session-durable" }
        })
      ).completion
    ).toBeNull();
    await client.close();
  });

  it("removes the legacy Blue-Wake HTTP surfaces", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });
    const requests: Array<{ method: string; path: string; body?: string }> = [
      { method: "GET", path: "/blue-wake/events?after=0" },
      { method: "POST", path: "/blue-wake/event", body: JSON.stringify({ payload: "POLYSUB_BLUE_WAKE_TEST_001" }) },
      { method: "POST", path: "/blue-wake/widget-ack", body: JSON.stringify({ seq: 1, payload: "test" }) },
      { method: "GET", path: "/blue-wake/debug/observed" }
    ];

    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: request.body ? { "content-type": "application/json" } : undefined,
        body: request.body
      });
      expect(response.status).toBe(404);
    }
  });

  it("keeps deferred Blue-Wake tools out of the default Core surface", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });
    const client = new Client({ name: "core-surface-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "bridge_status",
      "codex_read",
      "codex_run",
      "codex_reply",
      "codex_job_status",
      "codex_completion_next",
      "codex_completion_ack"
    ]);
    await client.close();
  });

  it("emits one Blue-Wake completion event only for a completed job", async () => {
    const upstream = new DeferredUpstream();
    const baseUrl = await start(
      {
        CODEX_GPT_BRIDGE_NO_AUTH: "1",
        CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5",
        CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
      },
      upstream
    );
    const client = new Client({ name: "blue-wake-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const startedResult = await client.callTool({ name: "codex_run", arguments: { taskId: "test-run", prompt: "complete" } });
    const started = parseToolJson(startedResult);
    expect(startedResult.structuredContent).toMatchObject({
      status: "running",
      taskId: started.taskId,
      operation: "codex_run"
    });
    expect(parseToolJson(await client.callTool({ name: "blue_wake_next", arguments: { after: 0, taskId: started.taskId } })).event).toBeNull();

    upstream.resolveNext();
    await waitForJobStatus(client, started.taskId, "completed");

    const first = parseToolJson(
      await client.callTool({ name: "blue_wake_next", arguments: { after: 0, taskId: started.taskId } })
    ).event;
    expect(JSON.parse(first.payload)).toEqual({
      task_id: started.taskId,
      operation: "codex_run",
      completed: true,
      continuation: {
        tool: "codex_job_status",
        arguments: { taskId: started.taskId }
      }
    });
    expect(first.payload).not.toContain("stdout");
    expect(first.payload).not.toContain("stderr");
    expect(first.payload).not.toContain('"result"');
    expect(
      parseToolJson(await client.callTool({ name: "blue_wake_next", arguments: { after: first.seq, taskId: started.taskId } }))
        .event
    ).toBeNull();

    await client.close();
  });

  it("does not emit a Blue-Wake completion event for a failed job", async () => {
    const upstream = new DeferredUpstream();
    const baseUrl = await start(
      {
        CODEX_GPT_BRIDGE_NO_AUTH: "1",
        CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5",
        CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
      },
      upstream
    );
    const client = new Client({ name: "blue-wake-failure-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const started = parseToolJson(
      await client.callTool({ name: "codex_run", arguments: { taskId: "test-run", prompt: "fail" } })
    );
    upstream.rejectNext(new Error("simulated failure"));
    await waitForJobStatus(client, started.taskId, "failed");

    expect(parseToolJson(await client.callTool({ name: "blue_wake_next", arguments: { after: 0, taskId: started.taskId } })).event).toBeNull();
    await client.close();
  });

  it("exposes Blue-Wake MCP tools and a host-bridge-only widget", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-widget-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const tools = await client.listTools();
    const nextTool = tools.tools.find((tool) => tool.name === "blue_wake_next");
    const codexRunTool = tools.tools.find((tool) => tool.name === "codex_run");
    expect(nextTool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    expect(codexRunTool?._meta).toMatchObject({
      ui: { resourceUri: "ui://blue-wake/live-test-ab.html" }
    });
    expect(codexRunTool?._meta).not.toHaveProperty("openai/outputTemplate");
    expect(tools.tools.some((tool) => tool.name === "blue_wake_live_test")).toBe(false);
    const renderTool = tools.tools.find((tool) => tool.name === "blue_wake_render");
    expect(renderTool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(renderTool?._meta).toMatchObject({ ui: { resourceUri: "ui://blue-wake/render.html" } });

    const handoffResource = await client.readResource({ uri: "ui://blue-wake/live-test-ab.html" });
    const handoffWidget = String((handoffResource.contents[0] as { text?: string }).text || "");
    expect(handoffWidget).toContain('<section id="status-card" aria-label="POLYSUB Bridge status">');
    expect(handoffWidget).toContain("BLUE_WAKE_B_RECEIVER");
    expect(handoffWidget).not.toContain("blue_wake_next");
    expect(handoffWidget).not.toContain("codex_completion_ack");

    const resource = await client.readResource({ uri: "ui://blue-wake/render.html" });
    const widget = String((resource.contents[0] as { text?: string }).text || "");
    expect(widget).toContain("ui/initialize");
    expect(widget).toContain("ui/notifications/initialized");
    expect(widget).toContain("tools/call");
    expect(widget).toContain("ui/message");
    expect(widget).toContain("ui/message REQUEST_SENT");
    expect(widget).toContain("ui/message SUCCESS(result=");
    expect(widget).toContain("ui/message ERROR(");
    expect(widget).toContain("hostCapabilities");
    expect(widget).toContain("HOST_CAPABILITIES_CAPTURE SUCCESS");
    expect(widget).toContain("blue_wake_host_capabilities");
    expect(widget).toContain("blue_wake_host_capabilities_capture");
    expect(widget).not.toContain("HOST_CAPABILITIES(result.hostCapabilities)=");
    expect(widget).toContain("sendFollowUpMessage");
    expect(widget).toContain("NOT_AVAILABLE");
    expect(widget).not.toContain("ui/message invoked for");
    expect(widget).toContain('text:payload,annotations:{audience:["assistant"]}');
    expect(widget).not.toContain('sendFollowUpMessage({prompt:payload})');
    expect(widget).toContain('send({prompt:visibleMessage})');
    expect(widget).toContain("TASK_ID_REQUIRED");
    expect(widget).not.toContain("establishBaseline");
    expect(widget).toContain("ui/resource-teardown");
    expect(widget).toContain("TEARDOWN_ACK");
    expect(widget).toContain("blue_wake_next");
    expect(widget).toContain("codex_completion_ack");
    expect(widget).not.toContain("codex_completion_claim");
    expect(widget).not.toContain("codex_completion_hold");
    expect(widget).toContain("COMPLETION_DELIVERY_PENDING");
    expect(widget).toContain("RPC_TIMEOUT_RETRY");
    expect(widget).toContain("RPC_TIMEOUT");
    expect(widget).toContain("toolOutput");
    expect(widget).toContain("TASK_CORRELATION(taskId=");
    expect(widget).not.toContain("model_context_split");
    expect(widget).not.toContain("readTestMode");
    expect(widget).not.toContain("MODEL_CONTEXT_SPLIT_TEST");
    expect(widget).toContain("POLYSUB Bridge 已啟用");
    expect(widget).toContain("完成的工作會自動送回目前的 ChatGPT 對話。");
    expect(widget).toContain("● B completion receiver");
    expect(widget.match(/id="status-card"/g) ?? []).toHaveLength(1);
    expect(widget).toContain('id="completion-card"');
    expect(widget).toContain("background:#e6f4ea");
    expect(widget).toContain("border:1px solid #34a853");
    expect(widget).toContain("completionCard.hidden=false");
    expect(widget.indexOf('completionCard.hidden=false;write("B ui/message SUCCESS')).toBeGreaterThan(
      widget.indexOf('if(!accepted(result)){write("B ui/message NOT_ACCEPTED")')
    );
    expect(widget.indexOf('completionCard.hidden=false;write("C window.openai.sendFollowUpMessage SUCCESS')).toBeGreaterThan(
      widget.indexOf('send({prompt:visibleMessage})')
    );
    expect(widget).not.toContain("POLYSUB Bridge 已連線");
    expect(widget).not.toContain("等待回傳");
    expect(widget).not.toContain("waiting for the next completed");
    expect(widget).toContain("body>h3,#state{display:none}");
    expect(widget).not.toContain('<section id="status-card" hidden aria-label="POLYSUB Bridge status">');
    expect(widget).toContain("#status-card[hidden],#completion-card[hidden]{display:none}");
    expect(widget).not.toContain("127.0.0.1:8876");
    expect(widget).not.toContain("/blue-wake/events");
    expect(widget).not.toContain("/blue-wake/widget-ack");
    expect(widget).not.toContain("fetch(");
    expect(widget).not.toContain("REQUEST_SENT(payload=");
    expect(widget).not.toContain("COMPLETION_RECEIVED(seq=" + "payload=");

    expect(parseToolJson(await client.callTool({ name: "blue_wake_render", arguments: { taskId: "render-tool-task" } }))).toEqual({
      taskId: "render-tool-task",
      marker: "BLUE_WAKE_B_RECEIVER",
      mode: "receiver"
    });

    await client.close();
  });

  it("starts the B handoff from A without polling or waiting for completion", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-handoff-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const resource = await client.readResource({ uri: "ui://blue-wake/live-test-ab.html" });
    const widget = String((resource.contents[0] as { text?: string }).text || "");
    const script = widget.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!script) throw new Error("Widget script was not found.");

    const sent: Array<{ method?: string; params?: any; id?: number }> = [];
    const listeners: Array<(event: { source: unknown; data: any }) => void> = [];
    const parent = {
      postMessage(message: { id?: number; method?: string; params?: any }): void {
        sent.push(message);
        if (message.id === undefined) return;
        const result = message.method === "ui/initialize" ? { hostCapabilities: {} } : { accepted: true };
        queueMicrotask(() => listeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id: message.id, result } })));
      }
    };
    const state = { textContent: "" };
    const sandbox = {
      window: {
        parent,
        openai: { toolOutput: { structuredContent: { status: "running", taskId: "handoff-task" } } },
        setTimeout: (callback: () => void, delay = 0) => setTimeout(callback, delay),
        clearTimeout,
        addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
          if (type === "message") listeners.push(listener);
        },
        removeEventListener: () => undefined
      },
      document: { getElementById: () => state },
      console: { info: () => undefined },
      queueMicrotask,
      setTimeout,
      clearTimeout
    } as Record<string, unknown>;
    vm.runInNewContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const messages = sent.filter((message) => message.method === "ui/message");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.params?.content?.[0]?.text).toContain("task_id=\"handoff-task\"");
    expect(messages[0]?.params?.content?.[0]?.text).toContain("marker=BLUE_WAKE_B_RECEIVER");
    expect(sent.some((message) => message.method === "tools/call" && message.params?.name === "blue_wake_next")).toBe(false);
    expect(state.textContent).toContain("A ui/message SUCCESS");
    await client.close();
  });

  it("shows the green completion card only after accepted visible delivery", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-card-visibility-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const script = await readBlueWakeWidgetScript(client);
    const sent: Array<{ method?: string; params?: any; id?: number; result?: any }> = [];
    const windowListeners: Array<(event: { source: unknown; data: any }) => void> = [];
    const state = { textContent: "" };
    const statusCard = { hidden: true };
    const completionCard = { hidden: true };
    const parent = {
      postMessage(message: { id?: number; method?: string; params?: any }): void {
        sent.push(message);
        if (message.id === undefined) return;
        const id = message.id;
        let result: any = { recorded: true };
        if (message.method === "ui/initialize") {
          result = { hostCapabilities: {} };
        } else if (message.method === "tools/call" && message.params?.name === "blue_wake_next") {
          result = {
            structuredContent: {
              event: {
                seq: 1,
                payload: JSON.stringify({
                  task_id: "job-card-visibility",
                  operation: "codex_run",
                  completed: true,
                  continuation: { tool: "codex_job_status", arguments: { taskId: "job-card-visibility" } }
                }),
                receivedAt: "2026-10-11T00:00:00.000Z"
              }
            }
          };
        } else if (message.method === "ui/update-model-context") {
          result = { accepted: true };
        } else if (message.method === "ui/message") {
          result = { accepted: true };
        }
        queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result } })));
      }
    };
    const sandbox = {
      window: {
        parent,
        openai: { toolOutput: { structuredContent: { taskId: "job-card-visibility" } } },
        setTimeout: (callback: () => void, delay = 0) => delay >= 1000 ? 0 : setTimeout(callback, 0),
        clearTimeout,
        addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
          if (type === "message") windowListeners.push(listener);
        },
        removeEventListener: () => undefined
      },
      document: {
        getElementById: (id: string) => id === "state" ? state : id === "status-card" ? statusCard : completionCard
      },
      console: { info: () => undefined },
      queueMicrotask,
      setTimeout,
      clearTimeout
    } as Record<string, unknown>;

    vm.runInNewContext(script, sandbox);
    expect(statusCard.hidden).toBe(true);
    expect(completionCard.hidden).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(completionCard.hidden).toBe(false);
    expect(sent.filter((message) => message.method === "ui/message")).toHaveLength(1);
    expect(state.textContent).toContain("B ui/message SUCCESS(result=RECEIVED)");
    await client.close();
  });

  it("fails closed when the widget has no taskId", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-missing-task-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const resource = await client.readResource({ uri: "ui://blue-wake/render.html" });
    const widget = String((resource.contents[0] as { text?: string }).text || "");
    const script = widget.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!script) throw new Error("Widget script was not found.");

    const sent: Array<{ method?: string; params?: any; id?: number; result?: any }> = [];
    const windowListeners: Array<(event: { source: unknown; data: any }) => void> = [];
    const parent = {
      postMessage(message: { id?: number; method?: string; params?: any }): void {
        sent.push(message);
        if (message.id === undefined) return;
        const id = message.id;
        const result = message.method === "ui/initialize" ? { hostCapabilities: {} } : { recorded: true };
        queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result } })));
      }
    };
    const state = { textContent: "" };
    const sandbox = {
      window: {
        parent,
        openai: { toolOutput: { structuredContent: { ready: true } } },
        setTimeout: (callback: () => void) => setTimeout(callback, 0),
        clearTimeout,
        addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
          if (type === "message") windowListeners.push(listener);
        },
        removeEventListener: () => undefined
      },
      document: { getElementById: () => state },
      console: { info: () => undefined },
      queueMicrotask,
      setTimeout,
      clearTimeout
    } as Record<string, unknown>;
    vm.runInNewContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(state.textContent).toContain("TASK_ID_REQUIRED");
    expect(sent.some((message) => message.method === "tools/call" && message.params?.name === "blue_wake_next")).toBe(false);
    await client.close();
  });

  it("correlates blue_wake_next request and result without changing its result schema", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-correlation-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const result = await client.callTool({
      name: "blue_wake_next",
      arguments: { after: 0, taskId: "work-test-1" }
    });
    expect(parseToolJson(result)).toMatchObject({ event: null, after: 0, nextAfter: 0 });
    await client.close();
  });

  it("exposes bounded host capability facts and unknown state through a read-only diagnostic tool", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-capability-diagnostic-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const tools = await client.listTools();
    const diagnostic = tools.tools.find((tool) => tool.name === "blue_wake_host_capabilities");
    expect(diagnostic?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });

    expect(parseToolJson(await client.callTool({ name: "blue_wake_host_capabilities", arguments: {} }))).toEqual({
      observation: "not_observed",
      message: { text: "unknown", structuredContent: "unknown" },
      updateModelContext: { text: "unknown", structuredContent: "unknown" }
    });

    await client.callTool({
      name: "blue_wake_host_capabilities_capture",
      arguments: {
        hostCapabilities: {
          message: { text: true },
          updateModelContext: { structuredContent: true },
          unrelated: "ignored by the bounded schema"
        }
      }
    });
    expect(parseToolJson(await client.callTool({ name: "blue_wake_host_capabilities", arguments: {} }))).toEqual({
      observation: "observed",
      message: { text: "yes", structuredContent: "no" },
      updateModelContext: { text: "no", structuredContent: "yes" }
    });
    await client.close();
  });

  it("retries a stalled read and leaves a rejected host delivery pending", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-recovery-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const resource = await client.readResource({ uri: "ui://blue-wake/render.html" });
    const widget = String((resource.contents[0] as { text?: string }).text || "");
    const script = widget.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!script) throw new Error("Widget script was not found.");

    const sent: Array<{ method?: string; params?: any; id?: number; result?: any; error?: any }> = [];
    const windowListeners: Array<(event: { source: unknown; data: any }) => void> = [];
    const nextArguments: any[] = [];
    let nextCalls = 0;
    const parent = {
      postMessage(message: { id?: number; method?: string; params?: any }): void {
        sent.push(message);
        if (message.id === undefined) return;
        const id = message.id;
        if (message.method === "ui/initialize") {
          queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result: { hostCapabilities: { message: { text: {} } } } } })));
          return;
        }
        if (message.method === "tools/call" && message.params?.name === "blue_wake_next") {
          nextCalls += 1;
          nextArguments.push(message.params.arguments);
          if (nextCalls === 1) {
            setTimeout(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result: { structuredContent: { event: null } } } })), 5);
            return;
          }
          const event = nextCalls === 2
            ? { seq: 7, payload: JSON.stringify({ task_id: "job-recovery", operation: "codex_run", completed: true, continuation: { tool: "codex_job_status", arguments: { taskId: "job-recovery" } } }), receivedAt: "2026-10-01T00:00:00.000Z" }
            : null;
          queueMicrotask(() => windowListeners.forEach((listener) => listener({
            source: parent,
            data: { jsonrpc: "2.0", id, result: { structuredContent: { event } } }
          })));
          return;
        }
        if (message.method === "ui/update-model-context") {
          queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, error: { code: -32602, message: "simulated host rejection" } } })));
          return;
        }
        queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result: { recorded: true } } })));
      }
    };
    const state = { textContent: "" };
    const sandbox = {
      window: {
        parent,
        openai: { toolOutput: { structuredContent: { status: "running", taskId: "job-recovery" } } },
        setTimeout: (callback: () => void, _delay?: number) => setTimeout(callback, 0),
        clearTimeout,
        addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
          if (type === "message") windowListeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (event: { source: unknown; data: any }) => void) => {
          const index = windowListeners.indexOf(listener);
          if (index >= 0) windowListeners.splice(index, 1);
        }
      },
      document: { getElementById: () => state },
      console: { info: () => undefined },
      queueMicrotask,
      setTimeout,
      clearTimeout
    } as Record<string, unknown>;
    vm.runInNewContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(nextCalls).toBeGreaterThanOrEqual(2);
    expect(nextArguments.every((args) => args.after === 0)).toBe(true);
    expect(sent.filter((message) => message.method === "ui/update-model-context")).toHaveLength(1);
    expect(sent.filter((message) => message.method === "ui/message")).toHaveLength(0);
    expect(sent.filter((message) => message.method === "tools/call" && message.params?.name === "codex_completion_ack")).toHaveLength(0);
    expect(state.textContent).toContain("RPC_TIMEOUT_RETRY(method=tools/call");
    expect(state.textContent).toContain("COMPLETION_DELIVERY_PENDING");
    await client.close();
  });

  it("leaves an ambiguous visible callback pending without advancing or acknowledging it", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-ambiguous-delivery-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const script = await readBlueWakeWidgetScript(client);
    const sent: Array<{ method?: string; params?: any; id?: number; result?: any }> = [];
    const windowListeners: Array<(event: { source: unknown; data: any }) => void> = [];
    const nextArguments: any[] = [];
    let nextCalls = 0;
    const parent = {
      postMessage(message: { id?: number; method?: string; params?: any }): void {
        sent.push(message);
        if (message.id === undefined) return;
        const id = message.id;
        let result: unknown = {};
        if (message.method === "ui/initialize") {
          result = { hostCapabilities: { message: { text: {} } } };
        } else if (message.method === "tools/call" && message.params?.name === "blue_wake_next") {
          nextCalls += 1;
          nextArguments.push(message.params.arguments);
          result = nextCalls === 1
            ? {
                structuredContent: {
                  event: {
                    seq: 11,
                    payload: JSON.stringify({
                      task_id: "job-ambiguous",
                      operation: "codex_run",
                      completed: true,
                      continuation: { tool: "codex_job_status", arguments: { taskId: "job-ambiguous" } }
                    }),
                    receivedAt: "2026-10-09T00:00:00.000Z"
                  }
                }
              }
            : { structuredContent: { event: null } };
        } else if (message.method === "ui/update-model-context") {
          result = { accepted: true };
        } else if (message.method === "ui/message") {
          return;
        } else if (message.method === "tools/call" && message.params?.name === "codex_completion_ack") {
          throw new Error("ACK must not be attempted after ambiguous delivery");
        }
        queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result } })));
      }
    };
    const state = { textContent: "" };
    const sandbox = {
      window: {
        parent,
        openai: { toolOutput: { structuredContent: { status: "running", taskId: "job-ambiguous" } } },
        setTimeout: (callback: () => void) => setTimeout(callback, 0),
        clearTimeout,
        addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
          if (type === "message") windowListeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (event: { source: unknown; data: any }) => void) => {
          const index = windowListeners.indexOf(listener);
          if (index >= 0) windowListeners.splice(index, 1);
        }
      },
      document: { getElementById: () => state },
      console: { info: () => undefined },
      queueMicrotask,
      setTimeout,
      clearTimeout
    } as Record<string, unknown>;
    vm.runInNewContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(nextCalls).toBeGreaterThanOrEqual(1);
    expect(nextArguments[0]).toEqual({ after: 0, taskId: "job-ambiguous" });
    expect(nextArguments.every((args) => args.after === 0)).toBe(true);
    expect(sent.filter((message) => message.method === "ui/message")).toHaveLength(1);
    expect(sent.filter((message) => message.method === "tools/call" && message.params?.name === "codex_completion_ack")).toHaveLength(0);
    expect(state.textContent).toContain("COMPLETION_DELIVERY_PENDING");
    await client.close();
  });

  it("uses automatic structured job correlation without a manual mount baseline", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-auto-correlation-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const resource = await client.readResource({ uri: "ui://blue-wake/render.html" });
    const widget = String((resource.contents[0] as { text?: string }).text || "");
    const script = widget.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!script) throw new Error("Widget script was not found.");

    const sent: Array<{ method?: string; params?: any; id?: number; result?: any }> = [];
    const windowListeners: Array<(event: { source: unknown; data: any }) => void> = [];
    let nextCalls = 0;
    const expectedRawJsonPayload = JSON.stringify({
      task_id: "job-auto",
      operation: "codex_run",
      completed: true,
      continuation: { tool: "codex_job_status", arguments: { taskId: "job-auto" } }
    });
    const expectedVisibleMessage = "工作已完成，請檢閱回報。";
    const followUpPrompts: string[] = [];
    const parent = {
      postMessage(message: { id?: number; method?: string; params?: any }): void {
        sent.push(message);
        if (message.id === undefined) return;
        let result: unknown = {};
        if (message.method === "ui/initialize") {
          result = { hostCapabilities: { message: { text: {} } } };
        } else if (message.method === "tools/call" && message.params?.name === "blue_wake_next") {
          nextCalls += 1;
          if (nextCalls === 1) {
            expect(message.params).toMatchObject({
              name: "blue_wake_next",
              arguments: { after: 0, taskId: "job-auto" }
            });
            result = {
              structuredContent: {
                event: {
                  seq: 7,
                  payload: JSON.stringify({
                    task_id: "job-auto",
                    operation: "codex_run",
                    completed: true,
                    continuation: { tool: "codex_job_status", arguments: { taskId: "job-auto" } }
                  }),
                  receivedAt: "2026-09-28T00:00:00.000Z"
                }
              }
            };
          } else if (nextCalls === 2) {
            expect(message.params).toMatchObject({ name: "blue_wake_next", arguments: { after: 7, taskId: "job-auto" } });
            result = { structuredContent: { event: null } };
          } else {
            expect(message.params).toMatchObject({ name: "blue_wake_next", arguments: { after: 7, taskId: "job-auto" } });
            result = { structuredContent: { event: null } };
          }
        } else if (message.method === "tools/call" && message.params?.name === "codex_completion_ack") {
          result = { structuredContent: { acknowledged: true } };
        } else if (message.method === "tools/call") {
          result = { recorded: true };
        } else if (message.method === "ui/update-model-context") {
          expect(message.params).toEqual({
            content: [{ type: "text", text: expectedRawJsonPayload, annotations: { audience: ["assistant"] } }]
          });
          result = { accepted: true };
        } else if (message.method === "ui/message") {
          expect(message.params).toEqual({
            role: "user",
            content: [{ type: "text", text: expectedVisibleMessage }]
          });
          result = { accepted: true };
        }
        const id = message.id;
        queueMicrotask(() =>
          windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result } }))
        );
      }
    };
    const state = { textContent: "" };
    const sandbox = {
      window: {
        parent,
        openai: {
          toolOutput: { structuredContent: { status: "running", taskId: "job-auto" } },
          sendFollowUpMessage: ({ prompt }: { prompt: string }) => {
            followUpPrompts.push(prompt);
            return Promise.resolve({ accepted: true });
          }
        },
        setTimeout: (callback: () => void) => setTimeout(callback, 0),
        clearTimeout,
        addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
          if (type === "message") windowListeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (event: { source: unknown; data: any }) => void) => {
          const index = windowListeners.indexOf(listener);
          if (index >= 0) windowListeners.splice(index, 1);
        }
      },
      document: { getElementById: () => state },
      console: { info: () => undefined },
      queueMicrotask,
      setTimeout,
      clearTimeout
    } as Record<string, unknown>;
    vm.runInNewContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(nextCalls).toBeGreaterThanOrEqual(2);
    expect(sent.filter((message) => message.method === "ui/message")).toHaveLength(1);
    expect(sent.filter((message) => message.method === "ui/update-model-context")).toHaveLength(1);
    expect(followUpPrompts).toEqual([]);
    expect(sent.filter((message) => message.method === "ui/message").every((message) => message.params?.content?.[0]?.text === expectedVisibleMessage)).toBe(true);
    expect(sent.filter((message) => message.method === "ui/message").some((message) => message.params?.content?.[0]?.text === expectedRawJsonPayload)).toBe(false);
    expect(sent.filter((message) => message.method === "tools/call" && message.params?.name === "codex_completion_ack")).toHaveLength(1);
    expect(state.textContent).toContain("TASK_CORRELATION(taskId=\"job-auto\")");
    expect(state.textContent).toContain("COMPLETION_RECEIVED(seq=7");
    expect(state.textContent).toContain("ui/update-model-context SUCCESS(result=RECEIVED)");
    expect(state.textContent).not.toContain("BASELINE_CAPTURED");
    await client.close();
  });

  it("uses only the fixed visible fallback after accepted model context", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE: "1"
    });
    const client = new Client({ name: "blue-wake-fixed-fallback-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const script = await readBlueWakeWidgetScript(client);
    const sent: Array<{ method?: string; params?: any; id?: number }> = [];
    const followUpPrompts: string[] = [];
    const windowListeners: Array<(event: { source: unknown; data: any }) => void> = [];
    let nextCalls = 0;
    const expectedPayload = JSON.stringify({
      task_id: "job-fixed-fallback",
      operation: "codex_run",
      completed: true,
      continuation: { tool: "codex_job_status", arguments: { taskId: "job-fixed-fallback" } }
    });
    const fixedMessage = "工作已完成，請檢閱回報。";
    const parent = {
      postMessage(message: { id?: number; method?: string; params?: any }): void {
        sent.push(message);
        if (message.id === undefined) return;
        if (message.method === "ui/message") throw new Error("simulated definitely-not-sent visible message");
        const id = message.id;
        let result: any = {};
        if (message.method === "ui/initialize") {
          result = { hostCapabilities: {} };
        } else if (message.method === "tools/call" && message.params?.name === "blue_wake_next") {
          nextCalls += 1;
          result = nextCalls === 1
            ? { structuredContent: { event: { seq: 8, payload: expectedPayload, receivedAt: "2026-10-02T00:00:00.000Z" } } }
            : { structuredContent: { event: null } };
        } else if (message.method === "tools/call" && message.params?.name === "codex_completion_ack") {
          result = { structuredContent: { acknowledged: true } };
        } else if (message.method === "ui/update-model-context") {
          expect(message.params).toEqual({
            content: [{ type: "text", text: expectedPayload, annotations: { audience: ["assistant"] } }]
          });
          result = { accepted: true };
        }
        queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result } })));
      }
    };
    const state = { textContent: "" };
    const sandbox = {
      window: {
        parent,
        openai: {
          toolOutput: { structuredContent: { status: "running", taskId: "job-fixed-fallback" } },
          sendFollowUpMessage: ({ prompt }: { prompt: string }) => {
            followUpPrompts.push(prompt);
            return Promise.resolve({ accepted: true });
          }
        },
        setTimeout: (callback: () => void) => setTimeout(callback, 0),
        clearTimeout,
        addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
          if (type === "message") windowListeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (event: { source: unknown; data: any }) => void) => {
          const index = windowListeners.indexOf(listener);
          if (index >= 0) windowListeners.splice(index, 1);
        }
      },
      document: { getElementById: () => state },
      console: { info: () => undefined },
      queueMicrotask,
      setTimeout,
      clearTimeout
    } as Record<string, unknown>;
    vm.runInNewContext(script, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const ackIndex = sent.findIndex((message) => message.method === "tools/call" && message.params?.name === "codex_completion_ack");
    const contextIndex = sent.findIndex((message) => message.method === "ui/update-model-context");
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(ackIndex).toBeGreaterThan(contextIndex);
    expect(sent.filter((message) => message.method === "tools/call" && message.params?.name === "codex_completion_ack")).toHaveLength(1);
    expect(sent.filter((message) => message.method === "ui/message").every((message) => message.params?.content?.[0]?.text === fixedMessage)).toBe(true);
    expect(followUpPrompts).toEqual([fixedMessage]);
    expect(followUpPrompts).not.toContain(expectedPayload);
    expect(state.textContent).toContain("COMPLETION_ACK SUCCESS");
    await client.close();
  });

});

async function readBlueWakeWidgetScript(client: Client): Promise<string> {
  const resource = await client.readResource({ uri: "ui://blue-wake/render.html" });
  const widget = String((resource.contents[0] as { text?: string }).text || "");
  const script = widget.match(/<script>([\s\S]*)<\/script>/)?.[1];
  if (!script) throw new Error("Widget script was not found.");
  return script;
}

async function runModelContextSplitWidget(
  script: string,
  updateMode: "accepted" | "error" | "ambiguous"
): Promise<{ sent: Array<{ method?: string; params?: any; id?: number; result?: any; error?: any }>; state: string }> {
  const sent: Array<{ method?: string; params?: any; id?: number; result?: any; error?: any }> = [];
  const windowListeners: Array<(event: { source: unknown; data: any }) => void> = [];
  const parent = {
    postMessage(message: { id?: number; method?: string; params?: any }): void {
      sent.push(message);
      if (message.id === undefined) return;
      const id = message.id;
      if (message.method === "ui/initialize") {
        queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, result: { hostCapabilities: {} } } })));
        return;
      }
      let response: { result?: any; error?: any } = { result: { recorded: true } };
      if (message.method === "tools/call" && message.params?.name === "blue_wake_host_capabilities_capture") {
        response = { result: { recorded: true } };
      } else if (message.method === "ui/update-model-context") {
        response = updateMode === "error" ? { error: { code: -32602, message: "simulated model-context rejection" } } : { result: updateMode === "ambiguous" ? { isError: true } : { accepted: true } };
      } else if (message.method === "ui/message") {
        response = { result: { accepted: true } };
      }
      queueMicrotask(() => windowListeners.forEach((listener) => listener({ source: parent, data: { jsonrpc: "2.0", id, ...response } })));
    }
  };
  const state = { textContent: "" };
  const sandbox = {
    window: {
      parent,
      openai: { toolOutput: { structuredContent: { ready: true, testMode: "model_context_split" } } },
      setTimeout: (callback: () => void) => setTimeout(callback, 0),
      clearTimeout,
      addEventListener: (type: string, listener: (event: { source: unknown; data: any }) => void) => {
        if (type === "message") windowListeners.push(listener);
      },
      removeEventListener: (_type: string, listener: (event: { source: unknown; data: any }) => void) => {
        const index = windowListeners.indexOf(listener);
        if (index >= 0) windowListeners.splice(index, 1);
      }
    },
    document: { getElementById: () => state },
    console: { info: () => undefined },
    queueMicrotask,
    setTimeout,
    clearTimeout
  } as Record<string, unknown>;
  vm.runInNewContext(script, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 25));
  return { sent, state: state.textContent };
}

async function start(env: NodeJS.ProcessEnv, upstream: CodexUpstream = new FakeUpstream()): Promise<string> {
  const config = loadConfig({
    ...env,
    CODEX_GPT_BRIDGE_HOST: "127.0.0.1",
    CODEX_GPT_BRIDGE_PORT: "1"
  });
  const server = createHttpServer(config, upstream, {
    completionOutbox: new DurableCompletionOutbox(null)
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function parseToolJson(result: unknown): Record<string, any> {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return JSON.parse(content?.[0]?.text || "{}");
}

async function waitForJobStatus(client: Client, taskId: string, expected: string): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = parseToolJson(
      await client.callTool({
        name: "codex_job_status",
        arguments: {
          taskId
        }
      })
    );
    if (status.status === expected) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for job status ${expected}.`);
}
