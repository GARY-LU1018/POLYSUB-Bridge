# Troubleshoot POLYSUB

Use the checks below in order. Record the command output after removing tokens, paths that should remain private, and other sensitive data.

## The bridge does not start

1. Confirm the runtime:

   ```powershell
   node --version
   npm --version
   ```

2. Install dependencies and run the project checks:

   ```powershell
   npm install
   npm run check
   ```

3. Check the startup error. Common configuration failures are:

   - no `CODEX_GPT_BRIDGE_TOKEN` and no loopback-only no-auth setting;
   - a non-positive or invalid port;
   - a root that is not absolute or does not exist;
   - `workspace-write` selected without `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`;
   - a missing or unusable `codex` command.

The bridge does not install Codex. Verify the configured command separately with `Get-Command codex` or set `CODEX_GPT_BRIDGE_CODEX`.

## Port `8876` is occupied

Check the listener before changing anything:

```powershell
Get-NetTCPConnection -LocalPort 8876 -ErrorAction SilentlyContinue
```

Either stop the owning process through your normal Windows administration procedure, or choose another positive port:

```powershell
$env:CODEX_GPT_BRIDGE_PORT = '8877'
npm run dev
```

Update the MCP client or external connector to use the same port. Do not assume that an existing listener is POLYSUB without checking its process and endpoint.

## `/healthz` works but MCP tools are not available

1. Confirm that the client is sending `POST /mcp`, not `GET /mcp`.
2. Confirm the Bearer token, unless the bridge is intentionally using loopback-only no-auth.
3. Confirm the client sends the media types required by its Streamable HTTP implementation; commonly:

   `Accept: application/json, text/event-stream`

4. Use the client’s MCP `initialize` and `tools/list` requests.
5. Expect the normal tools `bridge_status`, `codex_read`, `codex_run`, `codex_reply`, `codex_job_status`, `codex_completion_next`, and `codex_completion_ack`.

Optional completion tools/resources appear only when `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` is set before startup.

## The Tunnel does not connect

POLYSUB source does not start or configure a Tunnel client. First prove the local path:

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8876/diagnostics -Headers $headers
```

Then check the external client’s destination, credentials, provider profile, network policy, and logs separately. Do not put provider secrets in this repository. Provider connectivity is **Not yet verified** by the source package.

## A request is rejected for `cwd` or allowed roots

- `CODEX_GPT_BRIDGE_ROOTS` must contain existing absolute paths.
- A requested `cwd` must resolve inside one of those roots.
- When multiple roots are configured, the request must include `cwd`.
- `codex_read`, `codex_run`, and `codex_reply` run a sensitive-file preflight in the selected directory.

Inspect the redacted `/diagnostics` response and the effective environment of the process. Do not broaden the root just to bypass an error; select the smallest workspace needed for the task.

## A task cannot use `workspace-write`

Check both settings:

```powershell
$env:CODEX_GPT_BRIDGE_ALLOW_WRITE
$env:CODEX_GPT_BRIDGE_DEFAULT_SANDBOX
```

`workspace-write` requires `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`. `codex_read` remains read-only. `danger-full-access` is rejected by the bridge tools even if a startup flag is present.

## A task stops at the sensitive-file check

The preflight looks for sensitive-looking names such as `.env`, credential files, private-key extensions, and similar material under the selected root. Move those files outside the allowed root or choose a clean workspace. Do not disable the scan unless the risk is understood; the override is `CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1`.

Never include the file contents or a real secret in a bug report.

## A long-running task appears stuck

The bridge has a control-plane timeout and a separate fast-return window. A long Codex turn may continue after the initial MCP call returns `status: running`.

1. Keep the exact returned `taskId`.
2. Call `codex_job_status` with that same ID.
3. Continue until the status is `completed`, `failed`, or `timed_out`.

Do not start a second task to replace the first one unless the original has reached a terminal state.

## Completion callback or host integration is not visible

The optional completion path is disabled by default. To inspect the local capability:

1. Set `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` before startup.
2. Confirm the optional tools/resources appear in MCP `tools/list` and `resources/list`.
3. Use `codex_job_status` and `codex_completion_next` with the exact `taskId`.
4. Acknowledge only after the receiving host has safely processed the completion by calling `codex_completion_ack`.

The source can report host capability declarations and expose MCP Apps resources, but local tool output does not prove that a client host rendered a widget or inserted a message. Host-visible callback behavior is **Not yet verified** unless the client provides its own trace or visible result.

## `/diagnostics` returns `401`

Send the exact configured token as a Bearer token:

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8876/diagnostics -Headers $headers
```

If no-auth is intended, confirm `CODEX_GPT_BRIDGE_NO_AUTH=1` and a loopback `CODEX_GPT_BRIDGE_HOST`. Do not disable authentication on a non-loopback bind address.
