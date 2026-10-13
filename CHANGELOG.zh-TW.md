# 變更紀錄

本檔案記錄使用者可見的變更，不記錄私人開發歷史。

## 0.1.0——尚未發佈

### 新增

- `POST /mcp` 本機 Streamable HTTP MCP endpoint。
- `bridge_status`、`codex_read`、`codex_run`、`codex_reply` 與 `codex_job_status` tools。
- Durable completion 讀取／確認 tools：`codex_completion_next` 與 `codex_completion_ack`。
- 以 loopback 優先的 bind、Bearer token authentication、allowed-root validation、sandbox selection 與敏感檔案 preflight。
- `/healthz` 與已驗證的 `/diagnostics` endpoints。
- 選用的 MCP Apps completion resources，預設停用。
- Source build 與 test scripts：`npm run build`、`npm run test` 與 `npm run check`。

### 已知限制

- 沒有包含或正式發佈 installer 或 portable package。
- Tunnel client 設定與 provider connectivity 不在本 package 範圍內，也未在此驗證。
- Host-visible callback 與 MCP Apps rendering 取決於外部 client host，不能只靠本機 source checks 驗證。
- `LICENSE` 記錄專案 attribution 為 `Copyright (c) 2026 GARY LU`；公開發佈核准與完整第三方通知閉合仍是分開的事項。
