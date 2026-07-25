# ToolVerse 架構盤點

盤點日期：2026-07-25 · 基準 commit：`3d84f3d`（main，PR #42 合併後）

以實際程式碼與 `next start` 的渲染結果為準，不採信 `CLAUDE.md` 與 `README.md` 的敘述。

---

## 摘要

三件事跟「ToolVerse 2.0 實作指南」的假設不一樣，先講：

1. **沒有 registry 漂移。** 工具數在程式碼裡從頭到尾都是 **19**：`lib/tools.ts` 19 筆、`app/tools/` 19 條路由、首頁 SSR 渲染 19 張卡、sitemap 19 條工具 URL。首頁、⌘K 命令面板、sitemap 早就共用 `lib/tools.ts` 這一份清單。
2. **「22」只存在於 `CLAUDE.md` 第 3 行。** 來源是 PR #41 下架了密碼產生器、單位換算、條碼三個工具（22 − 3 = 19），文件沒跟著改。這是文件過期，不是隱藏工具，也不是未登記工具。
3. **Tool Handoff 已經上線。** PR #42（2026-07-25 合併）做完了圖片鏈與文字鏈的接力，指南列為「PR 4」的內容有大約八成已經在正式站上。差別在儲存方式：目前用**模組層記憶體單槽**（`lib/handoff.ts`），硬重新整理就消失，跟指南要求的 Workspace 持久化不同。

還沒有的：Workspace（IndexedDB／OPFS）、Smart Intake、Recipe、Excel／DuckDB 相關工具。

---

## 一、指南要求的 12 項盤點

| # | 項目 | 結果 |
|---|---|---|
| 1 | 實際工具總數 | **19** |
| 2 | `lib/tools.ts` 登記數量 | **19** |
| 3 | `app/tools/` 路由數量 | **19** |
| 4 | 首頁實際顯示數量 | **19**（SSR 出 19 張 `.compact-tool` 卡、19 個 `/tools/*` 連結，頁尾字串「全 19 項工具」由 `tools.length` 產生） |
| 5 | sitemap 路由數量 | **20**（首頁 1 ＋ 工具 19），由 `lib/site.ts` 的 `sitePaths()` 從同一份清單推導 |
| 6 | 接受檔案的工具 | **11**：background-remover、image-crop、image-compressor、image-converter、exif-cleaner、favicon-generator、qr-code（logo）、pdf-toolkit、csv-editor、gantt（匯入）、audio-trimmer |
| 7 | 輸出檔案的工具 | **17**（除了 countdown-timer、text-compare 之外都能下載或匯出；lottery 只有複製，text-compare 只有畫面呈現） |
| 8 | 使用 localStorage 的工具 | **10**：lottery、random-groups、gantt、markdown-editor、text-cleaner、chinese-converter、qr-code、favicon-generator、image-compressor、countdown-timer（另有 `components/theme-toggle.tsx` 的主題、`lib/rosters.ts` 的共用名單） |
| 9 | 使用 Web Worker 的工具 | **2**：background-remover（`background-remover.worker.ts`，Transformers.js）、pdf-toolkit（pdf.js 的 `GlobalWorkerOptions.workerSrc = /pdf.worker.min.mjs`） |
| 10 | 需要遠端 API 的工具 | **2**：ai-flowchart（瀏覽器直連 Gemini／OpenAI，不經本站）、background-remover（**僅在**切到 remove.bg 模式時，經 `app/api/remove-background` 轉送） |
| 11 | 已具備批次處理的工具 | **4**：image-compressor（20 張）、image-converter（20 張）、exif-cleaner（20 張）、pdf-toolkit（合併 12 份）、audio-trimmer（合併多段） |
| 12 | 適合作為第一批 Tool Handoff 示範 | 已經在做了 —— 見下方第三節 |

---

## 二、工具能力矩陣

`P` 欄：L＝完全本機、H＝混合（依選項）、R＝需要遠端。`Off` 欄：斷線可用（首次要下載模型或呼叫 API 的都不算）。

| slug | 名稱 | 分類 | P | 引擎 | 輸入 | 輸出 | 批次 | LS | Off |
|---|---|---|---|---|---|---|---|---|---|
| lottery | 隨機抽名單 | random | L | native | 文字 | 文字 | – | ✓ | ✓ |
| background-remover | 圖片去背 | image | **H** | worker/webgpu/wasm/remote | jpeg,png,webp ≤10MB ×1 | png | – | – | – |
| ai-flowchart | 流程圖 | chart | **R** | remote-api | 文字 | mermaid,png,svg,drawio | – | – | – |
| gantt | 甘特圖 | chart | L | native | json,csv ×1 | png,svg,csv,json,mermaid | – | ✓ | ✓ |
| random-groups | 隨機分組 | random | L | native | 文字 | 文字,csv | – | ✓ | ✓ |
| image-compressor | 圖片壓縮 | image | L | native | jpeg,png,webp ≤25MB ×20 | jpg,png,webp,zip | ✓ | ✓ | ✓ |
| qr-code | QR Code | utility | L | native | 文字＋logo ≤2MB | png,svg | – | ✓ | ✓ |
| countdown-timer | 倒數計時器 | utility | L | native | 設定值 | –（無檔案輸出） | – | ✓ | ✓ |
| pdf-toolkit | PDF 合併與取頁 | utility | L | native,worker | pdf ≤50MB ×12（總計 150MB） | pdf | ✓ | – | ✓ |
| text-cleaner | 文字清理 | text | L | native | 文字 | 文字,txt | – | ✓ | ✓ |
| exif-cleaner | 照片隱私清除 | image | L | native | jpeg,png ≤50MB ×20 | jpg,png,zip | ✓ | – | ✓ |
| chinese-converter | 繁簡轉換 | text | L | native | 文字 | 文字,txt | – | ✓ | ✓ |
| favicon-generator | Favicon 產生器 | image | L | native | 文字/emoji＋圖片 ≤5MB | zip | – | ✓ | ✓ |
| image-crop | 圖片裁切 | image | L | native | jpeg,png,webp ≤25MB ×1 | png,jpg | – | – | ✓ |
| text-compare | 文字比較 | text | L | native | 文字 ×2 | 文字 | – | – | ✓ |
| markdown-editor | Markdown 編輯器 | text | L | native | 文字 | md,html | – | ✓ | ✓ |
| csv-editor | CSV 編輯器 | utility | L | native | csv,tsv ≤10MB ×1 | csv,json | – | – | ✓ |
| image-converter | 圖片格式轉換 | image | L | native | jpeg,png,webp,gif,bmp,svg ≤25MB ×20 | webp,png,jpg,zip | ✓ | – | ✓ |
| audio-trimmer | 音訊剪輯 | utility | L | native | mp3,wav,m4a,ogg ≤30MB ×12 | wav | ✓ | – | ✓ |

這張表現在是**可執行的資料**，不是說明文字：內容存在 `lib/tool-manifest.ts`，`tests/tool-manifest.test.mjs` 會驗證它自洽（例如宣稱 `local` 卻列了 `remote-api` 引擎就會失敗）。改工具時要一起改 manifest。

---

## 三、Tool Handoff 現況

指南的「PR 4：既有工具 Tool Handoff」大部分已經由 PR #42 完成。

**已經接上的鏈**

- 圖片：`background-remover`／`image-crop`／`image-compressor`／`image-converter`／`exif-cleaner` 兩兩互通（`IMAGE_TOOL_SLUGS`）
- 文字：`text-cleaner`／`chinese-converter`／`text-compare`／`markdown-editor` 兩兩互通（`TEXT_TOOL_SLUGS`）

送出端是 `components/send-to-tools.tsx`（「送到 →」按鈕列），接收端是 `components/use-handoff.ts`，交接槽在 `lib/handoff.ts`。

**目前的限制**（也就是 Workspace 要解決的事）

| 限制 | 成因 |
|---|---|
| 硬重新整理後交接消失 | 內容只放在模組層變數 `pending` |
| 一次只能傳一個項目 | 單槽設計，後放的覆蓋前一個 |
| 批次結果無法整批遞交 | 只有 `soleResult`（單一結果）時才顯示按鈕 |
| 5 分鐘後過期 | `HANDOFF_TTL_MS`，避免上一頁／下一頁誤套用 |
| PDF 與音訊不在任何鏈裡 | 沒有共同的中繼儲存，接力鏈只能同型別 |

**遺留的第二份清單**：`IMAGE_TOOL_SLUGS` 與 `TEXT_TOOL_SLUGS` 是手寫的白名單，跟 manifest 的 `inputs` 有重疊但不相等（例如 favicon-generator 也吃圖片，卻不在接力清單裡，因為它沒實作接收端）。這兩份清單應該在 PR 4 改由 manifest 推導，方法是加一個明確的「已實作接收端」旗標，而不是直接用 MIME 比對——否則會多出一堆按了沒反應的按鈕。

---

## 四、與實作指南不一致的地方

| 指南的敘述 | 實際情況 | 處理方式 |
|---|---|---|
| 「首頁 19、`CLAUDE.md` 22，要先確認是隱藏工具還是不同步」 | 文件過期而已，PR #41 下架三個工具沒改文件 | 本 PR 把 `CLAUDE.md` 改成 19，並改成用 manifest 當唯一來源 |
| 「不要同時維護兩份工具清單」 | 首頁／搜尋／⌘K／sitemap 本來就共用一份 | 維持，並把能力欄位加進同一份 |
| 「PR 4：既有工具 Tool Handoff」 | 已由 PR #42 上線（記憶體版） | PR 4 縮小成「改用 Workspace 儲存＋批次遞交＋PDF 加入鏈」 |
| `ToolManifest.category: string` | 專案有固定的五個分類 | 收緊成 `CategoryId`，讓打錯字在編譯期就爆 |
| `ToolManifest.privacyNote: string` 一個欄位 | 指南第 15 節要求四選一的標示 | 拆成 `privacy`（四選一的列舉，驅動 UI 徽章）＋ `privacyNote`（給使用者看的那句話），並用驗證確保它跟 `processing` 不會互相矛盾 |
| PR 5 要做首頁「最近使用」 | 這一項在先前的討論中曾被明確否決 | 依新指南照做，但開工前值得再確認一次 |

---

## 五、建議的 PR 順序（依現況調整）

| PR | 內容 | 狀態 |
|---|---|---|
| 1 | Registry Foundation：Tool Manifest v2＋驗證＋文件修正 | **本 PR** |
| 2 | Workspace Storage：IndexedDB metadata＋OPFS/IndexedDB Blob＋`/workspace` 頁 | 待辦，改動資料流最大，要單獨審 |
| 3 | Smart Intake：magic bytes／文字型別偵測＋首頁 Drop Zone＋推薦（讀 manifest 的 `inputs`） | 待辦，可與 PR 2 平行開發，但合併排在後面 |
| 4 | Handoff 改走 Workspace：`?workspaceItem=<uuid>`、批次遞交、PDF 入鏈、接力清單改由 manifest 推導 | 待辦，**依賴 PR 2** |
| 5 | Personal Dashboard：Favorite、Recent、Workspace 摘要、⌘K 整合 | 待辦，**依賴 PR 2** |

PR 3 只讀 manifest、不寫 Workspace，所以拆得掉；PR 4 與 PR 5 都要等 PR 2 的 repository API 定案。

---

## 六、下一步要注意的技術點

- **雙建置**：`lib/` 的相對匯入現在一律寫出 `.ts` 副檔名。Node 的 ESM 解析器不會自動補副檔名，而 `node --test --experimental-strip-types` 會直接載入這些檔案；bundler 兩邊都接受明確副檔名。`tsconfig.json` 因此開了 `allowImportingTsExtensions`（與 `noEmit` 相容，已驗證 vinext 與 next build 都過）。
- **OPFS 要有 fallback**：Safari 對 OPFS 的支援與 Chrome 有差異，`createSyncAccessHandle` 只能在 Worker 裡用。Repository 必須 feature-detect 後退回 IndexedDB Blob。
- **測試環境限制**：`CLAUDE.md` 已記載瀏覽器面板會凍結 rAF、CSS 動畫時鐘與 web worker，pdf.js 縮圖與音訊播放無法在面板中驗證。Workspace 的 OPFS 行為同樣需要真實瀏覽器手動測。
- **首頁 bundle**：Workspace 與 Intake 的偵測邏輯要放 `lib/`（純函式、零依賴），大型解析器一律 dynamic import，避免把 IndexedDB／OPFS 以外的東西塞進首頁。
