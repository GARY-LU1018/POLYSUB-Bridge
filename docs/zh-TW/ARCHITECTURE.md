# 架構

POLYSUB 把遠端 AI 對話接到使用者電腦上的工作。本文件說明公開原始碼候選版的架構與責任邊界；安裝、操作、安全設定與部署歷史另有文件說明。

## 唯一主鏈

產品的唯一主鏈是：

```text
ChatGPT／手機
      |
      v
外部 Tunnel／傳輸層
      |
      v
POLYSUB Bridge（MCP／HTTP 邊界）
      |
      +--> 簡單要求：直接讀取已授權資料夾
      |
      +--> 分析、測試、執行或修改：交由 Codex 處理
                    |
                    v
             本機 Codex App Server adapter
                    |
                    v
             受界定的工作與 session 狀態
                    |
                    v
             completion record／durable outbox
                    |
                    v
             選用的 Blue-Wake handoff 與接收 Widget
                    |
                    v
             主機端渲染，再回到原本的對話
```

Bridge 負責本機連線邊界，以及在直接讀取資料夾與呼叫 Codex 之間做出工作分流。Tunnel、對話主機與手機介面是 Bridge 周邊的整合面，不是另一套 Bridge 實作。

## 兩種工作模式

### Bridge 直接讀取模式

如果要求只是簡單讀取，Bridge 可以直接處理已授權專案資料夾內的檔案，不必為此啟動 Codex 工作；結果仍經由同一條 Bridge／Tunnel 主鏈回傳。

### Codex 輔助模式

如果要求需要專案推理、測試、執行或實際修改，Bridge 就透過 App Server adapter 交給本機 Codex。Bridge 保留工作使用的 task ID 與 session 關係，再回傳立即結果，或回傳一個可以透過 completion 狀態繼續追蹤的執行中工作。

目前公開原始碼候選版中，`codex_read` 是已實作的唯讀 Codex 檢查操作，不是通用的直接檔案讀取 MCP tool。上面的直接讀取模式是產品層級的 Bridge 責任，不應與 `codex_read` 混為一談。

## 元件責任與邊界

| 元件 | 責任 | 邊界 |
| --- | --- | --- |
| ChatGPT／手機 | 發出要求並呈現回傳結果。 | 外部對話與裝置介面。 |
| Tunnel／傳輸層 | 在對話主機與本機服務之間傳送要求與回應。 | 外部連線整合；不由本 source package 建立或管理。 |
| Bridge server | 提供 MCP／HTTP 入口、解析已授權工作區、選擇工作模式並轉送結果。 | POLYSUB 核心；只有一條權威要求路徑。 |
| Codex App Server adapter | 代表 Bridge 啟動或繼續本機 Codex 工作。 | POLYSUB 與外部 Codex runtime 的整合層。 |
| 工作與 session 狀態 | 追蹤呼叫端 task ID、執行中工作與後續 continuation。 | POLYSUB 核心執行狀態。 |
| Completion outbox | 在接收端讀取並確認以前保留完成結果。 | POLYSUB 核心傳遞狀態。 |
| Blue-Wake | 為長時間工作提供選用的 handoff marker、完成接收器與 Widget 資源。 | POLYSUB 的整合候選；實際主機渲染仍屬外部行為。 |
| Host Widget／對話回傳 | 掛載接收器，並在原本的對話中呈現完成結果。 | 外部主機能力與 UI 介面。 |

原始碼的責任分界也遵循同一條邊界：`server.ts` 負責 HTTP／MCP server，`tools.ts` 負責 Bridge tools 與工作狀態，`upstream.ts` 負責 Codex adapter，`sessionRegistry.ts` 負責 continuation 狀態，`completionOutbox.ts` 負責 durable completion 狀態，`blueWake.ts` 負責選用的 Widget handoff。

## POLYSUB 核心與外部整合

POLYSUB 核心包括本機 Bridge、MCP／HTTP server、設定與已授權資料夾解析、tool dispatch、Codex adapter、受界定的工作／session 狀態、completion outbox，以及選用的 Blue-Wake 資源。

外部或主機整合包括 ChatGPT 與手機介面、Tunnel／provider 連線、Codex runtime 本身，以及主機是否能掛載 Widget、接受 handoff 並顯示回傳結果。公開原始碼候選版不宣稱本 repository 已實作或驗證這些外部介面。

## KEEP FLAT 與單一權威實作

原始碼維持扁平、按責任分工的結構。每個關注點都只有一個權威實作：

- 一個 Bridge server 與 MCP 要求路徑；
- 一個 Bridge tool 註冊與 dispatch 層；
- 一個 Codex App Server adapter；
- 一個工作／session 狀態模型；
- 一條 durable completion 路徑，Blue-Wake 附著在這條完成路徑上，而不是建立第二條結果路徑；
- 一個供選用主機整合使用的 Widget handoff 流程。

新行為應放在擁有該責任的模組中。不得只為掩蓋缺陷或保留含義不明的舊路徑，就新增第二個 server、tool registry、狀態儲存、completion queue 或 Widget 流程。KEEP FLAT 的意思是讓架構保持可理解、可追蹤，並能從單一權威實作恢復。
