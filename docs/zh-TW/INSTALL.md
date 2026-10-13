# 在 Windows 安裝 POLYSUB

> **目前狀態：source preview／公開原始碼候選版**

這是一份針對目前 POLYSUB 預覽版的實際設定說明。前面先放一般 Windows 使用者能照做的流程，開發者專用的選項放到最後。

POLYSUB 是給 Codex 使用的本機連接程式。它不是獨立的 AI 應用程式，也不會替你安裝或附帶 Codex。

## A. 開始前準備

請先準備：

1. 一台 Windows 電腦。
2. Node.js 20 或更新版本。Node.js 負責執行預覽版；npm 會隨 Node.js 一起安裝，負責下載需要的元件。
3. 一份已經安裝、可以在 Windows 命令視窗啟動的 Codex。POLYSUB 會啟動 Codex，但不會安裝它。
4. 一份頂層包含 `package.json` 的 POLYSUB source 資料夾。
5. 一個你願意讓 Codex 使用的現有專案資料夾。

如果你只是想下載應用程式後按一下 Install，現在可以先停在這裡。這個 candidate 目前還沒有用那種方式打包。

## B. 選項一——Portable package

**尚未正式發布。**

目前沒有 portable archive，也沒有可以下載的一鍵 installer。請不要把 source 資料夾複製一份就稱為 installer；複製的 source 資料夾仍然需要 Node.js、npm，以及另外安裝的 Codex。

未來如果正式發布 portable package，release page 會說明：

- 確切的下載檔名；
- 支援的 Windows 版本；
- 是否內含 Node.js 與 Codex，或仍需要另外準備；
- 設定步驟；
- 檔案 checksum。

目前這個 source preview 沒有上述 portable package 資訊。

## C. 選項二——從 source 建立

這是目前這個 candidate 真正呈現的唯一可用流程。「從 source 建立」就是把專案檔案整理成可以在自己電腦上執行的本機副本。照著做不需要修改 source code。

## D. Windows 逐步設定

### 1. 安裝 Node.js

從 [Node.js 官方網站](https://nodejs.org/) 安裝 Node.js 20 或更新版本。

預期結果：Node.js 已安裝，npm 也可以一起使用。

### 2. 確認 Node.js 與 npm

從 Windows 開始功能表開啟 **PowerShell**。PowerShell 是下面步驟會使用的命令視窗。

執行：

```powershell
node --version
npm --version
```

預期結果：兩個指令都會印出版本號，而且 Node.js 版本是 20 或更新版本。

### 3. 取得 source 資料夾

把專案負責人提供的 POLYSUB source 資料夾放到你找得到的位置。資料夾最上層必須有 `package.json`。

預期結果：用檔案總管打開資料夾時，可以看到 `package.json`。

### 4. 把 PowerShell 切換到 source 資料夾

把範例路徑換成實際資料夾路徑後執行：

```powershell
Set-Location -LiteralPath "C:\path\to\polysub-public-source-candidate-20261012"
```

預期結果：PowerShell 提示字元最後會顯示 POLYSUB source 資料夾名稱。

### 5. 下載專案元件

執行：

```powershell
npm install
```

預期結果：npm 在沒有錯誤的情況下完成，並建立 `node_modules` 資料夾。這是本機產生的資料夾，不應該作為公開 source 的一部分上傳。

### 6. 建立並測試預覽版

執行：

```powershell
npm run check
```

預期結果：指令順利完成。它會建立 POLYSUB 並執行內附測試。如果出現錯誤，先看[如果出現問題](#g-如果出現問題)，再繼續後面的步驟。

### 7. 建立本機專用 token

在同一個 PowerShell 視窗執行：

```powershell
$env:CODEX_GPT_BRIDGE_TOKEN = (New-Guid).Guid
```

預期結果：沒有錯誤訊息。這會替這次執行建立一組暫時密碼，只會留在這個 PowerShell 視窗中。

### 8. 選定允許使用的專案資料夾

第一次本機測試可以先允許目前的資料夾：

```powershell
$env:CODEX_GPT_BRIDGE_ROOTS = (Get-Location).Path
```

預期結果：沒有錯誤訊息。預設情況下，POLYSUB 只會讓 Codex 使用這個選定的資料夾。若要使用其他已存在的資料夾，請改成完整的 Windows 路徑，例如：

```powershell
$env:CODEX_GPT_BRIDGE_ROOTS = "C:\path\to\your-project"
```

### 9. 啟動 POLYSUB

執行：

```powershell
npm start
```

預期結果：畫面會顯示 `codex-gpt-bridge` 正在本機等待連線。使用 POLYSUB 時，請讓這個視窗保持開啟。看不到新的命令提示字元是正常的，因為服務仍在執行。

## E. 第一次啟動

POLYSUB 不會開啟桌面視窗，而是在啟動它的 PowerShell 視窗中以本機服務執行。

請保持該視窗開啟。之後要停止服務，請在同一個視窗按 **Ctrl+C**。如果重新開啟一個 PowerShell 視窗，除非你另外建立安全的啟動流程，否則需要在新視窗重新設定 token 與資料夾。

## F. 如何確認它正在運作

### 1. 開啟第二個 PowerShell 視窗

不要關閉正在執行 POLYSUB 的視窗，再從開始功能表開啟另一個 PowerShell 視窗。

預期結果：一個視窗執行 POLYSUB，另一個視窗可以用來檢查。

### 2. 檢查本機 health page

執行：

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
```

預期結果：回應中包含：

```text
ok   name
--   ----
True codex-gpt-bridge
```

這個 health check 證明本機 POLYSUB 服務正在執行，但不能證明另一個 AI 工具已連線，也不能證明 Codex 已完成工作。

### 3. 本機檢查通過後，再連接 AI 工具

連接 AI 工具是額外的整合步驟。該工具必須使用本機 POLYSUB 位址，以及啟動 POLYSUB 的 PowerShell 視窗所使用的相同驗證設定。技術整合細節請參閱[操作說明](OPERATIONS.md)。

## G. 如果出現問題

- 如果系統找不到 `node` 或 `npm`，安裝 Node.js 後關閉並重新開啟 PowerShell。
- 如果 `npm install` 失敗，確認目前所在的資料夾包含 `package.json`。
- 如果 `npm run check` 失敗，保留完整錯誤文字，並查看[疑難排解](TROUBLESHOOTING.md)。
- 如果啟動時說找不到 token，請在同一個 PowerShell 視窗再次設定 `CODEX_GPT_BRIDGE_TOKEN`，再重試。
- 如果 health check 無法連線，確認原本的 POLYSUB 視窗仍在執行，且曾顯示 listening 訊息。
- 如果 POLYSUB 已啟動但 Codex 工作失敗，確認 Codex 是另外安裝的，而且它的命令可以執行需要的 app-server 模式。

向他人求助時，不要公開 token、私密設定，或包含 secret 的完整 log。

## H. 只給開發者的細節

大多數使用者不需要閱讀這一節。MCP client 是使用標準工具連線協定來呼叫 POLYSUB 的 AI 應用程式。

進階設定透過環境變數控制，包括：

- `CODEX_GPT_BRIDGE_HOST` 與 `CODEX_GPT_BRIDGE_PORT`：本機服務的監聽位址；
- `CODEX_GPT_BRIDGE_TOKEN` 與 `CODEX_GPT_BRIDGE_NO_AUTH`：本機驗證；
- `CODEX_GPT_BRIDGE_ROOTS`：一個或多個允許使用的絕對路徑；
- `CODEX_GPT_BRIDGE_DEFAULT_SANDBOX` 與 `CODEX_GPT_BRIDGE_ALLOW_WRITE`：存取模式；
- `CODEX_GPT_BRIDGE_CODEX`：非預設的 Codex 命令；
- `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE`：選用的完成通知功能。

除非你清楚了解變更後果，請保留預設的 loopback 位址與唯讀模式。完整的邊界與診斷 endpoint 請閱讀[操作說明](OPERATIONS.md)與[安全性](../../SECURITY.zh-TW.md)。

本機開發時，`npm run dev` 會直接啟動 TypeScript source，而不是使用編譯後的輸出。這是開發者便利功能，不是第一次啟動時的標準流程。
