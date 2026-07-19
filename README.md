# ToolVerse

一組免安裝、免登入的實用網頁工具。目前包含：

- 線上抽獎：真的轉盤動畫，使用 Web Crypto API 抽選，名單與紀錄只存在瀏覽器。
- 圖片去背：使用 Transformers.js 與 MODNet，圖片不會上傳伺服器。
- 流程圖：中文需求轉成經驗證的節點與連線，可匯出 Mermaid、PNG、SVG 與 draw.io。
- 甘特圖：拖曳排出任務、里程碑與依賴關係，時程只存在瀏覽器，可匯出 PNG、CSV、Mermaid 與 JSON。
- 隨機分組：貼上名單，用安全隨機來源公平分成小組，可指定組數或每組人數。
- 圖片壓縮：本機批次壓縮與轉檔（JPG、PNG、WebP），可調品質與尺寸上限。
- QR Code 產生器：自訂顏色與容錯等級，匯出 PNG、SVG。
- 倒數計時器：活動與簡報用的全螢幕倒數，警示變色與提示音。
- PDF 合併與取頁：pdf-lib 純瀏覽器處理，檔案不上傳。
- 文字清理：去空白、去重複行、排序、全形轉半形與字數統計。
- 照片隱私清除：無損移除 EXIF、GPS 與拍攝資訊，畫質不變。
- 繁簡轉換：OpenCC 繁簡互轉，支援台灣用詞。
- 密碼產生器：Web Crypto 安全隨機、可調長度與字元類別、熵強度計，不上傳不儲存。
- Favicon 產生器：文字、emoji 或圖片產生整套 favicon，附 HTML 與 manifest 片段。

## 開發

需要 Node.js 22.13 以上版本。

```bash
npm install
npm run dev
npm test
```

## 線上抽獎

抽獎結果一律由 `lib/lottery.ts` 的 Web Crypto 安全亂數（Fisher–Yates 洗牌）決定，轉盤動畫純粹是視覺呈現，不影響公平性。

- **轉盤**：`app/tools/lottery/lottery-wheel.tsx` 用 SVG 畫出霓虹漸層轉盤，每位參加者一格，用 GSAP 做「高速旋轉 → 慢慢減速 → 指針精準停在得獎者格子上」的物理動畫；名額 ≤ 14 人時格子上會顯示名字，超過則只顯示漸層色塊（避免文字重疊看不清楚），得獎者一律會在轉盤上方用大字＋彩帶特效公告。
- **多人中獎**：一次抽多位時會依序轉一輪、公布一位，並把已中獎者從轉盤移除再轉下一輪，動畫時間會隨中獎人數增加而縮短，避免抽太多人要等太久。
- **配色**：抽獎工具的卡片區採用獨立的霓虹暗色系（`.lottery-neon`，定義在 `app/globals.css`），只套用在這個工具本身，不影響網站其他頁面的配色。

## 圖片去背

去背工具支援兩種模式，切換鈕在頁面上：

- **本機 AI（預設、免費）**：模型在 Web Worker 中執行，優先使用 WebGPU，無法使用時自動退回 WASM。首次使用會從 Hugging Face 下載 Apache 2.0 授權的 `Xenova/modnet` 模型，之後由瀏覽器快取。圖片檔案只會傳入使用者自己的 Worker，不經過本站 API，也不需要任何服務金鑰，畫質普通但完全免費、完全本機處理。
- **remove.bg API**：畫質更高、速度更快，但需要自己的 remove.bg API 金鑰（[免費申請](https://www.remove.bg/api)，每月 50 次免費額度，超過需付費，免費額度可能只回傳較低解析度的預覽圖）。金鑰只暫存在瀏覽器頁面記憶體。因為 remove.bg 的 API 不支援瀏覽器直接跨網域呼叫，圖片與金鑰會先經過 `app/api/remove-background` 這個 ToolVerse 伺服器路由轉送一次，再送到 remove.bg 處理；伺服器不會記錄或儲存金鑰與圖片，只在單次請求中轉送。頁面上的隱私徽章會依目前選擇的模式即時更新，誠實反映圖片是否會上傳。

## 流程圖

流程圖工具支援兩種 AI 來源，切換鈕都在頁面上，兩種金鑰都只暫存在瀏覽器頁面記憶體，直接從瀏覽器送往對應的 AI 服務，不會經過 ToolVerse 伺服器，也不需要在部署平台額外設定任何環境變數：

- **Gemini（免費額度）**：預設模式。到 [Google AI Studio](https://aistudio.google.com/apikey) 免費申請一組 API 金鑰（不需信用卡），貼到頁面上的「Gemini API 金鑰」欄位即可使用。要注意 Gemini 免費額度的請求內容可能會被 Google 用於改進模型，跟 OpenAI 模式的隱私假設不同。
- **OpenAI**：需要自己的 OpenAI API 金鑰，用量依 OpenAI 帳戶計費。

兩種模式產生的節點與連線都會先經過同一套本機正規化（`lib/flowchart.ts`），再生成 Mermaid 與 draw.io XML。

## 專案結構

- `app/`：首頁與工具頁
- `components/`：共用導覽元件
- `lib/`：工具註冊表、抽獎核心邏輯、流程圖 schema 與正規化
- `tests/`：伺服器渲染驗證

## 驗證

```bash
npm run lint
npm run build
npm test
```
