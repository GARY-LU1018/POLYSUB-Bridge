# POLYSUB 疑難排解

請依下列順序檢查。記錄指令輸出前，先移除 token、應保密的路徑與其他敏感資料。

## Bridge 無法啟動

1. 確認 runtime：

   ```powershell
   node --version
   npm --version
   ```

2. 安裝 dependencies 並執行專案檢查：

   ```powershell
   npm install
   npm run check
   ```

3. 依啟動錯誤檢查。常見設定問題包括：

   - 沒有 `CODEX_GPT_BRIDGE_TOKEN`，也沒有 loopback-only 的 no-auth 設定；
   - port 不是正整數；
   - root 不是絕對路徑或不存在；
   - 選了 `workspace-write` 卻沒有 `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`；
   - `codex` 命令不存在或不能使用。

POLYSUB 不會安裝 Codex。請用 `Get-Command codex` 個別確認，或設定 `CODEX_GPT_BRIDGE_CODEX`。

## Port `8876` 已被使用

先檢查 listener：

```powershell
Get-NetTCPConnection -LocalPort 8876 -ErrorAction SilentlyContinue
```

依正常 Windows 管理程序停止真正的 owner，或改用另一個正整數 port：

```powershell
$env:CODEX_GPT_BRIDGE_PORT = '8877'
npm run dev
```

MCP client 或外部 connector 也必須改用相同 port。不要只看到 listener 就假定它是 POLYSUB，應檢查 process 與 endpoint。

## `/healthz` 正常，但看不到 MCP tools

1. 確認 client 使用 `POST /mcp`，不是 `GET /mcp`。
2. 確認 Bearer token；除非 bridge 明確使用 loopback-only no-auth。
3. 確認 client 送出它的 Streamable HTTP 實作需要的 media types，常見值是：

   `Accept: application/json, text/event-stream`

4. 使用 client 的 MCP `initialize` 與 `tools/list` request。
5. 一般應看到 `bridge_status`、`codex_read`、`codex_run`、`codex_reply`、`codex_job_status`、`codex_completion_next` 與 `codex_completion_ack`。

只有啟動前設定 `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` 時，才會出現選用 completion tools/resource。

## Tunnel 無法連線

POLYSUB source 不會啟動或設定 Tunnel client。先證明本機路徑：

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8876/diagnostics -Headers $headers
```

接著分開檢查外部 client 的 destination、credentials、provider profile、network policy 與 logs。不要把 provider secrets 放進 repository。provider connectivity 對這份 source package 是**尚未驗證**。

## `cwd` 或 allowed roots 被拒絕

- `CODEX_GPT_BRIDGE_ROOTS` 必須是現有絕對路徑。
- 要求的 `cwd` 必須解析在其中一個 root 內。
- 設定多個 root 時，request 必須包含 `cwd`。
- `codex_read`、`codex_run` 與 `codex_reply` 會在選定目錄執行敏感檔案 preflight。

檢查刪除敏感值後的 `/diagnostics` 與 process 的有效環境。不要為了繞過錯誤就擴大 root，應選擇完成工作所需的最小 workspace。

## `workspace-write` 無法使用

檢查兩個設定：

```powershell
$env:CODEX_GPT_BRIDGE_ALLOW_WRITE
$env:CODEX_GPT_BRIDGE_DEFAULT_SANDBOX
```

`workspace-write` 需要 `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`。`codex_read` 仍然是 read-only。即使存在 startup flag，`danger-full-access` 仍會被 bridge tools 拒絕。

## 工作卡在敏感檔案檢查

Preflight 會在選定 root 下尋找 `.env`、credential 檔案、private-key 副檔名等敏感檔名。請把這些檔案移到 allowed root 之外，或改用乾淨 workspace。除非你已理解風險，不要關閉掃描；覆寫設定是 `CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1`。

Bug report 絕對不要包含檔案內容或真正的 secret。

## 長時間工作看起來卡住

Bridge 有 control-plane timeout，也有另外的 fast-return window。初始 MCP call 回傳 `status: running` 後，Codex turn 仍可能繼續執行。

1. 保留回傳的 exact `taskId`。
2. 使用同一個 ID 呼叫 `codex_job_status`。
3. 直到狀態成為 `completed`、`failed` 或 `timed_out`。

除非原工作已到 terminal state，否則不要另開第二個工作取代它。

## Completion callback 或 host integration 沒有顯示

選用 completion path 預設關閉。要檢查本機能力：

1. 啟動前設定 `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1`。
2. 確認 MCP `tools/list` 與 `resources/list` 出現選用 tools/resource。
3. 使用 exact `taskId` 呼叫 `codex_job_status` 與 `codex_completion_next`。
4. 確認 receiving host 已安全處理 completion 後，才呼叫 `codex_completion_ack`。

Source 可以回報 host capability declaration 並提供 MCP Apps resource，但本機 tool output 不能證明 client host 已 render widget 或插入訊息。除非 client 提供自己的 trace 或可見結果，host 可見的 callback 行為都屬於**尚未驗證**。

## `/diagnostics` 回傳 `401`

以 Bearer token 送出目前設定的 token：

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8876/diagnostics -Headers $headers
```

如果本來就要使用 no-auth，確認 `CODEX_GPT_BRIDGE_NO_AUTH=1` 且 `CODEX_GPT_BRIDGE_HOST` 是 loopback。不要在非 loopback binding 關閉驗證。
