# POLYSUB Remote Candidate 繁體中文圖文操作手冊（草稿）

> 這是一份依目前 `6fixes-final` Candidate 的實際安裝器、控制視窗與既有文件整理的草稿。專案目前沒有可用的實機截圖資產，因此本文件只使用可由現有 UI／程式碼確認的文字與流程；所有圖片位置都明確標成「待插入實機截圖」，不使用假截圖。

## 0. 使用前先了解

產品流程是：

`手機／外部 ChatGPT → 公開 Tunnel → Candidate Bridge → 本機 Codex → completion／Blue-Wake → 原始 ChatGPT 對話`

本 Candidate 的本機 Bridge 使用 `127.0.0.1:8877`，Tunnel health 使用 `127.0.0.1:6804`。本地 Start 或 health 成功，不等於外部 ChatGPT、provider Tunnel、Codex completion 或手機端回傳已完成驗收。

## 1. 安裝

1. 執行 `POLYSUB-Remote-Candidate-Installer-20261013.exe`。
2. 在 **Welcome** 頁閱讀說明。
3. 在 **Install location** 頁選擇安裝位置；按 **Browse...** 可選擇上層資料夾，安裝器會使用 `POLYSUB Remote Candidate` 子資料夾。
4. 在 **Folders and access** 頁加入一個或多個 **Allowed Folder**。可按 **Add folder...**，並選擇 **Read-only (recommended)** 或 **Read/Write (workspace-write)**。
5. 在 **Secure Tunnel** 頁填入 **Tunnel ID** 與 **Runtime API key / credential**。頁面上的 **Get Tunnel ID**、**Create Runtime API Key**、**Set up ChatGPT MCP** 只會開啟對應網站，不會代替登入或帳號授權。
6. 在 **Codex** 頁按 **Detect**；若找不到，按 **Browse...** 選擇 `codex.exe`、`.cmd`、`.bat` 或可證明能啟動 Codex 的 launcher。
7. 在 **Validate and finish** 頁按 **Run validation**，確認本機檢查通過後按 **Install and finish**。
8. 安裝完成後，控制視窗會開啟，但不會自動 Start。

### 待插入的實機截圖

- `IMG-01-installer-welcome.png`：實際 installer 的 **Welcome** 頁。
- `IMG-02-installer-location.png`：**Install location** 頁，包含安裝路徑與 **Browse...**。
- `IMG-03-installer-folders.png`：**Folders and access** 頁，包含 Allowed Folder 與兩種 Access mode。
- `IMG-04-installer-tunnel.png`：**Secure Tunnel** 頁，包含 Tunnel ID、Runtime API key 與三個外部入口按鈕。
- `IMG-05-installer-codex.png`：**Codex** 頁，包含 **Detect**、**Browse...** 與驗證結果。
- `IMG-06-installer-finish.png`：**Validate and finish** 頁，包含驗證結果與 **Install and finish**。

## 2. Settings

在 **POLYSUB Remote Candidate** 控制視窗按 **Settings**。目前實際欄位是：

- **Allowed Folder(s), separated by ;**：一個或多個已授權資料夾，使用分號分隔；可按 **Browse...**。
- **Access Mode**：**Read-only** 或 **Workspace-write**。
- **Codex path**：Codex 指令或完整 launcher 路徑；可按 **Browse...**。
- **Tunnel ID**。
- **Runtime API Key**。
- **Save** 與 **Cancel**。

修改 Allowed Folder 或 Access Mode 後，依序按 **Save → Reset**，再回 ChatGPT 重新整理／重置 MCP，讓外部 client 重新取得工具與權限資訊。

### 待插入的實機截圖

- `IMG-07-settings.png`：實際 **POLYSUB Settings** 視窗，完整顯示 Allowed Folder、Access Mode、Codex path、Tunnel ID、Runtime API Key、Save／Cancel。

## 3. Start / Stop / Reset / Status

控制視窗目前提供七個按鈕：**Start**、**Stop**、**Reset**、**Status**、**Settings**、**Open Logs**、**Uninstall**。

- **Start**：啟動 Candidate Bridge，再啟動 Candidate Tunnel；兩個子程序會使用可見的 Candidate console。
- **Stop**：停止 Candidate Bridge 與 Candidate Tunnel。
- **Reset**：先 Stop，再重新 Start；修改 Settings 後使用此按鈕。
- **Status**：查看 `Bridge: Running/Stopped` 與 `Tunnel: Running/Stopped`。
- **Open Logs**：開啟本機 log 資料夾。
- **Uninstall**：先確認是否移除 Candidate，再選擇是否刪除使用者設定、Tunnel reference、logs 與 credential。

Start／Stop／Reset 在背景執行時，控制視窗保持可操作；不要因為按鈕快速返回就重複啟動同一個動作。

### 待插入的實機截圖

- `IMG-08-main-launcher-stopped.png`：控制視窗初始或停止狀態。
- `IMG-09-main-launcher-running.png`：Start 後的控制視窗與 Candidate console；需看得到 Bridge／Tunnel 的實際標題。
- `IMG-10-settings-save-reset.png`：修改設定後 Save，再按 Reset 的實機流程畫面。
- `IMG-11-uninstall-confirmation.png`：Uninstall 的兩次確認對話框。

## 4. 在 ChatGPT 建立自訂 MCP

安裝器中的 **Set up ChatGPT MCP** 只會開啟 ChatGPT 設定頁。實際建立流程依目前已驗證的產品流程：

1. 先在本機控制視窗按 **Start**，確認 Bridge 與 Tunnel 顯示 Running。
2. 在 ChatGPT 開啟設定中的自訂 MCP／Apps 入口。
3. 選擇 **通道**，選擇對應的 Tunnel。
4. 依目前流程選擇 **無需身分驗證**，再建立外掛程式。
5. 回到 ChatGPT 的 MCP client，確認能看見 `tools/list`，再確認 `bridge_status`。
6. 只有在 MCP handshake 與工具清單可用後，才從手機端送出工作。

是否能建立、連線、完成 Codex 工作與回到原對話，仍需要實際 provider／ChatGPT 帳號與外部 UAT；本手冊不把本機畫面當成外部驗收。

### 待插入的實機截圖

- `IMG-12-chatgpt-custom-mcp-entry.png`：ChatGPT 自訂 MCP／Apps 設定入口。
- `IMG-13-chatgpt-tunnel-selection.png`：選擇通道與對應 Tunnel 的實機畫面。
- `IMG-14-chatgpt-auth-selection.png`：選擇 **無需身分驗證** 的實機畫面。
- `IMG-15-chatgpt-mcp-tools.png`：建立後看到 MCP tools 或 `bridge_status` 的實機畫面。

## 5. 手機端使用

1. 在手機 ChatGPT 開啟已設定好自訂 MCP 的對話。
2. 先提出一個範圍清楚、`cwd` 位於 Allowed Folder 內的工作。
3. 若是只讀檢查，使用 `codex_read`；若是明確授權的修改工作，才使用 `codex_run`。
4. 記下呼叫使用的原始 `task_id`。工作回傳 `running` 時，不要重新建立同一份工作；用相同 `task_id` 查詢狀態。
5. 只有在 ChatGPT／MCP client 實際顯示結果時，才把外部流程視為已看到回報。

### 待插入的實機截圖

- `IMG-16-mobile-mcp-enabled.png`：手機 ChatGPT 對話中可選用自訂 MCP 的畫面。
- `IMG-17-mobile-work-request.png`：手機送出工作與顯示原始 `task_id` 的畫面。
- `IMG-18-mobile-job-status.png`：手機查詢同一個 `task_id` 狀態的畫面。

## 6. Blue-Wake 完成通知後回查完整結果

Blue-Wake 只會送出：「工作已完成，請檢閱回報」的通知；它不會自動附上 Codex 完整執行結果。

收到通知後，ChatGPT 必須：

1. 取得通知中的原始 `task_id`。
2. 用同一個 `task_id` 呼叫 `codex_job_status`；若尚未到 terminal status，繼續查詢直到 `completed`、`failed` 或 `timed_out`。
3. 呼叫 `codex_completion_next` 取得完整 Codex result；如需續讀，沿用 `after`。
4. 整理完整 result 後回覆使用者。

不能只把完成通知轉述給使用者，也不能把通知文字當成完整回報。若 completion 查詢暫時沒有結果，保留原始 `task_id`，不要啟動第二份工作；先依同一個 ID 重查。

### 待插入的實機截圖

- `IMG-19-blue-wake-notification.png`：實際 Blue-Wake 完成通知；畫面應只證明通知文字，不要把它當成完整結果。
- `IMG-20-completion-query.png`：ChatGPT 依原 `task_id` 呼叫 `codex_job_status`／`codex_completion_next` 的實機畫面。
- `IMG-21-full-result.png`：ChatGPT 顯示完整 Codex result 的實機畫面。

## 7. 截圖交付清單與目前狀態

目前 Candidate checkout 沒有可用的 `.png`、`.jpg`、`.jpeg`、`.webp` 或其他已驗證產品畫面資產；因此本草稿共有 22 個截圖位置待由實機補齊。補圖時必須：

- 使用目前 `6fixes-final` installer／launcher／ChatGPT／手機實機畫面。
- 保留畫面中的實際英文按鈕與欄位名稱，不自行發明 UI。
- 遮蔽 Tunnel ID、Runtime API key、Bearer token、Codex credential、私人路徑與對話內容。
- 為每張圖記錄取得時間、版本／Candidate identity、畫面所在步驟與是否只是本機證據。
- 沒有實機證據時保留本文件的「待插入實機截圖」標記，不用示意圖冒充產品截圖。

相關細節請參考[安裝與使用](INSTALL.md)、[操作說明](OPERATIONS.md)、[疑難排解](TROUBLESHOOTING.md) 與 [Candidate Windows runbook](../REMOTE_CANDIDATE_WINDOWS.md)。
