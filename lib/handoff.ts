/**
 * 工具接力：把某個工具的產出直接遞給下一個工具，省掉「下載 → 重新上傳」
 * 或「複製 → 貼上」。
 *
 * 內容只放在這個模組的記憶體變數裡，不進 localStorage、不進 IndexedDB，
 * 也不會離開這個分頁——與全站「資料留在本機」的前提一致。
 * 代價是硬重新整理後交接就消失，接收端會退回一般的空狀態，這是可接受的：
 * 接力本來就是「按下去、馬上跳過去」的一次性動作。
 */
export type HandoffKind = "file" | "text";

export type Handoff =
  | { kind: "file"; file: File; fromSlug: string }
  | { kind: "text"; text: string; fromSlug: string };

/** 超過這個時間的交接視為過期，避免上一頁停留很久後用上一頁／下一頁回來又被套用。 */
const HANDOFF_TTL_MS = 5 * 60_000;

let pending: (Handoff & { at: number }) | null = null;

export function putFileHandoff(file: File, fromSlug: string) {
  pending = { kind: "file", file, fromSlug, at: Date.now() };
}

export function putTextHandoff(text: string, fromSlug: string) {
  pending = { kind: "text", text, fromSlug, at: Date.now() };
}

/**
 * 取出並清空，但**只在種類相符時**才消費。
 *
 * 圖片工具與文字工具共用同一個交接槽，如果不分種類就取，
 * 使用者從文字清理送出文字、路上先掛載到某個圖片工具時，
 * 那個圖片工具會把文字取走又用不了，交接就這樣憑空消失。
 */
export function takeHandoff(kind: HandoffKind): Handoff | null {
  const current = pending;
  if (!current || current.kind !== kind) return null;
  pending = null;
  if (Date.now() - current.at > HANDOFF_TTL_MS) return null;
  return current.kind === "file"
    ? { kind: "file", file: current.file, fromSlug: current.fromSlug }
    : { kind: "text", text: current.text, fromSlug: current.fromSlug };
}

/** 吃圖片的工具。接力按鈕只列出這些，且會排除來源自己。 */
export const IMAGE_TOOL_SLUGS = [
  "background-remover",
  "image-crop",
  "image-compressor",
  "image-converter",
  "exif-cleaner",
] as const;

/** 吃純文字的工具。 */
export const TEXT_TOOL_SLUGS = [
  "text-cleaner",
  "chinese-converter",
  "text-compare",
  "markdown-editor",
] as const;

export type ImageToolSlug = (typeof IMAGE_TOOL_SLUGS)[number];
export type TextToolSlug = (typeof TEXT_TOOL_SLUGS)[number];

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
