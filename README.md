# Hermes Tools

一組免安裝、免登入的實用網頁工具。目前包含：

- 公平抽獎：使用 Web Crypto API 抽選，名單與紀錄只存在瀏覽器。
- 圖片去背：支援 JPG、PNG、WebP，透過伺服器端代理呼叫 remove.bg。

## 開發

需要 Node.js 22.13 以上版本。

```bash
npm install
npm run dev
npm test
```

## 圖片去背設定

複製 `.env.example` 為 `.env.local`，填入 remove.bg 金鑰：

```text
REMOVE_BG_API_KEY=your_remove_bg_api_key
```

金鑰只會在伺服器端使用，不會傳到瀏覽器。正式公開前仍建議在入口層加入持久化限流或 WAF 規則。

## 專案結構

- `app/`：首頁、工具頁與伺服器端 API
- `components/`：共用導覽元件
- `lib/`：工具註冊表與抽獎核心邏輯
- `tests/`：伺服器渲染驗證

## 驗證

```bash
npm run lint
npm run build
npm test
```
