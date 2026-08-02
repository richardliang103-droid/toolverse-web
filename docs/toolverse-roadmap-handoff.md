# ToolVerse 後續工具交接書

撰寫日期：2026-08-02 · 基準 commit：`ad91fb0`（main，PR #83 合併後）

這份文件的用途：ToolVerse 2.0 的五個 PR 全部落地之後，站台處於「可以放著跑」的穩定狀態。
下一批工具還沒開工，但選型與踩雷點已經研究過了。這裡把研究結果寫下來，讓任何人接手時
不必重新調查一次。

**這不是待辦清單，是選單。** 挑一個做完、開 PR、合併，再挑下一個；不做也不會壞。

---

## 一、目前狀態（接手前先讀這段）

| 項目 | 狀態 |
|---|---|
| 工具數量 | 見 `lib/tool-manifest.ts`（不在文件寫死，寫了就過期） |
| 2.0 路線圖 | 五個 PR 全部完成：Manifest v2 → Workspace → Smart Intake → Handoff 走 Workspace → 個人首頁 |
| 測試 | 單元測試見 `package.json` 的 `test:unit`；E2E 五條高風險流程在 `e2e/high-risk-flows.spec.ts` |
| 已知警告 | `event-lottery` 舞台有 2 個 `@next/next/no-img-element` lint 警告，無實害（本機 data URL 預覽） |
| 需定期維護 | 只有一項：月曆的國定假日資料，每年年底補下一年（來源 data.gov.tw） |

開工前一定要讀 `CLAUDE.md`，尤其是**雙建置鐵律**（`npm test` 與 `npm run build:vercel` 都要過）
與 `@gsap/react` 禁用。那些不是建議，是踩過才寫下來的。

---

## 二、新增工具的標準流程

每個工具都走同一條路，順序不要換（後面的步驟依賴前面的登記）：

1. **`lib/<tool>.ts`** — 純邏輯先寫。零依賴、可用 `node --test --experimental-strip-types` 直接跑。
   `lib/` 內的相對匯入**要寫出 `.ts` 副檔名**（Node 的 ESM 解析器不補副檔名）。
2. **`tests/<tool>.test.mjs`** — 純邏輯的測試。寫完要**同時**加進 `package.json` 的
   `test` 與 `test:unit` 兩個 script（明列檔名，不能用目錄萬用字元）。
3. **`lib/tool-manifest.ts`** — 登記工具。能力欄位的數字要跟元件裡的 `MAX_FILES`／`MAX_SIZE`
   對齊，`validateToolManifests()` 會擋掉自相矛盾的登記。
4. **`lib/tool-content.ts`** — 寫 steps 與 FAQ。內容必須跟實際功能核對，不能照抄別的工具。
5. **`app/tools/<slug>/page.tsx`** ＋ `<slug>-tool.tsx` — 頁面殼與客戶端元件。
   page.tsx 要含 `<ToolInfo slug>`。
6. **`tests/rendered-html.test.mjs`** — 加一條路由與該頁必然出現的字串。
7. **README** 加一行。

首頁、sitemap、⌘K 命令面板、`tests/tool-manifest.test.mjs` 的路由對照都會自動涵蓋，不用手動改。

**最容易漏的三件事**：新測試檔只加進 `test` 忘了 `test:unit`；manifest 的 `handoff` 欄位
宣告了 `canReceive: true` 但元件沒接 `useHandoff`（測試會掃描原始碼抓漏）；
`lib/` 匯入漏寫 `.ts` 副檔名（vinext 會過、`node --test` 會爆）。

---

## 三、工具選單（依建議順序）

排序原則：對標的付費產品越貴、隱私賣點越強、越能重用現有架構的排前面。

> **這一節可能已經部分過期。** 撰寫當天（2026-08-02）有數個工具正在平行實作中。
> 要知道哪些已經上線，**去查 `lib/tool-manifest.ts`**——那裡是唯一真相，這份文件不是。
> 如果下面某個工具的 slug 已經出現在 manifest 裡，代表它做完了，跳過即可。

### 1. 語音轉文字（逐字稿／字幕）

**對標**：MacWhisper Pro（付費解鎖大模型）、Notta、Otter.ai（月費 $8–20）。
這類產品的付費牆就是「準確模型＋本地處理」，而本站兩件都免費給。

**為什麼值得做**：全站隱私賣點最強的一個工具。會議錄音、訪談逐字稿是最不想上傳的檔案類型。

**技術路徑**：`@huggingface/transformers` 已經是專案依賴，`background-remover` 已經跑過
「Web Worker ＋ 模型下載 ＋ WebGPU/WASM fallback」整套架構——**直接照抄那個工具的骨架**，
把模型換成 Whisper（建議 `onnx-community/whisper-base` 起步，
大模型當成使用者可選項）。

**實作要點**：
- Worker 檔名比照 `background-remover.worker.ts`，模型載入進度要有 UI（首次下載可能上百 MB，
  沒有進度條使用者會以為當掉）。
- 輸出 `.txt`／`.srt`／`.vtt`。SRT/VTT 的時間碼格式化寫成 `lib/` 純函式，好測。
- manifest：`processing: "local"`、`engines: ["web-worker", "webgpu", "wasm"]`、
  `privacy: "local-after-download"`（**不是** `local-only`，因為首次要下載模型）、
  `supportsOffline: false`。這個組合驗證器會通過，寫錯會被擋。
- 接力：`audio-trimmer` 剪完可以送過來（`suggestedNextTools` 互指），
  轉完的文字可以送到 `text-cleaner`。這是單機付費軟體做不到的組合。

**踩雷預告**：瀏覽器測試面板會凍結 web worker，這個工具**只能在真實瀏覽器手動驗證**
（`CLAUDE.md` 已記載）。長音檔要分段處理，不然記憶體會爆。

**工程量**：大。是清單裡最重的一個，但也是價值最高的。

---

### 2. 截圖美化

**對標**：Xnapper（$15 買斷）、CleanShot X（$29 起）。indie 圈長賣品類。

**為什麼值得做**：工程量最小、跟現有「輸入→自動排版→匯出」模式完全同構，
而且**日系和色背景是市面上沒有的差異化**（那些產品清一色矽谷漸層）。

**技術路徑**：純 Canvas 合成，零新依賴。
背景（和色漸層／和紙質感）→ 圓角 → 陰影 → 留白 → 社群尺寸 preset。

**實作要點**：
- 佈局計算（給定圖片尺寸、留白比例、目標畫布比例，算出圖片該畫在哪）寫成
  `lib/screenshot-frame.ts` 純函式，這樣可以測，元件只負責畫。
- 和色漸層用 `CLAUDE.md` 記的四個色（縹 #5F83A8、鴇 #CF7F8D、松葉 #7D9A63、藤 #9B8BBF），
  **不要用預設黃色**。
- 比照 `image-crop` 接圖片接力鏈（`useHandoff` 收、`SendToTools` 送）。
- 深色模式下工具介面要跟著變，但**輸出的畫布本身不受主題影響**
  （比照條碼、甘特 SVG、QR 預覽刻意保持白色的作法）。

**工程量**：小。單一 PR 可完成。

---

### 3. PDF 進階功能補齊

**對標**：iLovePDF Premium、Smallpdf Pro。它們鎖在付費牆後的正是這些。

**技術路徑**：`pdf-lib` ＋ `pdf.js` 都已在依賴中，`pdf-toolkit` 已有基礎。
建議**依難度排序分批做**，不要一次全上：

| 功能 | 難度 | 備註 |
|---|---|---|
| 加浮水印 | 低 | pdf-lib 直接畫文字／圖片 |
| 加頁碼 | 低 | 同上，要處理起始頁與位置選項 |
| 圖片→PDF | 低 | 常用度高，多張圖合成一份 |
| PDF→圖片 | 中 | pdf.js render 到 canvas，要處理 DPI 選項 |
| PDF 壓縮 | **高** | 見下方警告 |

**PDF 壓縮的誠實警告**：真正的壓縮要重編碼內嵌影像，純前端做得到的是
「render 成點陣圖再重組」——**這會讓文字變成圖片、無法選取也無法搜尋**。
如果要做，manifest 的描述與 UI 都必須誠實標示這個代價，不能含糊帶過。
本站的 manifest 驗證器就是為了擋這種含糊而存在的。

**踩雷預告**：pdf.js worker 用靜態資產 `public/pdf.worker.min.mjs`，
**升級 pdfjs-dist 時要一起換這個檔案**（兩套打包器對 `new URL(..., import.meta.url)` 解析不一致）。
pdf.js 縮圖在測試面板中無法驗證，需真實瀏覽器。

**工程量**：中（可拆成多個小 PR，每個都能獨立合併）。

---

### 4. OCR 圖片取字

**對標**：TextSniper（$10）、ABBYY FineReader。

**為什麼值得做**：價值不只在 OCR 本身，而在**接力鏈**——
截圖 → OCR → `text-cleaner` → `chinese-converter` 一條龍，這是單機付費軟體做不到的組合。

**技術路徑**：Tesseract.js，有繁中訓練資料、純本機。
模型檔比 Whisper 小得多，但仍需下載，`privacy` 一樣標 `local-after-download`。

**實作要點**：繁中辨識率對「直排」與「手寫」很差，FAQ 要誠實寫出限制，
不要讓使用者以為什麼都能辨識。

**工程量**：中。

---

### 5. 圖片 AI 放大（2x／4x）

**對標**：Topaz Gigapixel（已改訂閱制，約 $199/年）、Bigjpg（免費版每月 20 張）。

**技術路徑**：Real-ESRGAN 的 ONNX 模型，走 `onnxruntime-web`／WebGPU。
架構與 `background-remover` 同構，可重用該工具的 worker 骨架。

**實作要點**：模型體積較大，首次下載要明確標示大小與預估時間。
放圖片接力鏈。大圖要分塊（tile）處理，不然 GPU 記憶體會爆。

**工程量**：中大。

---

### 6. 影片壓縮／轉檔／轉 GIF

**對標**：各種影片壓縮付費 app。

**技術路徑**：`ffmpeg.wasm`。**這是清單裡技術風險最高的一個**，所以排最後。

**開工前必須知道的前提**：多執行緒版需要 `SharedArrayBuffer`，也就是需要設定
COOP／COEP HTTP headers。**只對該工具的路由設，不要動全站**——全站設會影響
其他工具載入第三方資源的能力，也可能影響 PWA。
單執行緒版免 headers 但明顯較慢，30MB 以內的短片還可接受，
建議第一版就走單執行緒，確認需求後再考慮多執行緒。

**工程量**：大，且風險集中在部署設定而非程式碼本身。

---

## 四、自用小品（順手做的等級）

這些不對標特定產品，但實用且工程量小：

- **報價單／請款單產生器**：表單 → SVG／PDF，含統編與 5% 稅額。
  跟 `equity-chart` 是同一個模式（`lib/` 純邏輯算佈局 ＋ SVG 元件渲染），可直接照抄架構。
  對標各種月費 invoice SaaS。
- **分帳工具**：對標 Splitwise Pro（年費約 $40）。
  核心是純 `lib/` 邏輯（多人多筆消費 → 最少轉帳次數的結清方案），配 localStorage。
  演算法單純、測試好寫，出遊自用剛好。
- **字幕編輯器**：SRT／VTT 時間碼偏移、格式互轉、合併。
  跟「語音轉文字」是天生一對（那個工具的輸出就是這個的輸入），單獨也有用。
  純文字處理，工程量最小。

---

## 五、明確不要做的

這幾類已經評估過並排除，除非需求改變，不要再花時間研究：

| 類型 | 排除原因 |
|---|---|
| 拖拉畫布式編輯器（Excalidraw／Canva 類） | 跟本站「表單→自動排版」的核心哲學相反，維護成本會吃掉整個專案 |
| 去浮水印、各種平台下載器 | 版權疑慮 |
| 開發者工具組（JSON／Base64／時間戳） | 維護者已明確拒絕 |
| 密碼產生器、單位換算、條碼 | PR #41 已下架，不要再加回來 |
| Vercel Analytics、自訂網域、關於頁 | 維護者已明確拒絕 |

---

## 六、如果只能再做一件事

做**截圖美化**。工程量最小、當天可完成、視覺成果最明顯，
而且不需要模型下載，不會動到部署設定，風險趨近於零。

如果時間充裕，做**語音轉文字**。它是唯一一個能讓人真的取消訂閱的工具。
