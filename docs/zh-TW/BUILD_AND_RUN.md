# 在 Windows 建置與執行 POLYSUB

> **目前狀態：source preview／公開原始碼候選版**

這份 runbook 從取得 source folder 開始，建立本機 POLYSUB Bridge，再說明外部
Tunnel 與 MCP client 的邊界。不提供 installer、Tunnel client、provider
credentials 或 ChatGPT 帳號設定流程。

本機流程會驗證 Bridge build、`/healthz`、`/mcp`、公開 tool 註冊，以及在另外
安裝 Codex 後執行真正的 `codex_read` call。本機成功不等於 provider connectivity
或 ChatGPT host delivery 已成功。

## 1. 取得 source

使用專案提供的 source preview 或 repository／archive。此候選版沒有固定下載
URL，也沒有 portable release archive。

```powershell
Set-Location -LiteralPath "C:\path\to\polysub-public-source-candidate-20261012"
Test-Path -LiteralPath .\package.json
```

第二個命令必須回傳 `True`。

## 2. 安裝 dependencies

需要 Node.js 20 或更新版本以及 npm。Codex 是另外安裝的程式。

```powershell
node --version
npm --version
npm install
```

`node_modules` 是本機產生的資料夾，不要 commit 或發布。

## 3. 建置 Bridge

執行一般 build-and-test check：

```powershell
npm run check
```

這會執行 `npm run build` 與內附 test suite，並建立 `dist`。若失敗，先停止並
保留完整錯誤輸出；只重新 build 時使用 `npm run build`。

## 4. 設定環境變數

在準備啟動 Bridge 的同一個 PowerShell 視窗執行：

```powershell
$env:CODEX_GPT_BRIDGE_HOST = "127.0.0.1"
$env:CODEX_GPT_BRIDGE_PORT = "8876"
$env:CODEX_GPT_BRIDGE_TOKEN = (New-Guid).Guid
$env:CODEX_GPT_BRIDGE_ROOTS = (Get-Location).Path
$env:CODEX_GPT_BRIDGE_DEFAULT_SANDBOX = "read-only"
$env:CODEX_GPT_BRIDGE_APPROVAL_POLICY = "never"
```

`CODEX_GPT_BRIDGE_ROOTS` 必須是一個或多個已存在的絕對路徑。多個 root 以逗號
分隔；之後每個 MCP work call 都要提供位於其中一個 root 內的絕對 `cwd`：

```powershell
$env:CODEX_GPT_BRIDGE_ROOTS = "C:\path\to\project-one,C:\path\to\project-two"
```

預設是 read-only；`codex_read` 永遠強制 read-only。`workspace-write` 還需要
`CODEX_GPT_BRIDGE_ALLOW_WRITE=1`；公開 Bridge tools 不提供 `danger-full-access`。

預設 Codex command 是 `codex`。若 executable 在其他位置，明確設定：

```powershell
$env:CODEX_GPT_BRIDGE_CODEX = "C:\path\to\codex.exe"
Get-Command $env:CODEX_GPT_BRIDGE_CODEX
```

Token 要放在 repository 外。預設 sensitive-file preflight 會在 root 含有
`.env`、private key 或其他 private-key material 時拒絕 Codex work。

## 5. 啟動 Bridge

```powershell
npm start
```

預期輸出包含：

```text
codex-gpt-bridge listening on http://127.0.0.1:8876/mcp (Bearer token required)
```

保持這個前景視窗開啟。這份 source package 不會安裝 Windows service、scheduled
task、desktop launcher、updater，也不會在背景啟動 Tunnel。

## 6. 檢查本機 health 與 diagnostics

開啟第二個 PowerShell 視窗。Health 不需要 authentication，只證明 HTTP process
正在回應：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8876/healthz"
```

回應應包含 `ok: True` 與 `name: codex-gpt-bridge`。Diagnostics 需要 token，會
顯示有效 listener、roots、policy、Codex command 與 MCP transport：

```powershell
$headers = @{ Authorization = "Bearer $env:CODEX_GPT_BRIDGE_TOKEN" }
Invoke-RestMethod -Uri "http://127.0.0.1:8876/diagnostics" -Headers $headers
```

## 7. 接上外部 Tunnel 與 MCP client

本機 MCP endpoint 是：

```text
http://127.0.0.1:8876/mcp
```

同機 MCP client 使用這個 URL 與 Bearer token。若需要外部 Tunnel，依 provider
文件操作，並且：

1. 將 Tunnel destination 轉送到本機 `/mcp` endpoint，保留 `/mcp` path。
2. 把 provider credentials、public DNS 與 Tunnel configuration 放在本
   repository 外。
3. 對 MCP client 提供 provider 的 public HTTPS URL，以及相符的 auth mode。

此 source package 不會設定或啟動 Tunnel。`CODEX_GPT_BRIDGE_NO_AUTH=1` 只有在 Bridge 維持
loopback host 時有效；只在受信任 Tunnel 明確提供 auth boundary 時使用。不要把
no-auth 綁到 non-loopback host。ChatGPT/MCP host UI 與帳號 eligibility 是外部
條件，本 repository 無法證明。

## 8. 測試 MCP connection 與 tools

以下 PowerShell smoke test 直接使用 Streamable HTTP endpoint，測試
`initialize`、`tools/list` 與 `bridge_status`：

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

請找 JSON-RPC result，不要只看 HTTP 200。回應依 client negotiation 可能是 JSON
或 SSE 格式；`tools/list` 應包含 `bridge_status`、`codex_read`、`codex_run`、
`codex_reply` 以及 job/completion tools。

## 9. 確認 Bridge 可以呼叫 Codex

`bridge_status` 不會啟動 Codex。用 read-only tool 做真正的 upstream smoke call：

```powershell
$taskId = "polysub-build-run-" + ([guid]::NewGuid().ToString("N"))
(Invoke-McpRpc 4 "tools/call" @{
  name = "codex_read"
  arguments = @{ taskId = $taskId; cwd = (Get-Location).Path
    prompt = "Read this project and return exactly CODEX_BRIDGE_SMOKE_OK. Do not modify files." }
}).Content
```

completed result 含指定 marker，就證明 Bridge 到達設定的 `codex app-server`
command 並回傳 Codex result。若狀態是 `status: running`，使用同一個 task ID 輪詢到
`completed`、`failed` 或 `timed_out`：

```powershell
(Invoke-McpRpc 5 "tools/call" @{
  name = "codex_job_status"; arguments = @{ taskId = $taskId }
}).Content
```

Upstream failure 應先檢查 Codex command/App Server mode、`cwd` 與 sensitive-file
preflight；它本身不等於 Tunnel fault。

## 證據邊界

- `/healthz`、`/diagnostics`、`tools/list` 與 `bridge_status` 只證明本機 Bridge。
- 成功的 `codex_read` 只證明本機 Bridge-to-Codex path。
- Tunnel connectivity、public DNS、provider authentication、ChatGPT 帳號
  eligibility、Widget mounting 與 host-visible completion 仍需外部檢查。

完整操作與安全邊界請參考 [操作說明](OPERATIONS.md)、[安全性](../../SECURITY.zh-TW.md)
與 [Architecture](ARCHITECTURE.md)。
