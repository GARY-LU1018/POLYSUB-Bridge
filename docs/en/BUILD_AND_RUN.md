# Build and run POLYSUB on Windows

> **Current status: source preview / public source candidate**

This runbook takes the supplied source folder to a local POLYSUB Bridge, then
shows the boundary to an external Tunnel and MCP client. It does not provide an
installer, Tunnel client, provider credentials, or a ChatGPT account setup flow.

The local procedure proves the Bridge build, `/healthz`, `/mcp`, public tool
registration, and (with Codex installed) a real `codex_read` call. Local success
does not prove provider connectivity or ChatGPT-host delivery.

## 1. Obtain the source

Use the supplied source preview or the project repository/archive. This candidate
has no fixed download URL or portable release archive.

```powershell
Set-Location -LiteralPath "C:\path\to\polysub-public-source-candidate-20261012"
Test-Path -LiteralPath .\package.json
```

The second command must return `True`.

## 2. Install dependencies

Node.js 20 or newer and npm are required. Codex is installed separately.

```powershell
node --version
npm --version
npm install
```

`node_modules` is generated locally; do not commit or publish it.

## 3. Build the Bridge

Run the normal build-and-test check:

```powershell
npm run check
```

This runs `npm run build` and the included test suite, and creates `dist`.
If it fails, stop here and keep the complete error output for diagnosis. A
build-only rerun is `npm run build`.

## 4. Set environment variables

Run these commands in the same PowerShell window that will start the Bridge:

```powershell
$env:CODEX_GPT_BRIDGE_HOST = "127.0.0.1"
$env:CODEX_GPT_BRIDGE_PORT = "8876"
$env:CODEX_GPT_BRIDGE_TOKEN = (New-Guid).Guid
$env:CODEX_GPT_BRIDGE_ROOTS = (Get-Location).Path
$env:CODEX_GPT_BRIDGE_DEFAULT_SANDBOX = "read-only"
$env:CODEX_GPT_BRIDGE_APPROVAL_POLICY = "never"
```

`CODEX_GPT_BRIDGE_ROOTS` must contain existing absolute paths. Multiple roots
are comma-separated; then every MCP work call must provide an absolute `cwd`
inside one of them. Use a different project path when the source folder is not
the project Codex should inspect:

```powershell
$env:CODEX_GPT_BRIDGE_ROOTS = "C:\path\to\project-one,C:\path\to\project-two"
```

The default is read-only. `codex_read` always forces read-only. Write mode also
requires `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`; `danger-full-access` is not exposed
by the public Bridge tools.

The default Codex command is `codex`. If it has another path, set it explicitly:

```powershell
$env:CODEX_GPT_BRIDGE_CODEX = "C:\path\to\codex.exe"
Get-Command $env:CODEX_GPT_BRIDGE_CODEX
```

Keep the token outside the repository. Sensitive-file preflight is enabled and
can refuse Codex work when the selected root contains `.env`, private keys, or
other private-key material.

## 5. Start the Bridge

```powershell
npm start
```

Expected output includes:

```text
codex-gpt-bridge listening on http://127.0.0.1:8876/mcp (Bearer token required)
```

Keep this foreground window open. This source package does not install a
Windows service, scheduled task, desktop launcher, updater, or Tunnel.

## 6. Check local health and diagnostics

Open a second PowerShell window. Health is unauthenticated and only proves
that the HTTP process responds:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8876/healthz"
```

The response should contain `ok: True` and `name: codex-gpt-bridge`.
Diagnostics require the token and show effective listener, roots, policy,
Codex command, and MCP transport:

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod -Uri "http://127.0.0.1:8876/diagnostics" -Headers $headers
```

## 7. Connect the external Tunnel and MCP client

The local MCP endpoint is:

```text
http://127.0.0.1:8876/mcp
```

For a same-machine MCP client, use that URL and the Bearer token. For an
external Tunnel, use the provider's own procedure and:

1. Forward the Tunnel destination to the local `/mcp` endpoint and preserve the
   `/mcp` path.
2. Keep provider credentials, public DNS, and Tunnel configuration outside this
   repository.
3. Give the MCP client the provider's public HTTPS URL and matching auth mode.

This source package does not configure or start a Tunnel. `CODEX_GPT_BRIDGE_NO_AUTH=1` is only
valid when the Bridge remains on a loopback host; use it only when a trusted
Tunnel deliberately supplies the auth boundary. Do not bind no-auth to a
non-loopback host. ChatGPT/MCP host UI and account eligibility are external and
are not proven by this repository.

## 8. Test MCP connection and tools

This PowerShell smoke test uses the actual Streamable HTTP endpoint. It should
return JSON-RPC results for `initialize`, `tools/list`, and `bridge_status`.

```powershell
$mcpUrl = "http://127.0.0.1:8876/mcp"
$mcpHeaders = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN"; Accept = "application/json, text/event-stream" }

function Invoke-McpRpc([int]$Id, [string]$Method, [hashtable]$Params) {
  $body = @{ jsonrpc = "2.0"; id = $Id; method = $Method; params = $Params } |
    ConvertTo-Json -Depth 10
  Invoke-WebRequest -Uri $mcpUrl -Method Post -Headers $mcpHeaders `
    -ContentType "application/json" -Body $body
}

(Invoke-McpRpc 1 "initialize" @{
  protocolVersion = "2025-06-18"; capabilities = @{}
  clientInfo = @{ name = "polysub-build-run-smoke"; version = "0.1.0" }
}).Content
(Invoke-McpRpc 2 "tools/list" @{}).Content
(Invoke-McpRpc 3 "tools/call" @{ name = "bridge_status"; arguments = @{} }).Content
```

Look for a JSON-RPC result, not only HTTP 200. The response may be JSON or
SSE-formatted, depending on client negotiation. `tools/list` should include
`bridge_status`, `codex_read`, `codex_run`, `codex_reply`, and job/completion
tools.

## 9. Confirm the Bridge can call Codex

`bridge_status` does not start Codex. Use the implemented read-only tool for a
real upstream smoke call:

```powershell
$taskId = "polysub-build-run-" + ([guid]::NewGuid().ToString("N"))
(Invoke-McpRpc 4 "tools/call" @{
  name = "codex_read"
  arguments = @{ taskId = $taskId; cwd = (Get-Location).Path
    prompt = "Read this project and return exactly CODEX_BRIDGE_SMOKE_OK. Do not modify files." }
}).Content
```

A completed result containing the marker proves that the Bridge reached the
configured `codex app-server` command and returned a Codex result. If the result
is `status: running`, poll with the same task ID until it is `completed`,
`failed`, or `timed_out`:

```powershell
(Invoke-McpRpc 5 "tools/call" @{
  name = "codex_job_status"; arguments = @{ taskId = $taskId }
}).Content
```

An upstream failure points first to the Codex command/App Server mode, selected
`cwd`, or sensitive-file preflight; it does not by itself prove a Tunnel fault.

## Evidence boundary

- `/healthz`, `/diagnostics`, `tools/list`, and `bridge_status` prove local
  Bridge behavior only.
- A successful `codex_read` proves the local Bridge-to-Codex path only.
- Tunnel connectivity, public DNS, provider authentication, ChatGPT account
  eligibility, Widget mounting, and host-visible completion remain external
  checks.

For full operating and security boundaries, read [Operations](OPERATIONS.md),
[Security](../../SECURITY.md), and [Architecture](ARCHITECTURE.md).
