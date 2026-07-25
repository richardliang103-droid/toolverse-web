/**
 * 檔案的 magic bytes 特徵表。
 *
 * 只收錄目前站上至少一個工具實際會吃的格式（見 `lib/tool-manifest.ts` 的
 * `inputs`）——這不是通用檔案格式偵測器，多收錄用不到的格式只會增加誤判面。
 *
 * 副檔名可以隨便改，但檔案開頭的位元組騙不了：偽造成 .png 的文字檔，
 * 這裡照樣認不出 PNG 特徵。這正是 Smart Intake 「不能只信副檔名」的依據。
 */

export type FileCategory = "image" | "pdf" | "audio" | "csv" | "json";

export interface FileSignature {
  mimeType: string;
  category: FileCategory;
  extension: string;
  match(bytes: Uint8Array): boolean;
}

function bytesAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) if (bytes[offset + i] !== expected[i]) return false;
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return bytesAt(bytes, offset, [...text].map((char) => char.charCodeAt(0)));
}

/** RIFF 容器（WAV／WebP 都是這個外殼，用 offset 8 的四字元識別實際內容）。 */
function isRiff(bytes: Uint8Array, kind: string): boolean {
  return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, kind);
}

export const FILE_SIGNATURES: readonly FileSignature[] = [
  { mimeType: "image/png", category: "image", extension: ".png", match: (b) => bytesAt(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: "image/jpeg", category: "image", extension: ".jpg", match: (b) => bytesAt(b, 0, [0xff, 0xd8, 0xff]) },
  { mimeType: "image/gif", category: "image", extension: ".gif", match: (b) => asciiAt(b, 0, "GIF87a") || asciiAt(b, 0, "GIF89a") },
  { mimeType: "image/bmp", category: "image", extension: ".bmp", match: (b) => asciiAt(b, 0, "BM") },
  { mimeType: "image/webp", category: "image", extension: ".webp", match: (b) => isRiff(b, "WEBP") },
  { mimeType: "application/pdf", category: "pdf", extension: ".pdf", match: (b) => asciiAt(b, 0, "%PDF-") },
  { mimeType: "audio/wav", category: "audio", extension: ".wav", match: (b) => isRiff(b, "WAVE") },
  { mimeType: "audio/ogg", category: "audio", extension: ".ogg", match: (b) => asciiAt(b, 0, "OggS") },
  // ftyp box 出現在 offset 4，前 4 byte 是 box 大小（值本身不固定，不檢查）。
  { mimeType: "audio/mp4", category: "audio", extension: ".m4a", match: (b) => asciiAt(b, 4, "ftyp") },
  {
    mimeType: "audio/mpeg",
    category: "audio",
    extension: ".mp3",
    // 有 ID3 標籤的 MP3 以 "ID3" 開頭；沒有標籤的直接以 frame sync 開頭
    // （11 個 1 bit：byte0 全 1，byte1 高 3 bit 全 1）。
    match: (b) => asciiAt(b, 0, "ID3") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  },
];

/** 依 category 找出人看得懂的說法，用於推薦卡片與偵測結果標籤。 */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: "圖片",
  pdf: "PDF 文件",
  audio: "音訊",
  csv: "CSV／TSV 表格",
  json: "JSON 資料",
};
