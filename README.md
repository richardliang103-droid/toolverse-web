# ToolVerse

一組免安裝、免登入的實用網頁工具。目前包含：

- 線上抽獎：真的轉盤動畫，使用 Web Crypto API 抽選，名單與紀錄只存在瀏覽器。
- 活動抽獎控制台：尾牙、公司活動用的正式抽獎後台，多名單群組、多獎項、控制台與投影舞台分頁同步，得獎紀錄可匯出備份。
- 圖片去背：使用 Transformers.js 與 RMBG-1.4，圖片不會上傳伺服器。
- 流程圖：中文需求轉成經驗證的節點與連線，可匯出 Mermaid、PNG、SVG 與 draw.io。
- 甘特圖：拖曳排出任務、里程碑與依賴關係，時程只存在瀏覽器，可匯出 PNG、CSV、Mermaid 與 JSON。
- 股權架構圖：輸入股東與持股比例，自動分層畫出股權架構，標示境外公司與公司狀態，適合企業徵信報告。
- 營運架構圖：輸入上下游往來對象與佔比，自動畫出三欄營運架構，標示付款條件與關係人交易，適合企業徵信報告。
- 隨機分組：貼上名單，用安全隨機來源公平分成小組，可指定組數或每組人數。
- 圖片壓縮：本機批次壓縮與轉檔（JPG、PNG、WebP），可調品質與尺寸上限。
- QR Code 產生器：自訂顏色與容錯等級，匯出 PNG、SVG。
- 倒數計時器：活動與簡報用的全螢幕倒數，警示變色與提示音。
- PDF 合併與取頁：pdf-lib 純瀏覽器處理，檔案不上傳。
- 文字清理：去空白、去重複行、排序、全形轉半形與字數統計。
- 照片隱私清除：無損移除 EXIF、GPS 與拍攝資訊，畫質不變。
- 繁簡轉換：OpenCC 繁簡互轉，支援台灣用詞。
- Favicon 產生器：文字、emoji 或圖片產生整套 favicon，附 HTML 與 manifest 片段。
- 圖片裁切：自由框選或固定比例，本機輸出 PNG、JPG。
- 文字比較：逐行／逐詞／逐字 diff，標示新增刪除修改，本機比較。
- Markdown 編輯器：即時預覽、GFM 支援、自動儲存草稿。
- CSV 編輯器：表格編輯、排序、增刪欄列，匯出 CSV／JSON。
- 圖片格式轉換：批次轉 WebP／PNG／JPG，支援 GIF、BMP、SVG 輸入。
- 音訊剪輯：波形選段、試聽、輸出無損 WAV。
- 月曆：標示今天、週末與國定假日（含農曆節日，2026～2027 年），可跳到任何月份，資料內建不連線查詢。

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

## 活動抽獎控制台

跟輕量版的「線上抽獎」是兩個互相獨立的工具，`/tools/event-lottery` 是給尾牙、公司活動用的正式後台，`/tools/event-lottery/stage` 是給投影機用的全螢幕舞台頁，兩者用不同分頁開啟。

- **資料模型**：`lib/event-lottery.ts` 定義名單群組、參加者、獎項、得獎紀錄，並提供 normalize／CSV 解析／安全抽選／失格歸還／JSON 備份驗證等純邏輯，`tests/event-lottery.test.mjs` 覆蓋。
- **安全抽選**：候選人池建立後，直接重用 `lib/lottery.ts` 的 `drawWinners()`（Web Crypto API 的 Fisher–Yates 洗牌），不使用 `Math.random()`。
- **分頁同步**：控制台與舞台各自開分頁，靠 `BroadcastChannel`（頻道 `toolverse:event-lottery:v1`）即時同步，並疊加 `storage` 事件當備援；資料本身存在 localStorage 的 `toolverse:event-lottery:v1`。抽獎結果只在確定的那一刻原子寫入一次（含 `pendingReveal.revealAt` 這個未來時間戳），舞台該顯示什麼一律用 `resolveStageDisplay(state, now)` 現算，不依賴任何存活的計時器——重新整理、關掉分頁、或分頁被瀏覽器背景節流都不影響正確性；`lib/event-lottery.ts` 的 `visibleWinnerCount()` 同一套原則也套用到逐一揭曉每一位得獎者的進度。
- **抽獎操作**：可以在控制台操作（選擇獎項、指定人數、按鈕觸發），也可以直接在舞台用簡報筆、鍵盤（空白鍵／Enter／→／PageDown 前進，←／PageUp／Esc 清除畫面）或點擊畫面控制「抽下一個獎項」；兩種入口共用 `app/tools/event-lottery/actions.ts` 同一套動作，寫入的資料與廣播事件完全一致。
- **CSV 範本**：參加者與獎項的 CSV 匯入區塊都提供「下載範例 CSV」，避免使用者要自己猜欄位格式。
- **舞台視覺**：重用專案既有的 GSAP 與 canvas-confetti，背景粒子用純 Canvas 繪製（不接任何外部粒子庫或 CDN），音效用 Web Audio API 即時合成一聲短鈴聲並在整個分頁共用同一個 `AudioContext`（不內建外部音檔），單輪超過 30 位得獎者只在第一位與最後一位放彩帶／音效，並尊重 `prefers-reduced-motion`。

## 活動抽獎手機遙控（optional）

活動抽獎控制台可以額外啟用「手機遙控」：主控電腦按下「啟用手機遙控」產生 QR Code，手機掃描後直接進入遙控頁（不需要帳號、密碼或房間代碼），畫面只有一個大按鈕能推進舞台的下一步，實際抽選永遠由舞台頁執行 `lib/event-lottery.ts` 既有的安全抽選邏輯，手機自己不會、也不能決定得獎者。

**這是完全選填的加值功能**：沒有設定 Supabase 環境變數時，專案照常 build、活動抽獎控制台與投影舞台完全正常運作，控制台只會顯示「尚未設定手機遙控服務」；Supabase 連線失敗、Auth 失敗、RLS 拒絕、手機斷線或 session 過期，都不會影響鍵盤（空白鍵／Enter／→／PageDown／←／PageUp／Esc）、滑鼠點擊、簡報筆與全螢幕（F）這些既有的本機操作。

### 資料不離開本機的範圍

參加者名單、員工編號、部門、完整得獎紀錄與獎項圖片一律只留在瀏覽器 localStorage，**不會**被送到 Supabase。會寫進 Supabase 的只有：

- `lottery_remote_sessions` 這張表：一組配對 session 的 id、頻道 topic、host／remote 的 `auth.uid()`、pairing token 的 **SHA-256 雜湊**（不存明文）、到期與撤銷時間。
- Realtime 私有頻道 `lottery:<session-id>` 上的 broadcast 訊息：只有 `RemoteMessage`（見 `lib/event-lottery-remote-types.ts`）裡定義的非敏感欄位，例如目前獎項「名稱」、本輪抽出人數、階段與 revision，**不含**參加者、員工編號、部門或完整得獎名單。

### Supabase 建置步驟

1. 建立一個 Supabase 專案，取得 Project URL 與 **publishable/anon key**（Settings → API）。
2. 用 Supabase CLI 套用 migration：

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   或直接把 `supabase/migrations/20260729120000_event_lottery_remote.sql` 的內容貼到 Supabase Dashboard 的 SQL Editor 執行。

3. **Dashboard 手動設定（migration 不含這些）**：
   - Authentication → Sign In / Providers：開啟 **Anonymous Sign-Ins**。這是手機遙控唯一使用的登入方式，只有電腦按下「啟用手機遙控」或手機開啟有效配對連結這兩種情況才會呼叫 `signInAnonymously()`，一般瀏覽控制台或舞台不會建立任何帳號。
   - Realtime：開啟 Realtime Authorization（private channel）功能，並**關閉「Allow public access」**；migration 已經幫 `realtime.messages` 加上限定 session 成員的 SELECT／INSERT policy。若保留 public access，頻道仍可能被未授權的公開連線加入。

4. 在 Vercel 專案設定新增環境變數（Production／Preview／Development 都要）：

   | 變數 | 說明 |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案的 Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 的 publishable／anon key |

   兩個變數都是 `NEXT_PUBLIC_` 開頭，代表會進到瀏覽器端——**絕對不要**把 service role key 或任何管理員權限的 secret key 放進這兩個變數或任何前端程式碼；`lib/supabase-browser.ts` 也只讀取這兩個變數。

### Realtime 權限摘要（RLS）

- `public.lottery_remote_sessions` 開啟 RLS 且不建立任何 policy：anon／authenticated 都不能直接讀寫這張表，所有存取一律經過三個 `SECURITY DEFINER` RPC（`create_lottery_remote_session`、`claim_lottery_remote_session`、`revoke_lottery_remote_session`），RPC 內部逐一檢查權限、token 雜湊、有效期限，且回傳值刻意不含 pairing token 雜湊本身。
- `realtime.messages` 只允許同時符合下列條件的 `authenticated` 使用者 SELECT／INSERT broadcast：`auth.uid()` 等於該 session 的 `host_user_id` 或 `remote_user_id`，且 session 未過期、`revoked_at is null`、頻道 topic 對得上 `lottery:<session-id>`。policy 透過 `SECURITY DEFINER` 的 `is_lottery_remote_session_member()` 檢查成員關係，不開放 session table 直接讀取。第一版沒有加入 Presence，只用 `REMOTE_HELLO`／`HOST_STATUS`／`ADVANCE_COMMAND`／`COMMAND_ACK`／`SESSION_REVOKED` 這幾種訊息，降低狀態來源與 RLS 複雜度。

### 重複命令與斷線恢復

- 每個手機指令帶一個 `crypto.randomUUID()` 產生的 `commandId`；舞台端把最近處理過的 100 筆 commandId 存在該 session 專屬的 localStorage，重複的 commandId 不會被執行第二次，只會重新回報目前狀態。
- 活動狀態額外維護一個遞增的 `stateRevision`；手機送指令時要附上它上次拿到的 `expectedRevision`，對不上就會被拒絕並附上最新 revision，逼手機用新的 `HOST_STATUS` 重新對齊。這個版本會涵蓋控制台、鍵盤、滑鼠、簡報筆與手機遙控的所有狀態變更，避免用舊畫面誤觸已經不成立的動作。
- 手機 2 秒沒收到 ACK 會用同一個 commandId 重送，最多 3 次；用完仍沒有 ACK 就顯示明確的失敗訊息，不會產生新的 commandId 重試同一次按下。
- 舞台每 3 秒發送一次 `HOST_STATUS` 心跳；手機超過 8 秒沒收到就停用按鈕並顯示「電腦舞台未連線」。
- 手機重新整理、切到背景再回來、或暫時斷網後重連，都會靠本機保留的 session 指標＋既有的匿名登入重新訂閱頻道，並且會先送 `REMOTE_HELLO` 等到收到 `HOST_STATUS` 才開放按鈕。
- 純邏輯（去重、revision、重送、心跳逾時判斷）拆在 `lib/event-lottery-remote.ts`，用 `tests/event-lottery-remote.test.mjs` 覆蓋，不需要真的架一個 WebSocket 就能測。

### Session 撤銷與到期、匿名使用者清理

- Session 預設 6 小時到期（`create_lottery_remote_session` 裡的 `now() + interval '6 hours'`），到期後 RLS 與舞台端都會拒絕該 session 的所有指令。
- 只有 host（建立 session 的電腦）可以呼叫 `revoke_lottery_remote_session` 撤銷；撤銷後同一支手機即使還連著也無法再送出任何被接受的指令。
- 建議另外設定排程（例如 Supabase 的 pg_cron，或 Dashboard 手動執行）定期清理：
  - `public.lottery_remote_sessions` 裡 `expires_at` 已經過去很久的舊紀錄。
  - `auth.users` 裡長期未使用、`is_anonymous = true` 的匿名帳號（Supabase 官方文件有提供建議的清理 SQL／排程做法）。

## 圖片去背

去背工具支援兩種模式，切換鈕在頁面上：

- **本機 AI（預設、免費）**：模型在 Web Worker 中執行，優先使用 WebGPU，無法使用時自動退回 WASM。首次使用會從 Hugging Face 下載 `briaai/RMBG-1.4` 模型，之後由瀏覽器快取。圖片檔案只會傳入使用者自己的 Worker，不經過本站 API，也不需要任何服務金鑰，完全免費、完全本機處理。`RMBG-1.4` 是 [BRIA 的非商業授權](https://huggingface.co/briaai/RMBG-1.4)，商用需另外向 BRIA 取得授權。
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
- `docs/`：架構盤點與設計決策紀錄
- `tests/`：伺服器渲染驗證與純邏輯單元測試

工具清單只有一份：`lib/tool-manifest.ts`。除了卡片要用的名稱、描述、分類之外，它還記錄每個工具「吃什麼格式、吐什麼格式、算在本機還是遠端、能不能批次、離線能不能用」，首頁、⌘K 命令面板與 sitemap 都從它推導。`lib/tools.ts` 是往後相容的卡片視圖，不另外維護資料。`tests/tool-manifest.test.mjs` 會驗證登記內容自洽，並確保 manifest 與 `app/tools/` 的路由一對一。

## 驗證

```bash
npm run lint
npm run build
npm test
```
