# PR 4 交接文件：Handoff 遷移到 Workspace

寫給接手這個 repo 的下一個 agent（不論是同一個 Claude session 還是換成 Codex）。目的是讓你不用重新讀完整段對話就能接著做 PR 4。

---

## 一、專案基本資訊

- Repo：`richardliang103-droid/toolverse-web`，本機路徑 `/Users/richard/Claude/toolverse-web`
- 正式站：https://toolverse-web.vercel.app（Vercel 自動部署 `main`）
- **開工前一定要先讀 [`CLAUDE.md`](../CLAUDE.md)**——雙建置鐵律、已知地雷、PR 流程都在那裡，這份文件不重複寫。
- 工作流程：開 feature branch → 開 PR → CI 綠 → **由 Richard 在 GitHub 合併**（AI 不可執行 `gh pr merge`）。

## 二、目前狀態（2026-07-25）

已合併到 `main`：

| PR | 內容 | 狀態 |
|---|---|---|
| #43 | Registry Foundation：`lib/tool-manifest.ts` 成為工具能力唯一真相 | 已合併 |
| #44 | Workspace Storage：IndexedDB metadata ＋ OPFS/IndexedDB Blob | 已合併 |
| #45 | Smart Intake：貼上文字／拖入檔案，推薦工具 | 已合併 |
| #46 | 補 Smart Intake 首頁標題與說明文字 | 待合併（CI 已綠，純文案＋CSS，無邏輯變動） |

**PR 4（本文件的主題）尚未開始寫程式**，只有下面的規格與已確認的部分決策。

## 三、PR 4 要做什麼

目標：把 Tool Handoff 從「模組層記憶體單槽」升級成「讀寫 Workspace」，解決現有機制的已知限制。

### 現有機制（`lib/handoff.ts`）的限制

```ts
let pending: (Handoff & { at: number }) | null = null;
```

- 硬重新整理後交接消失（只在記憶體）。
- 一次只能放一個項目，後放的覆蓋前一個。
- 批次結果（例如 exif-cleaner 一次處理 5 張照片）沒辦法整批遞交，只有 `soleResult`（單一結果）時才顯示「送到」按鈕。
- PDF、音訊、CSV 完全不在任何接力鏈裡。
- 5 分鐘 TTL，避免使用者用瀏覽器上一頁／下一頁回來時誤套用。

這些限制在 `docs/toolverse-architecture-audit.md` 第三節已經記錄過（那份文件是 PR 1 當時寫的初步盤點，Workspace 與 Smart Intake 是之後才做的，讀的時候留意日期）。

### 現有的兩份手寫白名單（要解決的核心問題）

```ts
// lib/handoff.ts
export const IMAGE_TOOL_SLUGS = ["background-remover", "image-crop", "image-compressor", "image-converter", "exif-cleaner"] as const;
export const TEXT_TOOL_SLUGS = ["text-cleaner", "chinese-converter", "text-compare", "markdown-editor"] as const;
```

這兩個陣列同時被兩個地方使用，且用途不完全一樣：

1. `components/send-to-tools.tsx` 的 `targets` prop——決定「送到 →」按鈕列出哪些目標。
2. `components/intake/smart-intake.tsx` 的 `IMAGE_RECEIVERS`／`TEXT_RECEIVERS`——決定點推薦工具時要不要呼叫 `putFileHandoff`/`putTextHandoff`。

**這兩個陣列剛好等於「目前已經呼叫 `useHandoff`／`useTextHandoff` 的工具清單」**——這是巧合維持出來的一致性，不是被強制保證的。新增一個工具、幫它接上 `useHandoff` 卻忘記把 slug 加進陣列，兩處呼叫端都會悄悄漏掉它，不會有任何測試或型別錯誤提醒你。

### 已經談過、我建議的 manifest 設計（⚠️ 未經 Richard 明確拍板，見第五節）

在 `lib/tool-manifest.ts` 的 `ToolManifest` 加一個欄位：

```ts
handoff: {
  canSend: boolean;   // 這個工具的結果能不能被「送到」別的工具（是否有 SendToTools 呼叫）
  canReceive: boolean; // 這個工具能不能接收別人送來的內容（是否有 useHandoff/useTextHandoff 呼叫）
  kinds: Array<"file" | "text" | "structured-data">; // 能收／送哪幾種
}
```

**理由**：直接描述「這個工具實際上接了什麼」，跟 `inputs`/`outputs`（描述「這個工具的格式能力」）是不同層次的事實——一個工具可能吃 PNG（`inputs` 有宣告）但沒有實作 `useHandoff`（`handoff.canReceive` 是 false，例如 favicon-generator）。

**驗證要補**（跟 PR 1 的 `validateToolManifests()` 同一套精神）：
- `handoff.canReceive: true` 但對應的工具頁沒有 `useHandoff`/`useTextHandoff` 呼叫——這個沒辦法用 runtime validation 抓（要讀原始碼），可以考慮寫一個 Node 腳本掃 `app/tools/*/​*.tsx` 有沒有 `useHandoff(` / `useTextHandoff(` 字串，跟 manifest 對照，當測試跑。**這是本 PR 的驗收重點之一**，因為現有的兩份白名單漏更新不會被抓到，正是要解決的問題。

`IMAGE_TOOL_SLUGS`／`TEXT_TOOL_SLUGS` 改成從 manifest 的 `handoff.canReceive`（依 kind 分）動態算出，`send-to-tools.tsx` 與 `smart-intake.tsx` 兩處呼叫端都改讀 manifest，不再各自 import 寫死的陣列。

### Workspace 整合（PR 2 已經做好的地基）

`lib/workspace/` 已經有完整的 repository（`lib/workspace/repository.ts`）、IndexedDB／OPFS 後端、`/workspace` 頁面。PR 4 要做的整合：

1. **接力目標改成走 Workspace**：`putFileHandoff`/`putTextHandoff` 內部改成呼叫 `getWorkspaceRepository().save(...)`，`takeHandoff` 改成從 Workspace 讀（用一個 URL query 或 sessionStorage 存最後一次存進 Workspace 的 item id，讓接收端知道要讀哪一筆）。
2. **URL 契約**：指南原文建議 `/tools/image-compress?workspaceItem=<uuid>`，不要把 Blob 或大型文字塞進 URL——只放 `workspaceItem` 的 uuid，接收端自己去 Workspace repository 讀。
3. **批次遞交**：既然 Workspace 可以存多個項目，`exif-cleaner`／`image-compressor`／`image-converter`（都是 `supportsBatch: true`）處理完一批之後，應該能把整批結果存進 Workspace，而不是只有 `soleResult` 時才能送。
4. **PDF 入鏈**：`pdf-toolkit` 目前完全不在任何接力鏈裡，合併／取頁完成後應該能存進 Workspace（`supportsWorkspace` 這個 manifest 欄位從 PR 1 開始就存在，目前全部工具都是 `false`，這是第一批要改成 `true` 的候選）。
5. **相容性驗證**：指南原文明確要求接收端要「讀取 `workspaceItem` → 從 Workspace Repository 取得 Blob → 驗證 MIME、大小與格式 → 顯示來源 → 讓使用者確認後開始處理」，不要讓頁面直接依賴未驗證的 URL query。

### 舊機制怎麼處理

`lib/handoff.ts` 現有的記憶體版 API（`putFileHandoff`/`putTextHandoff`/`takeHandoff`）在 PR 4 之後應該整個由 Workspace 版取代，不要兩套並存——兩套接力機制同時存在只會讓之後的人搞不清楚該用哪個。舊的 `tests/handoff.test.mjs`（55 行，測交接種類不互吃、TTL、覆蓋語意）要跟著改寫成測 Workspace 版的等價行為，不是刪掉不測。

## 四、PR 4 之後：PR 5 個人首頁（尚未開始）

- Favorite：工具卡加愛心按鈕，localStorage 存，⌘K 可搜尋。
- Recent：**只記工具 slug，不記檔名或內容**（見下方第五節的已確認事項），最多顯示 6 個。
- Workspace 摘要：首頁顯示暫存檔案數量、用量、最近輸出、「繼續處理」按鈕——直接複用 PR 2 的 `useWorkspace()` hook（`components/workspace/use-workspace.ts`），不要重寫一套。
- ⌘K 命令面板（`components/command-palette.tsx`）擴充搜尋範圍到 Favorite／Recent／可接受格式，不要另建第二套面板。

## 五、需要 Richard 明確回覆的事項（不要假設已經確認）

1. **PR 4 的 `handoff` manifest 欄位形狀**：第三節那個設計是我單方面提出的建議，Richard 沒有明確說「就用這個」。開工前最好用一句話跟他確認，或者他已經看過這份文件、默認同意也可以直接做，但要留意「他沒反對」不等於「他確認過」——之前有一次我在 PR 說明裡寫「上次已確認」，其實只是我自己提議、他沒有明確覆核，這個習慣要改掉。
2. **Recent tools 的隱私設定**：Richard review 時要求「提供『不記錄最近使用』設定」，這件事在 PR 5 動工前要確認範圍（是全站一個開關，還是每個工具各自的選項）。
3. **Safari／Firefox 手動測試**：PR 2（Workspace／OPFS）跟 PR 3（Smart Intake）都只在 Chromium 測試面板裡驗證過，沒有實機測過 Safari 與 Firefox。這兩個瀏覽器的 OPFS 支援度差異最大，是目前最大的驗證缺口，建議排時間讓 Richard 或另一個 agent 實機測一輪。

## 六、開發時務必注意的技術陷阱

這些是這次做 PR 1-3 時踩過的坑，寫下來讓你不用重踩一次：

1. **`lib/` 內的相對匯入要寫出 `.ts` 副檔名**（例如 `import { tools } from "./tools.ts"`，不是 `"./tools"`）。原因：這些模組會被 `node --test --experimental-strip-types` 直接載入，Node 的 ESM 解析器不會自動補副檔名（bundler 才會）。`tsconfig.json` 已經開了 `allowImportingTsExtensions` 來配合。
2. **新測試檔要同時加進 `package.json` 的 `test` 與 `test:unit` 兩個 script**，明列檔名，不能用目錄萬用字元。
3. **react-hooks/set-state-in-effect** 這條 ESLint 規則會擋在 `useEffect` 本體裡直接同步呼叫 `setState`（即使只有某個分支）。要嘛整段邏輯都走同一個 `setTimeout`（哪怕是 0ms），要嘛用其他方式避開直接同步呼叫。`components/intake/smart-intake.tsx` 的文字 debounce 邏輯是一個範例。
4. **manifest 的 `suggestedNextTools`／未來的 `handoff.canReceive` 都要讓測試去對照實際程式碼**，不要只靠人工核對——這正是 22 個工具漂移成 19 個工具的舊教訓，也是這兩份白名單一直沒被自動驗證的原因。
5. **`downloadBlob` 住在 `lib/download.ts`**（`lib/download-zip.ts` 只是 re-export，為了不把 `fflate` 拖進不需要打包的頁面）。需要下載但不需要打包 ZIP 的地方，直接 import `@/lib/download`。
6. **OPFS 偵測要用「實際試寫一次」而不是 feature detection**（見 `lib/workspace/opfs.ts`）——`navigator.storage.getDirectory` 存在不代表 `createWritable()` 能用。
7. **Workspace 的 metadata 記著每個項目當初存在哪個後端**（`storageBackend` 欄位），讀取／刪除都要照那個後端去找，不能一律用「目前選中的後端」，否則舊項目會讀不到。

## 七、驗證指令

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build:vercel
```

改完之後用 `npx next start` 起 production build，至少抽查：`/`、`/workspace`、涉及改動的工具頁。瀏覽器手動測試建議照 PR 2／PR 3 的 PR 說明格式走一遍（拖放 → 確認重新整理後還在 → 確認網路請求是 0 筆）。

## 八、Richard 的協作習慣（供接手的 agent 參考）

- 繁體中文（台灣用詞），指令精簡，期望自主做完整段（實作→驗證→PR）再回報，不喜歡被反覆詢問細節。
- 給的 code review 通常很具體（完成度百分比、做得好／要修正、下一步順序），照著做即可，不需要每一條都反問確認。
- 設計品味：日系和紙質感、和色（縹 #5F83A8、鴇 #CF7F8D、松葉 #7D9A63、藤 #9B8BBF），明確拒絕過「預設的 AI 感」——不要引入外部 UI 元件庫（曾評估過 uiverse.io/galaxy，因為風格跟現有設計語彙不合而放棄，維持沿用 `.panel`／`.drop-zone` 那套硬邊陰影語彙）。
- 完成標準是 CI 綠＋回報等他合併；PR 描述要包含：本 PR 目標／實際修改檔案／架構決策／資料是否離開瀏覽器／新增依賴與授權／自動測試結果／手動測試／已知限制／後續建議／截圖或錄影（CLAUDE.md 沒寫這個格式，是 Richard 額外要求的，見他一開始給的實作指南第十九節）。
