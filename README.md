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

流程圖工具在瀏覽器內直接呼叫 OpenAI Responses API，API 金鑰只保留在頁面記憶體，不會寫入瀏覽器儲存空間或 ToolVerse 伺服器。AI 回傳的節點與連線會先通過本機正規化，再生成 Mermaid 與 draw.io XML。

## 專案結構

- `app/`：首頁與工具頁
- `components/`：共用導覽元件
- `lib/`：工具註冊表與抽獎核心邏輯
- `tests/`：伺服器渲染驗證

## 驗證

```bash
npm run lint
npm run build
npm test
```
