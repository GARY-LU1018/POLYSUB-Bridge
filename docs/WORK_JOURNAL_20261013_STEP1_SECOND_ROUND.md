# POLYSUB Step 1 第二輪逐段精簡工作紀錄

日期：2026-10-13（Asia/Taipei）  
範圍：`C:\Users\test\Documents\Codex\polysub-public-source-candidate-20261012`  
對照：`C:\Users\test\Documents\Codex\polysub-bridge-project` 僅讀；未修改、未啟停 Live Bridge、未部署。

## 1. ACTIVE_TASK 與基線

- Goal：逐函式/邏輯區塊追蹤 Blue-Wake A/B、`CodexJobRegistry`/`DurableCompletionOutbox`、測試歷史 fixture 與 build script；只實作確定低風險的公開候選整理。
- Starting checkpoint：公開候選原本沒有 `.git`；先建立本地可回復基線。
- Baseline commit：`d4c460a274d21399afb331dce8ff34f152fcefc0`，branch `candidate-baseline-20261013`。
- Candidate source comparison：公開候選 `src/` 10 個檔案與私有樹同名 `src/` 檔案目前逐檔 bytes/SHA-256 一致；這只證明目前檔案內容相同，不把私有樹的髒狀態或部署狀態帶入公開候選。
- Candidate inventory fact：候選樹沒有 `test/tunnel-provisioning.test.mjs`、R3.1/R3.2 fixture 或上一輪 Step 1 journal；因此本輪不刪除歷史 fixture，也不從私有樹移植測試。

## 2. 分析結果（未改動核心）

### 2.1 `CodexJobRegistry` 與 `DurableCompletionOutbox`

| 行號 | 區塊與實際作用 | 依賴/證據 | 判定 |
|---|---|---|---|
| `src/tools.ts:28-39` | `CodexJobRegistry` 以 caller `taskId` 保存程序內 job，提供 size/get；是 HTTP stateless request 之間查詢 running/completed/failed/timed_out 的即時索引。 | `src/tools.ts:301-347` 的 `codex_job_status` 先查 registry，再 fallback 到 outbox。 | 保留；不是可刪死碼。 |
| `src/tools.ts:41-89` | `start()` 建立唯一 task identity、執行 promise、更新狀態/結果/錯誤，完成時呼叫 handler，並在超過 1000 筆時 prune。 | `test/tools.test.ts:105-122` 驗證 caller taskId 是唯一 registry identity；server tests 涵蓋 fast-return、完成與失敗。 | 保留；`result` 的即時副本與 outbox 的 durable 副本生命週期不同。 |
| `src/tools.ts:409-453` | `runCodexWithFastReturn()` 在固定 communication timeout 內回傳；超時後依同一 taskId 由 `codex_job_status` 續查。 | `test/tools.test.ts` 中 fast-return/slow completion/failure/timeout 測試。 | 保留；不能用 outbox 取代 active promise。 |
| `src/completionOutbox.ts:45-100` | 建立/持久化 completion，給每筆 durable sequence，依 taskId 去重，支援 process reload。 | `test/completionOutbox.test.ts:16-42` 驗證 persist 後 reload/read。 | 保留；這是跨 suspension 的 durable boundary。 |
| `src/completionOutbox.ts:102-127` | `read()` 非消費式讀取，`acknowledge()` 在 receiver 已處理後才標記 acknowledged。 | `test/completionOutbox.test.ts:44-64` 驗證 abandoned receiver 可重讀，直至 ack 才隱藏。 | 保留；不能與 job map 合併。 |
| `src/completionOutbox.ts:130-157` | 只修剪已 acknowledged 的舊 records，使用暫存檔、fsync、rename 保存狀態。 | 持久化與安全寫入路徑由上述 outbox tests 及 source contract 支撐。 | 保留；刪除會破壞 crash/retry 行為。 |
| `src/server.ts:49-68` | job 完成後先 `completionOutbox.persist()`，再在 Blue-Wake 啟用時 `blueWake.emit()`；Blue-Wake 不啟用時 durable completion 仍存在。 | server integration tests 的 durable completion 與 Blue-Wake completion tests。 | 保留；這是明確的兩層責任分界。 |

結論：兩者雖都攜帶 `result`，但 JobRegistry 是 ephemeral execution/status state，Outbox 是 durable delivery/ack state。直接合併會改變 process restart、polling、retry 或 `codex_job_status` fallback 的語義；本輪只提案，不改。

### 2.2 Blue-Wake A/B

| 行號 | 區塊與實際作用 | 對應驗證 | 判定 |
|---|---|---|---|
| `src/blueWake.ts:18-54` | 建立 completion payload；`BlueWakeLiveTestState.emit()` 只驗證 payload/positive durable seq 並回傳 event，`next()` 從 outbox 依 `after + taskId + sessionCorrelation` 讀取。 | `src/server.ts:56-67` 呼叫 `emit()`；`src/blueWake.ts:87-91` 透過 `next()` 提供 read-only tool。 | `emit()` 的回傳值目前被 server 丟棄，是「可移除回傳值/補測試後再內聯」提案，不在本輪刪除 validation。 |
| `src/blueWake.ts:56-155` | 註冊 A/B resource、`blue_wake_next`、B render tool、host capability read/capture tool；A/B 的 tool contracts 與 capability state 是公開 protocol surface。 | `test/server.test.ts:307-410` 驗證 resource/tool surface、read-only annotations、無 legacy HTTP/fetch/claim/hold。 | 保留；不是歷史殘留。 |
| `src/blueWake.ts:162-168` | A handoff widget：initialize/capability capture，讀取 caller taskId，送一次 `ui/message` handoff marker；沒有 polling、next、ack。 | `test/server.test.ts:412-462` 明確驗證一次 `ui/message`、marker、且沒有 `blue_wake_next`。 | 保留獨立 A 邏輯。 |
| `src/blueWake.ts:170-179` | B receiver widget：initialize/capability capture，讀 taskId，poll `blue_wake_next`，確認 correlation，先 update-model-context，再 visible message/fallback，成功後才 ack；teardown/timeout/retry 也在此。 | `test/server.test.ts:464-537`、`:650-725`、`:933-1015` 驗證可見 delivery、pending、retry、fallback 與 ack 順序。 | 保留獨立 B 邏輯。 |
| `src/blueWake.ts:157-160` | `widgetShell()` 共用 HTML/CSS/隱藏診斷狀態容器。 | 所有 A/B resource 共同呼叫。 | 可共用且已共用，不是重複。 |

結論：A/B inline script 有 `isRecord`、`safeJson`、`safeText`、`write`、`rpcError`、message listener 與 request watchdog 等相似片段，但 A 是一次性 handoff，B 是持續 delivery/ack；抽成共享 helper 仍需維持不同 retry、poll、fallback、ack 時序。列為 Product Owner 審核的核心整理提案，不在本輪合併。

### 2.3 歷史測試 fixture

- 公開候選 `rg` 未找到 `R3.1`、`R3.2`、`tunnel-provisioning.test.mjs` 或對應舊 fixture。
- 候選現有 tunnel 文字只描述外部 Tunnel 邊界；`src/` 沒有 Tunnel provisioning implementation。
- 因候選樹無目標檔案，本輪沒有可安全刪除的歷史 fixture 區塊；不修改私有樹的測試/fixture，也不為了讓另一棵樹的歷史測試通過而移植舊檔。

判定：NOT FOUND / NO ACTION。若日後將私有測試匯入公開候選，必須另立明確範圍與 fixture provenance 審核。

### 2.4 `tools/build.mjs`

| 行號 | 發現 | 依賴/風險 | 判定 |
|---|---|---|---|
| `tools/build.mjs:1-3` | `statSync` 只出現在 import，沒有實際讀取；屬確定未使用 import。 | 不影響 runtime；只需語法/差異檢查。 | 已實作低風險刪除。 |
| `tools/build.mjs:11-18` | build 先刪除 `dist`，再固定呼叫候選本地 `node_modules/typescript/bin/tsc`；缺 dependency 時 build 不能進入 manifest。 | 目前候選沒有 `node_modules`；Node 有，但 npm/TypeScript 依賴不可用。變更 bootstrap/error policy 超出本輪。 | 記錄 blocker，不改 build 流程。 |
| `tools/build.mjs:21-30` | 只有 tsc 成功後才寫 build manifest；`gitCommit` 讀候選本地 Git HEAD，沒有 Git 時回 `UNCOMMITTED`。 | 基線後已有 Git；仍需正常依賴環境才能驗證 manifest。 | 保留，待有依賴時再做建置驗證。 |

## 3. 實作結果

只修改公開候選：

- `tools/build.mjs:3`：移除未使用的 `statSync` import。
- 未修改 `src/blueWake.ts`、`src/tools.ts`、`src/completionOutbox.ts`、`src/server.ts` 或測試邏輯。
- 未修改 `C:\Users\test\Documents\Codex\polysub-bridge-project`。

## 4. 驗證結果

- `node --check tools/build.mjs`：PASS。
- `rg statSync tools/build.mjs`：PASS（token absent）。
- `git diff --check`：PASS。
- `node tools/build.mjs`：BLOCKED / exit 1；候選沒有 `node_modules/typescript/bin/tsc`，錯誤為 `MODULE_NOT_FOUND`。這不是 source compile failure；完整 build/test 尚未宣稱 PASS。
- `npm run check`：未執行；本環境沒有 `npm` command，且候選沒有 `node_modules`。
- 未啟停服務、未部署、未修改 allowed roots、未呼叫 Live Bridge。

## 5. 待 Product Owner 審核的提案（本輪未實作）

1. `src/blueWake.ts:32-38`：保留 payload/seq validation，但把未被使用的 `BlueWakeEvent` 回傳值改成 `void`，或把 validation 內聯到 completion path；先補一個直接測試證明 invalid payload/seq 仍 fail closed，再決定。
2. `src/blueWake.ts:166-177`：只抽取明確不含流程語義的 inline RPC/teardown helper；A/B 的 retry/poll/fallback/ack 仍需分開，並以現有 A/B tests 及 error/ambiguous/teardown matrix 驗證。不可直接把兩個 widget 合成單一流程。
3. `src/tools.ts:28-89` 與 `src/completionOutbox.ts:45-157`：不合併；若要重新設計，必須先定義 process restart、job status fallback、delivery retry、ack durability 的等價 acceptance criteria。
4. 歷史 Tunnel fixture：候選樹未發現，無刪除提案；若要納入，先提供 fixture registry/provenance 與公開候選的明確需求。

## 6. 本輪停止條件

低風險 import 整理與可用驗證已完成；核心合併/刪除及依賴安裝、Step 2–10 均停止，等待 Product Owner 審核或下一個明確授權。
