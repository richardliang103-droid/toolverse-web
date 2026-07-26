# PR 4 完成紀錄：Handoff 遷移到 Workspace

這份文件原本是 PR 4 開工前的交接規格。PR 4 已由 [PR #48](https://github.com/richardliang103-droid/toolverse-web/pull/48) 完成並合併，因此改為記錄實際落地結果，避免後續維護者把過期待辦當成尚未完成的工作。

## 完成狀態

- 完成日期：2026-07-26
- 合併 PR：#48
- 功能狀態：已上線
- 自動測試：合併前 lint、TypeScript、單元測試與兩套 production build 皆通過
- 手動驗證：文字、單檔、批次檔案、重新整理保留、格式拒絕與 URL 清理皆已實測

## 實際架構

### Workspace 是唯一接力儲存層

`lib/handoff.ts` 不再使用模組層的單一記憶體槽。文字與檔案會先存入本機 Workspace，目的地 URL 只攜帶：

```text
?workspaceItem=<uuid>
```

Blob、文字內容與檔名不會放進 URL，也不會因為硬重新整理而消失。

### 使用者確認後才套用

接收端會依序：

1. 從 URL 讀取 Workspace 項目 ID。
2. 從 Workspace 讀取本機內容。
3. 驗證種類、MIME、副檔名、大小與工具能力。
4. 顯示來源與內容摘要。
5. 等使用者按下「確認帶入」後才套用，並移除 URL 參數。

取消或尚未確認時不會消費接力項目，因此重新整理頁面後仍可再次確認。

### 批次結果

圖片壓縮、圖片轉檔與 EXIF 清除可把整批結果存入同一個 handoff group。接收端依寫入順序還原，不再限制為單一結果。

### Manifest 是能力唯一真相

`lib/tool-manifest.ts` 已加入：

```ts
handoff: {
  canSend: boolean;
  canReceive: boolean;
  kinds: Array<"file" | "text">;
}
```

接力目的地從 manifest 推導，不再由 Smart Intake 與「送到工具」元件各自維護圖片、文字白名單。測試會掃描工具原始碼中的 `useHandoff`、`useTextHandoff`、`useHandoffFiles` 與 `SendToTools`，檢查實作是否和 manifest 漂移。

### Workspace 輸出

PDF 工具已可把產出存入 Workspace；共用的 `SaveToWorkspace` 元件負責這條流程。

## 主要檔案

- `lib/handoff.ts`：Workspace 接力讀寫、批次群組與來源名稱
- `components/use-handoff.ts`：接收驗證、確認／取消與 URL 清理
- `components/send-to-tools.tsx`：存入 Workspace 後導向目的工具
- `components/handoff-status.tsx`：使用者確認介面
- `components/save-to-workspace.tsx`：一般工具輸出存入 Workspace
- `lib/tool-manifest.ts`：工具接力能力
- `tests/handoff.test.mjs`：接力儲存與還原測試
- `tests/tool-manifest.test.mjs`：manifest 與原始碼一致性測試

## 已知限制

- Workspace 仍是瀏覽器本機儲存，不會跨裝置或跨瀏覽器同步。
- Safari 與 Firefox 的 OPFS 實機相容性仍建議另外驗證；不支援時會回退至 IndexedDB。
- URL 中的 UUID 可被使用者修改，但查無項目、種類不符或驗證失敗時會安全拒絕，不會直接套用。

## 下一階段

PR 5「個人首頁」尚未開始，建議範圍：

- Favorite：收藏工具，並整合既有命令面板搜尋。
- Recent：只記錄工具 slug，不記錄檔名或內容。
- 隱私設定：提供全站「不記錄最近使用」開關。
- 首頁 Workspace 摘要：顯示暫存項目數、用量、最近輸出與繼續處理入口。

開工前仍須遵守 `CLAUDE.md` 的雙建置與 PR 流程；AI 開 PR 後由 Richard 在 GitHub 合併。
