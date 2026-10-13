# Security

POLYSUB starts a local process that can ask Codex to inspect or, when explicitly enabled, modify files under configured workspace roots. Treat the bridge as a privileged local integration.

## Security model

- The default bind address is loopback: `127.0.0.1`.
- Bearer authentication is required by default.
- No-auth mode is accepted only for loopback host values.
- Allowed roots must be existing absolute paths, and requested working directories must remain inside them.
- The default sandbox is `read-only`.
- `workspace-write` requires `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`.
- `danger-full-access` is not exposed through bridge tools.
- Sensitive-file scanning is enabled before Codex work by default.
- The optional completion UI is disabled unless `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` is set.

These controls reduce risk; they do not make an untrusted prompt or an untrusted local client safe by themselves.

## Secrets and local state

Keep tokens, provider credentials, private keys, Tunnel profiles, Codex credentials, and local state outside the repository. The completion outbox is written to `CODEX_GPT_BRIDGE_STATE_DIR` when set, or to the default Codex state location. Treat it as potentially sensitive application data.

Do not commit:

- `.env` files or environment dumps;
- bearer tokens, API keys, cookies, or provider credentials;
- private keys or certificate bundles that are not intended for public distribution;
- local account names, machine-specific absolute paths, or diagnostic exports containing them;
- runtime directories, logs, completion state, `node_modules`, `dist`, or large binary packages;
- real user data or unredacted error reports.

The bridge's sensitive-file preflight is a runtime guard, not a replacement for repository review.

## HTTP, MCP, and diagnostics boundaries

- `GET /healthz` is an unauthenticated liveness response. It does not prove
  authentication, Tunnel routing, MCP access, Codex availability, or a
  host-visible callback.
- `POST /mcp` and `GET /diagnostics` use the configured Bearer token when
  authentication is enabled. The MCP `GET` and `DELETE` routes are rejected;
  the OAuth metadata probes return a local not-configured response rather than
  configuring an external provider.
- `/diagnostics` is operationally sensitive. It may report the process
  executable and entrypoint, project root, owner, process identifiers and
  times, listener, allowed roots, configured Codex command, build/provenance
  hashes, Git identifiers, and MCP authentication mode. Keep it behind the
  same trusted local boundary as the Bridge.
- The authenticated `bridge_status` tool reports configured roots, sandbox
  flags, session/job counts, and upstream tool names; it does not read project
  files. The current core MCP tools are `bridge_status`, `codex_read`,
  `codex_run`, `codex_reply`, `codex_job_status`, `codex_completion_next`,
  and `codex_completion_ack`. There is no independent direct-file-read tool;
  `codex_read` starts a read-only Codex inspection.
- `codex_run` may use `workspace-write` only when explicitly enabled by
  `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`. `danger-full-access` is rejected by the
  Bridge tool path even if a configuration value permits the mode. The
  `CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN` setting can explicitly disable the
  default sensitive-file preflight and should be treated as a deliberate
  reduction of the safety boundary.
- When enabled, Blue-Wake adds MCP Apps resources and bounded completion tools;
  it does not create a second execution path. Durable completion remains in
  the local outbox until the authenticated completion acknowledgement removes
  it from future reads. External host rendering and message delivery remain
  unverified by this source package.

## Reporting a vulnerability

Please do not open a public issue for an unpatched security vulnerability. Once this project has a GitHub repository, use GitHub private vulnerability reporting or a GitHub Security Advisory for confidential reports. There is no dedicated security email address in this source package.

Include the affected version or commit, operating system, configuration surface, reproduction steps, impact, and a safe contact channel. Remove all secrets and private paths from the report.

## Scope limits

The source package does not configure or verify external Tunnel infrastructure, provider access, MCP client policy, or host-visible callback behavior. Those systems require their own security review.
