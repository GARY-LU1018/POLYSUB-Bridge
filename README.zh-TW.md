# POLYSUB

> **目前狀態：source preview／公開原始碼候選版**

POLYSUB Bridge 讓你人在外面時，也能直接用手機上的 ChatGPT，透過安全連線遠端控制家裡 Windows 電腦上的 Codex。

你可以讓 ChatGPT 幫你讀取專案、寫程式、修改檔案、執行工作，並把完成結果回傳到原本的 ChatGPT 對話中。

**為什麼特別強調 ChatGPT + Codex？** 因為 POLYSUB Bridge 目前的開發、測試與實際使用環境，就是以 ChatGPT + Codex 為基準。Bridge／Tunnel／MCP 架構也可能適用其他相容的 AI 用戶端或 coding agent，但這些組合沒有經過本專案完整驗證；若使用其他 AI 平台，使用者需要自行研究並設定該平台的 MCP／Connector 整合方式。

POLYSUB 不是 AI 模型，也不是 ChatGPT 或 Codex 的替代品。它是連接層，讓本機專案可以加入 AI 工作流程，同時讓電腦、專案資料夾與執行路徑仍由使用者掌握。

## 為什麼開發 POLYSUB

AI 對話很適合提出問題，但真正完成工作所需的檔案與工具，通常在另一台電腦上。POLYSUB 就是為了補上這段距離：你可以從手機或 ChatGPT 發出要求，經由 Bridge／Tunnel 連到存放專案的本機電腦，再把本機結果帶回來。

它採取清楚的分工。本機 Bridge 負責連線與存取邊界；只有在工作需要專案分析、推理、測試或修改時，才交由 Codex 處理。

## 大致使用方式

1. 從手機或電腦上的 ChatGPT／其他 AI 工具提出工作要求。
2. Bridge／Tunnel 把要求送到專案所在電腦上的 POLYSUB 服務。
3. POLYSUB 在已授權的資料夾範圍內工作。若只是讀取檔案，Bridge 可以直接處理，不必每次都啟動新的 Codex 工作。
4. 如果需要分析或修改，POLYSUB 就呼叫本機 Codex 完成工作。
5. 結果再經由這條連線回到原本的 AI 對話。

## 核心功能

- 把遠端 AI 對話接到本機專案資料夾。
- 直接讀取已授權資料夾內的檔案，不必為每次簡單讀取都呼叫 Codex。
- 在需要深入分析、測試、執行或實際修改時呼叫 Codex。
- 讓 Bridge 與專案資料留在使用者自己的電腦上，並把存取限制在連線所選定的資料夾。
- 透過 Bridge／Tunnel 將本機工作與結果帶回 AI 對話。

## 專案狀態

目前這個 repository 是 source preview／公開原始碼候選版，不是完成發佈的桌面產品；目前也沒有一鍵安裝程式或正式發佈的 portable 下載檔。專案正持續整理本機 Bridge、Codex 工作流程，以及未來產品封裝所需的基礎。

## 延伸閱讀

- [安裝與設定](docs/zh-TW/INSTALL.md)
- [操作說明](docs/zh-TW/OPERATIONS.md)
- [疑難排解](docs/zh-TW/TROUBLESHOOTING.md)
- [安全性](SECURITY.zh-TW.md)
- [參與開發](CONTRIBUTING.zh-TW.md)
- [變更紀錄](CHANGELOG.zh-TW.md)
- [English README](README.md)
