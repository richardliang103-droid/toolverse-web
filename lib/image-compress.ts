export type OutputFormat = "original" | "jpeg" | "png" | "webp";

export const QUALITY_FORMATS = new Set(["jpeg", "webp"]);

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 等比縮小到長邊不超過 maxEdge；0 表示不縮放。回傳整數尺寸，至少 1px。 */
export function fitDimensions(width: number, height: number, maxEdge: number) {
  if (maxEdge <= 0 || Math.max(width, height) <= maxEdge) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function mimeForFormat(format: OutputFormat, sourceMime: string) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return sourceMime === "image/png" || sourceMime === "image/webp" ? sourceMime : "image/jpeg";
}

export function outputFilename(sourceName: string, mime: string) {
  const base = sourceName.replace(/\.[^.]+$/, "") || "image";
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${base}-compressed.${extension}`;
}

/** 節省比例（0–100）；壓完反而變大時回傳 0。 */
export function savingsPercent(originalBytes: number, compressedBytes: number) {
  if (originalBytes <= 0 || compressedBytes >= originalBytes) return 0;
  return Math.round(((originalBytes - compressedBytes) / originalBytes) * 100);
}
