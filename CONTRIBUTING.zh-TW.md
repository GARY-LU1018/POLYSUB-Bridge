# 參與 POLYSUB 開發

感謝你協助改善 POLYSUB。請讓變更保持小而集中，說明對使用者可見的效果，並在行為或設定改變時更新相關文件。

## 本機設定

需求：

- Node.js `>=20` 與 npm。
- 如果要進行 runtime 變更，需要可正常工作的 `codex` command；只做 source-only tests 時不需要 live external host。

安裝並驗證：

```powershell
npm install
npm run check
```

source-mode 開發請使用 `npm run dev`；compiled-mode 檢查請先執行 `npm run build`，再執行 `npm start`。

## Branch 與 pull request

- 從目前的 default branch 建立一個聚焦的 branch。
- 每個 pull request 保持一項連貫的變更。
- 說明範圍、行為變更、設定變更與已知限制。
- 列出執行過的測試與結果。
- 不要包含無關的清理或產生的輸出。

## 安全性與 repository hygiene

請勿提交 secrets、環境檔案、本機帳號名稱、機器專用的絕對路徑、含有私人資料的 logs、`node_modules`、`dist` 或大型 binary packages。將 issue 或 pull request 附上 logs 前，先移除 secrets。

建立 pull request 前：

1. 執行 `npm run check`。
2. 檢查 diff 中是否含有 credentials、private paths 或 generated files。
3. 公開行為改變時，同步更新英文與繁體中文使用者文件。
4. 明確說明仍為 **尚未驗證** 的外部 Tunnel、provider 或 host integration 行為。
