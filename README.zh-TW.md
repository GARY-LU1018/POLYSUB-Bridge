# POLYSUB

> **目前狀態：source preview／公開原始碼候選版**

POLYSUB 是一個在 Windows 電腦本機執行的小型連接程式，讓 AI 工具可以請 Codex 使用你指定的資料夾。連線留在你的電腦上，預設也只開放較窄、僅限本機的安全設定。

POLYSUB 不是 AI 模型、不是聊天程式，也不是可以獨立使用的桌面應用程式。它適合已經在使用 Codex，並希望讓另一個 AI 應用程式受控地要求本機專案工作的使用者。

## 它能做什麼

- 讓 AI 工具讀取你明確選定的專案資料夾。
- 請 Codex 在該資料夾內檢查、測試或執行工作。
- 預設只在你的電腦本機提供連線。
- 預設採取唯讀模式；需要寫入時，必須由你刻意開啟。
- 回報本機 POLYSUB 服務是否正在執行。

## 這個預覽版適合誰

這個預覽版主要給已經能在電腦上使用 Codex 的開發者，以及對 Windows 工具較熟悉的使用者。它目前還不是「下載後按一下安裝」的產品。

## 目前的發佈狀態

目前**沒有一鍵安裝程式**，也**沒有正式發佈的 portable 下載檔**。這個資料夾是公開原始碼候選版，不是完成發佈的產品。POLYSUB 也不會替你安裝或附帶 Codex。

如果你只想下載一個可以直接使用的 Windows 應用程式，這個預覽版目前還沒準備好。請不要在這個 repository 裡尋找 installer 或 portable archive；目前兩者都還沒有發佈。

## Windows 最簡快速開始

以下步驟會執行目前的 source preview。開始前，你需要 Node.js，以及電腦上已經可以正常使用、能由 POLYSUB 啟動的 Codex。

Node.js 是執行這個預覽版的程式。npm 會隨 Node.js 一起安裝，負責下載預覽版需要的元件。

### 1. 準備 Windows

安裝 Node.js 20 或更新版本，並確認 Codex 已經可以在這台電腦上使用。POLYSUB 不會替你安裝 Codex。

### 2. 取得 source 資料夾

請使用專案負責人提供的 source candidate 副本。目前還沒有正式發佈的 POLYSUB 應用程式下載連結。

### 3. 在 source 資料夾開啟 PowerShell

PowerShell 是 Windows 內建的命令視窗。切換到包含 `package.json` 的資料夾：

```powershell
Set-Location -LiteralPath "C:\path\to\polysub-public-source-candidate-20261012"
```

### 4. 安裝並檢查預覽版

```powershell
npm install
npm run check
```

這會下載專案元件、建立預覽版並執行檢查。指令應該在沒有錯誤的情況下完成。

### 5. 選定 POLYSUB 可以使用的資料夾

下面的例子會開放目前的 source 資料夾。若你希望 Codex 使用其他專案，請改成另一個已存在的專案資料夾：

```powershell
$env:CODEX_GPT_BRIDGE_TOKEN = (New-Guid).Guid
$env:CODEX_GPT_BRIDGE_ROOTS = (Get-Location).Path
```

這個 token 是這次執行專用的本機密碼。請保持這個 PowerShell 視窗開啟，也不要把 token 公開。

### 6. 啟動 POLYSUB

```powershell
npm start
```

請讓這個視窗保持執行。成功啟動時，畫面會顯示 POLYSUB 正在本機等待連線。

### 7. 確認它正在運作

開啟第二個 PowerShell 視窗，執行：

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
```

回應中應該會看到 `ok: true`。這表示本機 POLYSUB 服務正在執行；但這個檢查本身不能證明 AI 工具已連線，也不能證明 Codex 已完成工作。

完整的初學者安裝流程請參閱[安裝 POLYSUB](docs/zh-TW/INSTALL.md)，或閱讀[英文安裝說明](docs/en/INSTALL.md)。

## 你需要準備什麼

- 一台 Windows 電腦。
- Node.js 20 或更新版本，以及隨附的 npm。
- 一份可以由 POLYSUB 啟動的 Codex 安裝。
- 一個你願意讓 Codex 使用的專案資料夾。
- 這次執行專用的本機 token。

## 目前的常見限制

- 沒有 installer，也沒有正式發佈的 portable package。
- 這是 source preview，設定時需要使用命令視窗與基本開發工具。
- 這個 repository 不包含、不安裝，也不負責授權 Codex。
- 連接另一個 AI 工具還需要額外設定；單獨通過 health check 不代表連線已完成。
- 目標環境是 Windows；其他作業系統尚未驗證。
- `package.json` 目前寫的是 MIT，但最終公開授權決定與核准的 `LICENSE` 檔案尚未完成。

## 給開發者

如果你要把 POLYSUB 接到 AI 工具，或要修改 source，請接著閱讀：

- [安裝與設定](docs/zh-TW/INSTALL.md)
- [操作說明](docs/zh-TW/OPERATIONS.md)
- [疑難排解](docs/zh-TW/TROUBLESHOOTING.md)
- [安全性](SECURITY.md)
- [參與開發](CONTRIBUTING.md)
- [變更紀錄](CHANGELOG.md)

進階文件會說明本機 HTTP 位址、MCP 整合、工作區權限、選用功能與診斷資訊。第一次確認服務能啟動時，不需要先理解這些內容。

## License 狀態

`package.json` 目前把 `MIT` 寫在套件 metadata 中。在 owner 確認 attribution 並加入核准的 `LICENSE` 檔案前，請把它視為暫定資訊。
