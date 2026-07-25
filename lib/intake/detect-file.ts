/**
 * 拖進來或選取的檔案型別偵測。純函式、零依賴。
 *
 * 偵測順序（對應指南 8.2 節）：
 * 1. 檔案開頭的 magic bytes——騙不了，副檔名改成什麼都沒用。
 * 2. 猜不出二進位格式時，試著當文字讀：JSON、CSV／TSV、SVG 都是純文字格式，
 *    沒有固定的位元組開頭，只能靠內容特徵判斷。
 * 3. 兩者都判斷不出來，才退回瀏覽器回報的 MIME 或副檔名——這兩個都是使用者
 *    或作業系統說了算，改檔名或換瀏覽器就會不一樣，只能當最後手段。
 * 4. 全部都判斷不出來就承認判斷不出來，不要硬猜。
 */
import { looksLikeCsv, looksLikeJson } from "./detect-text.ts";
import { FILE_SIGNATURES, type FileCategory } from "./signatures.ts";

export type FileDetectionSource = "magic-bytes" | "text-content" | "declared-mime" | "extension" | "unknown";

export interface FileTypeDetection {
  mimeType: string;
  category: FileCategory | "unknown";
  label: string;
  extension: string | null;
  confidence: number;
  source: FileDetectionSource;
  /** 偵測結果跟檔名副檔名或瀏覽器回報的 MIME 對不上——例如把 .txt 改名成 .png。 */
  mismatch: boolean;
}

const MIME_LABELS: Record<string, string> = {
  "image/png": "PNG 圖片",
  "image/jpeg": "JPEG 圖片",
  "image/gif": "GIF 圖片",
  "image/bmp": "BMP 圖片",
  "image/webp": "WebP 圖片",
  "image/svg+xml": "SVG 向量圖",
  "application/pdf": "PDF 文件",
  "audio/wav": "WAV 音訊",
  "audio/mpeg": "MP3 音訊",
  "audio/mp4": "M4A 音訊",
  "audio/ogg": "OGG 音訊",
  "text/csv": "CSV 表格",
  "text/tab-separated-values": "TSV 表格",
  "application/json": "JSON 資料",
};

/** 只給文字型格式用：這些格式沒有固定的位元組開頭，只能從副檔名猜起點。 */
const TEXT_EXTENSION_HINTS: Record<string, { mimeType: string; category: FileCategory }> = {
  ".csv": { mimeType: "text/csv", category: "csv" },
  ".tsv": { mimeType: "text/tab-separated-values", category: "csv" },
  ".json": { mimeType: "application/json", category: "json" },
  ".svg": { mimeType: "image/svg+xml", category: "image" },
};

/** 已知 MIME → category，合併二進位簽章表與文字副檔名提示，供「瀏覽器回報的 MIME 剛好也是我們認得的格式」這條退路查表。 */
const CATEGORY_BY_MIME: Record<string, FileCategory> = {
  ...Object.fromEntries(FILE_SIGNATURES.map((signature) => [signature.mimeType, signature.category])),
  ...Object.fromEntries(Object.values(TEXT_EXTENSION_HINTS).map((hint) => [hint.mimeType, hint.category])),
};

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : null;
}

/** .jpeg 跟簽章表裡的 .jpg 是同一種格式，不該被當成「副檔名對不上」。 */
const EXTENSION_ALIASES: Record<string, string> = { ".jpeg": ".jpg" };

function extensionMatches(actual: string, expected: string): boolean {
  const normalized = EXTENSION_ALIASES[actual] ?? actual;
  return normalized === expected;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    // fatal: 亂碼的二進位檔會丟例外，代表這份檔案不是文字，直接放棄文字偵測。
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 4096));
  } catch {
    return null;
  }
}

function detectFromTextContent(bytes: Uint8Array): { mimeType: string; category: FileCategory } | null {
  const text = decodeText(bytes);
  if (text === null) return null;
  const trimmed = text.trimStart();
  if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(trimmed)) return { mimeType: "image/svg+xml", category: "image" };
  if (looksLikeJson(text)) return { mimeType: "application/json", category: "json" };
  if (looksLikeCsv(text).matches) return { mimeType: "text/csv", category: "csv" };
  return null;
}

function labelFor(mimeType: string): string {
  return MIME_LABELS[mimeType] ?? mimeType;
}

/**
 * 偵測一個檔案的實際型別。`bytes` 只需要開頭幾 KB——所有簽章與內容嗅探
 * 都不需要讀完整個檔案，呼叫端可以只切 `file.slice(0, 4096)` 再轉成 bytes。
 */
export function detectFileType(input: { name: string; declaredType: string; bytes: Uint8Array }): FileTypeDetection {
  const extension = extensionOf(input.name);
  const declaredType = input.declaredType.toLowerCase().split(";")[0]?.trim() ?? "";

  const bySignature = FILE_SIGNATURES.find((signature) => signature.match(input.bytes));
  if (bySignature) {
    const mismatch = (declaredType !== "" && declaredType !== bySignature.mimeType) || (extension !== null && !extensionMatches(extension, bySignature.extension));
    return { mimeType: bySignature.mimeType, category: bySignature.category, label: labelFor(bySignature.mimeType), extension, confidence: 0.95, source: "magic-bytes", mismatch };
  }

  const byContent = detectFromTextContent(input.bytes);
  if (byContent) {
    const mismatch = declaredType !== "" && declaredType !== byContent.mimeType;
    return { mimeType: byContent.mimeType, category: byContent.category, label: labelFor(byContent.mimeType), extension, confidence: 0.75, source: "text-content", mismatch };
  }

  const declaredCategory = declaredType !== "" ? CATEGORY_BY_MIME[declaredType] : undefined;
  if (declaredCategory) {
    return { mimeType: declaredType, category: declaredCategory, label: labelFor(declaredType), extension, confidence: 0.5, source: "declared-mime", mismatch: false };
  }

  const hint = extension ? TEXT_EXTENSION_HINTS[extension] : undefined;
  if (hint) {
    return { mimeType: hint.mimeType, category: hint.category, label: labelFor(hint.mimeType), extension, confidence: 0.35, source: "extension", mismatch: false };
  }

  return { mimeType: declaredType || "application/octet-stream", category: "unknown", label: "未知格式", extension, confidence: 0, source: "unknown", mismatch: false };
}
