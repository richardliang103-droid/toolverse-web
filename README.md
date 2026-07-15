# ToolVerse

一組免安裝、免登入的實用網頁工具。目前包含：

- 公平抽獎：使用 Web Crypto API 抽選，名單與紀錄只存在瀏覽器。
- 本機 AI 圖片去背：使用 Transformers.js 與 MODNet，圖片不會上傳伺服器。

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
