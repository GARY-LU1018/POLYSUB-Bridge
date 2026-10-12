# POLYSUB 操作說明

本文件只涵蓋目前 source package 實際提供的控制方式。

## 啟動與停止

在 repository 目錄設定必要環境變數後：

```powershell
# Development mode
npm run dev

# Compiled mode
npm run build
npm start
```

在執行中的視窗按 `Ctrl+C` 要求正常停止。bridge 會處理 `SIGINT` 與 `SIGTERM`，關閉 HTTP server 以及 Codex App Server 子程序。

這份 source package 沒有 Windows service、scheduled task、背景 updater 或 installer 控制。repository 外部是否另有 service wrapper 或 desktop launcher，**尚未驗證**。

## Health 與 diagnostics

Health 不需驗證，只表示 HTTP process 有回應：

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
```

除非開啟 no-auth，否則 diagnostics 需要 Bearer token：

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8876/diagnostics -Headers $headers
```

Diagnostics 會提供 listener、allowed roots、sandbox flags、Codex command 與 MCP transport 等 runtime/policy 資訊，但不能證明外部 Tunnel 或 client host 已接受請求。

## MCP endpoint 與 tools

MCP endpoint 接受 `POST /mcp`。client 必須使用設定好的 Bearer token 與它支援的 MCP media types；Streamable HTTP client 通常會送出 `Accept: application/json, text/event-stream`。

一般 tool 集合是：

`bridge_status`、`codex_read`、`codex_run`、`codex_reply`、`codex_job_status`、`codex_completion_next` 與 `codex_completion_ack`。

設定 `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` 後，會註冊額外的 completion resource 與 tools；它們仍取決於 MCP Apps host 的實作。

## Read-only 與 workspace-write

- 預設 sandbox 是 `read-only`。
- `codex_read` 永遠強制使用 `read-only`。
- 只有設定 `CODEX_GPT_BRIDGE_ALLOW_WRITE=1` 後，才能使用 `workspace-write`；request 必須明確選取，或把它設成 default。
- `danger-full-access` 會被 bridge tools 拒絕，不是支援的操作模式。
- 預設 approval policy 是 `never`；可接受的設定值是 `untrusted`、`on-request` 與 `never`。

請把 `workspace-write` 視為明確的風險變更，使用專用 allowed root，並在啟用前檢查 prompt。

## Allowed roots 與工作目錄

`CODEX_GPT_BRIDGE_ROOTS` 必須是以逗號分隔的一個或多個現有絕對路徑。bridge 會解析路徑，拒絕位於這些根目錄之外的 `cwd`。

- 只有一個 allowed root 時，操作可以省略 `cwd`，此時使用該 root。
- 有多個 root 時，呼叫端必須提供 `cwd`。
- `codex_read`、`codex_run` 與 `codex_reply` 執行前，bridge 會掃描選定目錄中的敏感檔案名稱。
- 掃描預設開啟。用 `CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1` 關閉是明確的風險決策，不建議用於共享或敏感工作區。

## Token 與 host binding

設定 `CODEX_GPT_BRIDGE_TOKEN` 後會啟用驗證。`CODEX_GPT_BRIDGE_NO_AUTH=1` 只在 loopback host 值下繞過 token。不要在非 loopback bind address 使用 no-auth。

`CODEX_GPT_BRIDGE_ALLOWED_HOSTS` 會傳給 MCP HTTP application 作為 host allowlist；它不會建立 identity provider，也不會取代 Bearer token。

## Tunnel 邊界

source package 不會啟動、設定或內附 Tunnel client。Tunnel ID、provider profile、provider credential、遠端 DNS、network policy 與外部 health 都不屬於 POLYSUB source 設定。

若使用外部 Tunnel，請先驗證本機 bridge，把 secrets 放在 repository 之外，並確認 destination 與驗證設定指向本機 `/mcp` endpoint。provider 端 connectivity 與 host 可見的 delivery，對這個 repository 都是**尚未驗證**。

## Completion 處理

長時間工作以呼叫端提供的 `taskId` 追蹤。若初始 tool call 回傳 `status: running`，請使用同一個 ID 輪詢 `codex_job_status`，直到回傳 `completed`、`failed` 或 `timed_out`。

完成結果也會保留在本機 completion outbox。位置由 `CODEX_GPT_BRIDGE_STATE_DIR` 控制；未設定時使用預設 Codex state 位置。請把這些 state 視為可能含敏感資料的 application data 保護。

除非設定 `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1`，否則選用 completion resource 關閉。source 可以提供 completion resource 與 host-capability report；本機結果不能證明外部 host 已顯示或插入 completion。

## 更新與 rollback

目前 package 沒有自動更新或 rollback 命令。

手動更新時：

1. 停止執行中的 process。
2. 若可能需要 rollback，先保留目前 source directory 與本機 state。
3. 以 `npm install` 安裝新 source 的 dependencies。
4. 執行 `npm run check`，再執行 `npm run build`。
5. 啟動更新後版本，重新檢查 `/healthz`、`/diagnostics` 與 `bridge_status`。

Rollback 時停止 process，還原先前已驗證的 source/dependency tree，再重做相同檢查。不要在仍可能需要 pending result 時刪除 completion outbox。

## 解除安裝與清理

停止 bridge；若不再需要便移除 source directory；另外檢查 `CODEX_GPT_BRIDGE_STATE_DIR` 或預設 completion outbox 所在目錄。未確認 owner 與用途前，不要刪除 state、credentials、Codex data 或外部 Tunnel profile。
