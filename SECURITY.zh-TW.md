# POLYSUB 安全性

POLYSUB 會啟動一個本機 process，讓 Codex 檢查，或在明確啟用時修改，設定工作區根目錄下的檔案。請把 Bridge 視為具備本機特權的整合層。

## 安全模型

- 預設 bind address 是 loopback：`127.0.0.1`。
- 預設要求 Bearer authentication。
- 只有在 loopback host 值下才接受 no-auth mode。
- Allowed roots 必須是已存在的絕對路徑，要求使用的工作目錄也必須留在其中。
- 預設 sandbox 是 `read-only`。
- `workspace-write` 需要 `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`。
- Bridge tools 不提供 `danger-full-access`。
- 預設會在 Codex 工作開始前啟用敏感檔案掃描。
- 除非設定 `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1`，否則選用的 completion UI 會保持停用。

這些控制項可以降低風險，但不能單靠它們讓不受信任的 prompt 或本機 client 變得安全。

## Secrets 與本機狀態

請把 token、provider credentials、private keys、Tunnel profiles、Codex credentials 與本機狀態放在 repository 外。若設定了 `CODEX_GPT_BRIDGE_STATE_DIR`，completion outbox 會寫入該位置；未設定時使用預設 Codex state 位置。請把它視為可能含有敏感資料的 application data。

請勿提交：

- `.env` 檔案或環境變數匯出內容；
- bearer tokens、API keys、cookies 或 provider credentials；
- 不應公開發佈的 private keys 或 certificate bundles；
- 本機帳號名稱、機器專用的絕對路徑，或含有這些資料的 diagnostics 匯出內容；
- runtime directories、logs、completion state、`node_modules`、`dist` 或大型 binary packages；
- 真實使用者資料或未去識別化的錯誤報告。

Bridge 的敏感檔案 preflight 是 runtime guard，不能取代 repository review。

## HTTP、MCP 與 diagnostics 邊界

- `GET /healthz` 是未驗證的 liveness response。它不能證明 authentication、Tunnel routing、MCP access、Codex availability 或 host-visible callback。
- `POST /mcp` 與 `GET /diagnostics` 在啟用 authentication 時使用設定好的 Bearer token。MCP 的 `GET` 與 `DELETE` routes 會被拒絕；OAuth metadata probes 會回傳本機未設定的 response，不會設定外部 provider。
- `/diagnostics` 在操作上屬於敏感資料。它可能回報 process executable 與 entrypoint、project root、owner、process identifiers 與時間、listener、allowed roots、設定的 Codex command、build/provenance hashes、Git identifiers，以及 MCP authentication mode。請讓它留在與 Bridge 相同的受信任本機邊界內。
- 已驗證的 `bridge_status` tool 會回報設定的 roots、sandbox flags、session/job counts 與 upstream tool names；它不會讀取 project files。目前核心 MCP tools 是 `bridge_status`、`codex_read`、`codex_run`、`codex_reply`、`codex_job_status`、`codex_completion_next` 與 `codex_completion_ack`。沒有獨立的 direct-file-read tool；`codex_read` 會啟動唯讀 Codex inspection。
- `codex_run` 只有在明確設定 `CODEX_GPT_BRIDGE_ALLOW_WRITE=1` 時才能使用 `workspace-write`。即使設定值允許，Bridge tool path 仍會拒絕 `danger-full-access`。`CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN` 可以明確停用預設的敏感檔案 preflight，應視為刻意降低安全邊界。
- 啟用時，Blue-Wake 會加入 MCP Apps resources 與受界定的 completion tools；它不會建立第二條 execution path。Durable completion 會留在本機 outbox，直到已驗證的 completion acknowledgement 將它從後續讀取中移除。外部 host rendering 與 message delivery 仍未由此 source package 驗證。

## 回報弱點

請不要為尚未修補的安全弱點開立公開 issue。等本專案建立 GitHub repository 後，請使用 GitHub private vulnerability reporting 或 GitHub Security Advisory 進行機密回報。此 source package 沒有專用的 security email address。

請提供受影響的版本或 commit、作業系統、設定面、重現步驟、影響，以及安全的聯絡管道。請從回報中移除所有 secrets 與 private paths。

## 範圍限制

此 source package 不會設定或驗證外部 Tunnel infrastructure、provider access、MCP client policy 或 host-visible callback 行為。這些系統需要各自進行安全審查。
