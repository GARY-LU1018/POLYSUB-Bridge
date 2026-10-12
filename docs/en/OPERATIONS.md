# Operate POLYSUB

This guide covers the controls that are present in the current source package.

## Start and stop

From the repository directory, with the required environment variables set:

```powershell
# Development mode
npm run dev

# Compiled mode
npm run build
npm start
```

Press `Ctrl+C` in the running window to request a clean shutdown. The bridge handles `SIGINT` and `SIGTERM`, closes the HTTP server, and closes its Codex App Server child process.

There is no Windows service, scheduled task, background updater, or installer control in this source package. **Not yet verified:** any service wrapper or desktop launcher supplied outside this repository.

## Health and diagnostics

Health is unauthenticated and reports only that the HTTP process is responding:

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
```

Diagnostics require the Bearer token unless no-auth mode is enabled:

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8876/diagnostics -Headers $headers
```

Diagnostics expose runtime and policy information such as the listener, allowed roots, sandbox flags, configured Codex command, and MCP transport. They do not prove that an external tunnel or client host accepted a request.

## MCP endpoint and tools

The MCP endpoint accepts `POST /mcp`. A client must use the configured Bearer token and the MCP media types it supports; Streamable HTTP clients commonly send `Accept: application/json, text/event-stream`.

The normal tool set is:

`bridge_status`, `codex_read`, `codex_run`, `codex_reply`, `codex_job_status`, `codex_completion_next`, and `codex_completion_ack`.

When `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` is set, additional completion resources and tools are registered. They remain dependent on the MCP Apps host implementation.

## Read-only and workspace-write modes

- The default sandbox is `read-only`.
- `codex_read` always forces `read-only`.
- `workspace-write` is available only when `CODEX_GPT_BRIDGE_ALLOW_WRITE=1` is set, and the request explicitly selects it or the default is configured accordingly.
- `danger-full-access` is rejected by the bridge tools and is not a supported operating mode.
- The default approval policy is `never`; `untrusted`, `on-request`, and `never` are the accepted configuration values.

Treat `workspace-write` as an explicit change of risk. Use a dedicated allowed root and review the prompt before enabling it.

## Allowed roots and working directories

`CODEX_GPT_BRIDGE_ROOTS` must contain one or more existing absolute paths separated by commas. The bridge resolves the path and rejects a `cwd` outside those roots.

- With one allowed root, an operation may omit `cwd` and uses that root.
- With multiple roots, the caller must supply `cwd`.
- Before `codex_read`, `codex_run`, and `codex_reply`, the bridge scans the selected directory for sensitive-looking files.
- The scan is enabled by default. Disabling it with `CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1` is an explicit risk decision and should be avoided for shared or sensitive workspaces.

## Token and host binding

Authentication is enabled when `CODEX_GPT_BRIDGE_TOKEN` is set. `CODEX_GPT_BRIDGE_NO_AUTH=1` bypasses the token only for loopback host values. Do not use no-auth with a non-loopback bind address.

`CODEX_GPT_BRIDGE_ALLOWED_HOSTS` is passed to the MCP HTTP application as its host allowlist. It does not create an identity provider or replace the Bearer token.

## Tunnel boundary

The source package does not start, configure, or ship a Tunnel client. Tunnel IDs, provider profiles, provider credentials, remote DNS, network policy, and external health are outside POLYSUB's source configuration.

If an external tunnel is used, verify the local bridge first, keep secrets outside the repository, and make sure its destination and authentication settings match the local `/mcp` endpoint. Provider-side connectivity and host-visible delivery are **Not yet verified** by this repository.

## Completion handling

Long-running work is tracked by the caller-provided `taskId`. If the initial tool call returns `status: running`, poll `codex_job_status` with the same ID until it reports `completed`, `failed`, or `timed_out`.

Completed results are also kept in a local completion outbox. Its location is controlled by `CODEX_GPT_BRIDGE_STATE_DIR`, or by the default Codex state location when that variable is absent. Treat this state as potentially sensitive and protect it like application data.

Optional completion resources are disabled unless `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1`. The source can expose a completion resource and host-capability report; a local result does not prove that the external host displayed or inserted the completion.

## Update and rollback

There is no automated update or rollback command in the current package.

For a manual update:

1. Stop the running process.
2. Preserve the current source directory and local state if a rollback may be needed.
3. Install the new source dependencies with `npm install`.
4. Run `npm run check` and then `npm run build`.
5. Start the updated version and repeat `/healthz`, `/diagnostics`, and `bridge_status` checks.

To roll back, stop the process and restore the previously verified source/dependency tree, then repeat the same checks. Do not delete the completion outbox until pending results are no longer needed.

## Uninstall and cleanup

Stop the bridge, remove the source directory if it is no longer needed, and separately review the directory used for `CODEX_GPT_BRIDGE_STATE_DIR` or the default completion outbox. Do not remove state, credentials, Codex data, or external Tunnel profiles without confirming their ownership and purpose.
