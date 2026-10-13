# Operate POLYSUB

This is the daily-use guide for an already configured Bridge/Tunnel connection. It explains how to bring the connection up, confirm that the intended layer is reachable, send work, and follow a completion back to the conversation. Installation, dependencies, builds, and detailed error analysis belong in [BUILD_AND_RUN](BUILD_AND_RUN.md) and [TROUBLESHOOTING](TROUBLESHOOTING.md).

The source package does not start or configure an external Tunnel. Use the existing, user-owned Bridge/Tunnel launcher or provider procedure for those controls. Do not treat a local health response as proof that ChatGPT can reach the service.

## Daily startup order

Use this order after the machine or service has been stopped:

1. Start the local Bridge with the existing launcher. Keep its configured listener, authentication mode, allowed roots, and state directory unchanged.
2. Check the local Bridge with `/healthz`. If authenticated diagnostics are part of the setup, check `/diagnostics` as well.
3. Start or attach the external Tunnel using its existing provider procedure. Its destination must point to the Bridge's `/mcp` endpoint, preserving the path and the intended authentication boundary.
4. In ChatGPT or the MCP client, connect to the configured Tunnel URL and run the MCP handshake. Confirm `initialize`, `tools/list`, and `bridge_status` from the client side.
5. Only after those checks pass, send a real read-only probe or the intended task.

The source package has no Windows service, scheduled task, background updater, or installer control. A launcher supplied outside this repository is **not yet verified** by these documents.

## Confirming the connection

These checks answer different questions:

| Check | What it proves | What it does not prove |
| --- | --- | --- |
| `/healthz` | The local HTTP process responds. | Tunnel routing, MCP authentication, Codex, or ChatGPT delivery. |
| `/diagnostics` | The local listener, policy, roots, Codex command, and MCP transport are reported. | That an external client accepted a request. |
| `initialize` and `tools/list` from ChatGPT/MCP | The client reached the MCP endpoint and received the expected protocol/tool surface. | That Codex can finish a job or that a Widget is rendered. |
| `bridge_status` from ChatGPT/MCP | The client can call the Bridge and receive its current status. | A successful Codex turn or host-visible completion. |

The normal tool surface is `bridge_status`, `codex_read`, `codex_run`, `codex_reply`, `codex_job_status`, `codex_completion_next`, and `codex_completion_ack`. Blue-Wake resources and tools appear only when `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` and still depend on the MCP Apps host.

## Sending work and watching a task

Give every operation a new, stable caller-provided `taskId`. Keep that same ID for status, completion, and any Blue-Wake continuation.

- Use `codex_read` for a project inspection that must not modify files. It invokes local Codex in forced `read-only` mode.
- Use `codex_run` only for an intentional execution or change that is allowed by the configured sandbox and the task authorization. Review the requested `cwd`, prompt, and sandbox before sending it.
- Use `codex_reply` with the returned `threadId` to continue the same Codex session. It is not a replacement for the original task ID.
- Keep `cwd` inside an existing configured allowed root. With multiple roots, provide the absolute `cwd` explicitly.
- If a call returns `status: running`, poll `codex_job_status` with the same `taskId`. Do not launch a second copy of the job just because the first call returned quickly.
- Stop polling when the status is `completed`, `failed`, or `timed_out`, and record which status was actually returned.

`workspace-write` is an explicit risk change and is available only when the Bridge policy allows it. `danger-full-access` is not a supported operating mode. The sensitive-file preflight remains part of the work-call boundary.

## Completion, outbox, and Blue-Wake/Widget return

The normal return path is:

`Codex finishes → completion is written to the durable outbox → ChatGPT/MCP retrieves the result → the result is shown in the conversation or Widget host`

Use the same `taskId` throughout this path.

1. For a running job, use `codex_job_status` until it reaches a terminal status.
2. Read a durable result with `codex_completion_next`, supplying the exact `taskId` and, when continuing a sequence, the last seen `after` value. Reading does not consume the result.
3. Acknowledge it with `codex_completion_ack` only after ChatGPT or the receiving host has safely processed it. Acknowledgement removes it from future durable reads.
4. If Blue-Wake is enabled, the long-running response may mount the A-side handoff and the B-side completion receiver. The receiver continues through the existing completion path; it does not start a second job or replace `codex_job_status`.
5. A local outbox result, a resource URI, or a host-capability report does not by itself prove that ChatGPT inserted a message or rendered a Widget. Treat host-visible delivery as confirmed only when the client host provides a visible result or trace.

The outbox location is controlled by `CODEX_GPT_BRIDGE_STATE_DIR`, or the default Codex state location when it is absent. Protect it as application data and do not delete pending results.

## Direct file reads: current boundary

The current Bridge tool surface does **not** expose a separate direct file-read tool. Do not describe `codex_read` as direct file reading: it starts a read-only Codex inspection and requires a `taskId`.

If a future or separately deployed Bridge exposes an independently named file-read tool, confirm it in that connection's `tools/list` response and follow its exact path, root, size, and sensitive-file rules. Only then should a simple read that needs no Codex turn use that tool. Until such a tool is actually listed, use `codex_read` when a read must be performed through this package, and do not claim a direct-read capability.

## Fast fault isolation

Start with the first failed boundary; do not restart every layer at once.

| First failed check | Most likely boundary | Fast next check |
| --- | --- | --- |
| ChatGPT/MCP cannot see `tools/list` or call `bridge_status` | ChatGPT/MCP configuration, Tunnel route, or auth | Test the Tunnel URL and `/mcp` path from the client, then compare with local `/healthz`. |
| Local `/healthz` fails | Bridge process or local listener | Use the existing Bridge control and inspect `/diagnostics`; do not infer a Tunnel fault yet. |
| Local health passes but the client cannot reach MCP | Tunnel destination, provider auth, DNS, or client configuration | Confirm the Tunnel points to the exact `/mcp` endpoint and that the client uses the matching auth mode. |
| `bridge_status` works but `codex_read`/`codex_run` fails | Codex command/App Server, selected `cwd`, sandbox, or sensitive-file preflight | Check the returned task error and the selected allowed root; do not label it a Tunnel failure. |
| Job is running or terminal but the result is not in the conversation | Job polling, completion retrieval, or outbox correlation | Poll `codex_job_status`, then read `codex_completion_next` with the exact `taskId`; do not acknowledge early. |
| Outbox has the result but Blue-Wake/Widget is not visible | MCP Apps host capability or host rendering/delivery | Keep the durable result, inspect the host's own trace, and treat Widget insertion as unverified until visibly confirmed. |

Detailed error messages and recovery procedures belong in [TROUBLESHOOTING](TROUBLESHOOTING.md). The source package does not prove provider connectivity, ChatGPT account eligibility, Widget mounting, or host-visible completion on its own.
