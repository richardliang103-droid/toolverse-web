# ToolVerse — AI 協作指南

免登入、資料留本機的中文網頁工具站（22 個工具）。正式站 https://toolverse-web.vercel.app ，由 Vercel 自動部署 `main`。

## 鐵律（違反曾造成正式站全站 500）

1. **雙建置都要過才能推**：`npm test`（跑 vinext build＋全部測試）**和** `npm run build:vercel`（next build，正式站用這個）兩者都必須成功。vinext（vite）與 next build 對模組解析行為不同，只過一邊不代表另一邊會過。
2. 推之前跑完整關卡：`npm run lint` → `npx tsc --noEmit` → `npm test` → `npm run build:vercel` → `npx next start` 抽查幾條路由回 200。
3. 工作流程：開 feature branch → 開 PR → CI（.github/workflows）綠 → **由維護者在 GitHub 合併**（AI 不可合併）。有依賴關係的 PR 要註明合併順序。

## 已知地雷

- **`@gsap/react` 禁用**：在 vinext 的 vite 開發環境會產生第二份 React（invalid hook call 全頁崩潰）。動畫一律用 `gsap.context()` ＋ `useEffect` cleanup `ctx.revert()`。
- **pdf.js worker**：兩套打包器對 `new URL(..., import.meta.url)` 解析不一致，worker 用靜態資產 `public/pdf.worker.min.mjs`（與 pdfjs-dist 版本要一起升；已列入 eslint ignores）。
- **ESLint 9 flat config**：CLI `--ignore-pattern` 不可靠，忽略規則寫在 `eslint.config.mjs` 的 `globalIgnores`（dist/.wrangler/.vercel 已列）。
- **zsh 腳本**：`status` 是 zsh 唯讀變數，監控腳本用別的變數名。
- 測試環境的瀏覽器面板會**凍結 rAF、CSS 動畫時鐘與 web worker**：動畫只動 transform（絕不用 opacity 隱藏內容）、內容必須在動畫任一時刻都可讀；pdf.js 縮圖與音訊播放在面板中無法驗證，需真實瀏覽器。

## 慣例

- **新增工具流程**：`lib/tools.ts` 登記（slug/name/description/symbol/accent/status/category）→ `lib/tool-content.ts` 寫 steps＋FAQ（內容必須與實際功能核對）→ `app/tools/<slug>/page.tsx`（含 `<ToolInfo slug>`）→ `tests/rendered-html.test.mjs` 加路由 → README 加一條。sitemap 自動涵蓋。
- **純邏輯放 `lib/`**：零依賴、用 `node --test --experimental-strip-types` 測。新測試檔要**同時**加進 package.json 的 `test` 與 `test:unit` 兩個 script（明列檔名，不能用目錄）。
- **localStorage**：sanitize 函式逐欄驗證＋`hydrated` 旗標（restore 完成前不寫入）；schema 改欄位要寫一次性遷移（參考 lottery 的 `migrateLegacyWinnerNames`）。
- **併發防護**：檔案批次工具用「預留名額 ref」防快速重複加入；非同步載入用遞增 id（renderId/operationId）防過期結果覆蓋新狀態，**catch 分支也要檢查 id**。
- 剪貼簿操作包 try/catch 給使用者回饋；狀態訊息用 `.gantt-notice-info`（綠）/`-error`（紅）。
- **深色模式**：`<html data-theme>` 由 layout inline script 繪製前設定；顏色盡量走 CSS 變數，寫死的淺色要補 `[data-theme="dark"]` 覆蓋；內容輸出面（條碼、甘特 SVG、QR 預覽）刻意保持白色。
- 設計語彙：和紙／日系和色（縹 #5F83A8、鴇 #CF7F8D、松葉 #7D9A63、藤 #9B8BBF），**不用預設黃色**；動畫尊重 `prefers-reduced-motion`。
- 中文介面（繁體、台灣用詞）；a11y 標準：Lighthouse 無障礙 100（grid 語意、24px 點擊範圍、sr-only 文字）。

## 驗證

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build:vercel
```

瀏覽器實測用 dev server（`.claude/launch.json` 的 `toolverse-dev`，port 3000）。
