/**
 * 工具接力：把某個工具的產出直接遞給下一個工具，省掉「下載 → 重新上傳」。
 *
 * 檔案只放在這個模組的記憶體變數裡，不進 localStorage、不進 IndexedDB，
 * 也不會離開這個分頁——與全站「資料留在本機」的前提一致。
 * 代價是硬重新整理後交接就消失，接收端會退回一般的空狀態，這是可接受的：
 * 接力本來就是「按下去、馬上跳過去」的一次性動作。
 */
export type Handoff = { file: File; fromSlug: string };

/** 超過這個時間的交接視為過期，避免上一頁停留很久後用上一頁／下一頁回來又被套用。 */
const HANDOFF_TTL_MS = 5 * 60_000;

let pending: (Handoff & { at: number }) | null = null;

export function putHandoff(file: File, fromSlug: string) {
  pending = { file, fromSlug, at: Date.now() };
}

/** 取出並清空。消費一次就沒了，重新掛載不會重複套用同一個檔案。 */
export function takeHandoff(): Handoff | null {
  const current = pending;
  pending = null;
  if (!current) return null;
  if (Date.now() - current.at > HANDOFF_TTL_MS) return null;
  return { file: current.file, fromSlug: current.fromSlug };
}

/** 吃圖片的工具。接力按鈕只列出這些，且會排除來源自己。 */
export const IMAGE_TOOL_SLUGS = [
  "background-remover",
  "image-crop",
  "image-compressor",
  "image-converter",
  "exif-cleaner",
] as const;

export type ImageToolSlug = (typeof IMAGE_TOOL_SLUGS)[number];

/** 把 Blob 包成帶檔名的 File，接收端的副檔名檢查才會過。 */
export function toHandoffFile(blob: Blob, name: string) {
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

/** 批次工具的入口收 FileList；把單一交接檔包成 FileList 就能沿用原本的載入路徑。 */
export function fileListOf(file: File): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer.files;
}
