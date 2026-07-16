# ToolVerse

一組免安裝、免登入的實用網頁工具。目前包含：

- 公平抽獎：使用 Web Crypto API 抽選，名單與紀錄只存在瀏覽器。
- 本機 AI 圖片去背：使用 Transformers.js 與 MODNet，圖片不會上傳伺服器。
- AI 流程圖：中文需求轉成經驗證的節點與連線，可匯出 Mermaid、PNG、SVG 與 draw.io。

## 開發

需要 Node.js 22.13 以上版本。

```bash
npm install
npm run dev
npm test
```

## 本機圖片去背

去背模型在 Web Worker 中執行，優先使用 WebGPU，無法使用時自動退回 WASM。首次使用會從 Hugging Face 下載 Apache 2.0 授權的 `Xenova/modnet` 模型，之後由瀏覽器快取。

圖片檔案只會傳入使用者自己的 Worker，不經過本站 API，也不需要任何服務金鑰。

## AI 流程圖

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
