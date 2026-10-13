# Changelog

This file records user-facing changes. It does not record private development history.

## 0.1.0 — Not yet released

### Added

- Local Streamable HTTP MCP endpoint at `POST /mcp`.
- `bridge_status`, `codex_read`, `codex_run`, `codex_reply`, and `codex_job_status` tools.
- Durable completion read/acknowledgement tools: `codex_completion_next` and `codex_completion_ack`.
- Loopback-first binding, Bearer token authentication, allowed-root validation, sandbox selection, and sensitive-file preflight.
- `/healthz` and authenticated `/diagnostics` endpoints.
- Optional MCP Apps completion resources, disabled by default.
- Source build and test scripts: `npm run build`, `npm run test`, and `npm run check`.

### Known limitations

- No installer or portable package is included or formally released.
- Tunnel client configuration and provider connectivity are outside this package and are not verified here.
- Host-visible callback and MCP Apps rendering depend on the external client host and are not verified by local source checks alone.
- `LICENSE` records the project attribution as `Copyright (c) 2026 GARY LU`; public-release approval and full third-party notice closure remain separate.
