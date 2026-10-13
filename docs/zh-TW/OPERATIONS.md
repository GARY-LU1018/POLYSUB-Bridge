# POLYSUB 操作說明

本文件是給「已經設定好的 Bridge/Tunnel 連線」使用的日常操作說明：如何啟動、確認哪一層可達、派工作，以及把完成結果追蹤回原本的對話。安裝、依賴、build 與詳細錯誤分析請看 [BUILD_AND_RUN](BUILD_AND_RUN.md) 和 [TROUBLESHOOTING](TROUBLESHOOTING.md)。

這個 source package 不會啟動或設定外部 Tunnel。Tunnel 與 Bridge 的控制請使用既有、由使用者管理的 launcher 或 provider 流程。不要把本機 health 有回應，當成 ChatGPT 已經能連到服務的證明。

## 每日啟動順序

電腦或服務曾經停止時，依這個順序操作：

1. 用既有 launcher 啟動本機 Bridge。保留原本的 listener、驗證模式、allowed roots 與 state directory 設定。
2. 用 `/healthz` 檢查本機 Bridge；如果目前設定包含需要驗證的 diagnostics，也一併檢查 `/diagnostics`。
3. 依既有 provider 流程啟動或接回外部 Tunnel。destination 必須指向 Bridge 的 `/mcp` endpoint，保留 path 與原本的驗證邊界。
4. 在 ChatGPT 或 MCP client 連到設定好的 Tunnel URL，執行 MCP handshake，並由 client 端確認 `initialize`、`tools/list` 和 `bridge_status`。
5. 以上檢查通過後，才送出真正的唯讀 probe 或工作。

source package 沒有 Windows service、scheduled task、背景 updater 或 installer 控制。repository 外部提供的 launcher，這些文件**尚未驗證**。

## 如何確認已連線

以下檢查回答的是不同問題：

| 檢查 | 能證明什麼 | 不能證明什麼 |
| --- | --- | --- |
| `/healthz` | 本機 HTTP process 有回應。 | Tunnel routing、MCP 驗證、Codex 或 ChatGPT delivery。 |
| `/diagnostics` | 回報本機 listener、policy、roots、Codex command 和 MCP transport。 | 外部 client 已接受 request。 |
| ChatGPT/MCP 執行 `initialize` 和 `tools/list` | client 已到達 MCP endpoint，並收到預期的 protocol/tool surface。 | Codex 一定能完成工作，或 Widget 一定會 render。 |
| ChatGPT/MCP 執行 `bridge_status` | client 能呼叫 Bridge 並收到目前狀態。 | Codex turn 成功，或 host 已看見 completion。 |

一般 tool surface 是 `bridge_status`、`codex_read`、`codex_run`、`codex_reply`、`codex_job_status`、`codex_completion_next` 和 `codex_completion_ack`。只有設定 `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE=1` 時才會出現 Blue-Wake resource 與 tools，而且仍取決於 MCP Apps host。

## 派工作與查看 task 狀態

每個 operation 都給一個新的、由呼叫端提供且穩定的 `taskId`。狀態、completion 和 Blue-Wake continuation 都使用同一個 ID。

- 要做不修改檔案的 project inspection，使用 `codex_read`。它會強制以 `read-only` 模式呼叫本機 Codex。
- 只有在工作已明確授權、而且目前 sandbox policy 允許時，才使用 `codex_run` 執行工作或修改。送出前檢查 `cwd`、prompt 與 sandbox。
- 要延續同一個 Codex session，使用回傳的 `threadId` 呼叫 `codex_reply`；它不取代原本的 task ID。
- `cwd` 必須位於已設定的 allowed root 內。有多個 root 時，明確提供絕對路徑 `cwd`。
- 如果呼叫回傳 `status: running`，用同一個 `taskId` 輪詢 `codex_job_status`。不要因為第一次呼叫快速返回，就再啟動一份相同工作。
- 只有在狀態是 `completed`、`failed` 或 `timed_out` 時停止輪詢，並記錄實際回傳的狀態。

`workspace-write` 是明確的風險變更，只有 Bridge policy 允許時才能使用。`danger-full-access` 不是支援的操作模式。敏感檔案 preflight 仍是工作呼叫的一部分。

## Completion、outbox 與 Blue-Wake/Widget 回傳

一般回傳路徑是：

`Codex 完成 → completion 寫入 durable outbox → ChatGPT/MCP 取回結果 → 結果顯示在對話或 Widget host`

整條路徑都使用同一個 `taskId`。

1. 工作還在執行時，用 `codex_job_status` 輪詢到 terminal status。
2. 使用 `codex_completion_next` 讀取 durable result，提供完全相同的 `taskId`；若要接續 sequence，也提供上次看到的 `after`。讀取不會消耗 result。
3. 只有在 ChatGPT 或接收端安全處理結果後，才用 `codex_completion_ack` 確認。確認後，該結果會從後續 durable read 移除。
4. 若啟用 Blue-Wake，長時間呼叫回應可能會掛載 A-side handoff 和 B-side completion receiver。receiver 仍沿用現有 completion path，不會啟動第二份工作，也不取代 `codex_job_status`。
5. 本機 outbox result、resource URI 或 host-capability report 本身，都不能證明 ChatGPT 已插入訊息或 Widget 已 render。只有 client host 提供可見結果或 trace，才可確認 host-visible delivery。

Outbox 位置由 `CODEX_GPT_BRIDGE_STATE_DIR` 控制；未設定時使用預設 Codex state 位置。請把它當成 application data 保護，不要刪除仍可能需要的 pending result。

## 直接讀檔：目前的邊界

目前 Bridge tool surface **沒有確認存在獨立的直接讀檔工具**。不要把 `codex_read` 寫成直接讀檔：它會啟動唯讀 Codex inspection，而且需要 `taskId`。

如果未來或另一個部署中的 Bridge 出現獨立命名的 file-read tool，先在該連線的 `tools/list` response 中確認，再遵守它對 path、root、大小與敏感檔案的完整規則。只有在工具實際列出後，才可用它處理不需要 Codex turn 的簡單讀取。在此之前，這個 package 的讀取需求請使用 `codex_read`，不要宣稱已有 direct-read capability。

## 快速判斷卡在哪一段

從第一個失敗的邊界開始判斷，不要一次重啟所有層。

| 第一個失敗檢查 | 最可能的邊界 | 下一個快速檢查 |
| --- | --- | --- |
| ChatGPT/MCP 看不到 `tools/list` 或無法呼叫 `bridge_status` | ChatGPT/MCP 設定、Tunnel route 或驗證 | 從 client 測試 Tunnel URL 和 `/mcp` path，再與本機 `/healthz` 對照。 |
| 本機 `/healthz` 失敗 | Bridge process 或本機 listener | 使用既有 Bridge control，檢查 `/diagnostics`；先不要判定是 Tunnel 問題。 |
| 本機 health 成功，但 client 無法到達 MCP | Tunnel destination、provider auth、DNS 或 client 設定 | 確認 Tunnel 指向正確 `/mcp` endpoint，client 使用相同驗證模式。 |
| `bridge_status` 成功，但 `codex_read`/`codex_run` 失敗 | Codex command/App Server、`cwd`、sandbox 或敏感檔案 preflight | 檢查 task error 與 selected allowed root；不要直接標成 Tunnel 失敗。 |
| Job 已執行或結束，但對話沒有結果 | Job polling、completion retrieval 或 outbox correlation | 用相同 `taskId` 輪詢 `codex_job_status`，再讀 `codex_completion_next`；不要提早 ack。 |
| Outbox 有結果，但 Blue-Wake/Widget 沒顯示 | MCP Apps host capability 或 host rendering/delivery | 保留 durable result，查看 host 自己的 trace；在可見確認前視為 Widget insertion 未驗證。 |

詳細錯誤訊息與復原程序請放在 [TROUBLESHOOTING](TROUBLESHOOTING.md)。source package 本身不能證明 provider connectivity、ChatGPT account eligibility、Widget mounting 或 host-visible completion。
