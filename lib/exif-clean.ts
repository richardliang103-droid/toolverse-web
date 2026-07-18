export type RemovedSegment = { label: string; bytes: number };
export type CleanResult = { cleaned: Uint8Array; removed: RemovedSegment[] };

// 無損移除影像 metadata：只搬移位元組、不重新編碼，畫質完全不變。
// JPEG 走 segment 流、PNG 走 chunk 流；兩者都不需要解碼影像內容。

const JPEG_KEEP_APP = new Set([
  0xe0, // APP0 JFIF — 基本標頭
  0xe2, // APP2 ICC — 色彩描述檔，移除會讓顏色跑掉
  0xee, // APP14 Adobe — CMYK JPEG 解碼需要
]);

const JPEG_LABELS: Record<number, string> = {
  0xe1: "EXIF／XMP（拍攝時間、相機、可能含 GPS 位置）",
  0xe3: "APP3 metadata",
  0xe4: "APP4 metadata",
  0xe5: "APP5 metadata",
  0xe6: "APP6 metadata",
  0xe7: "APP7 metadata",
  0xe8: "APP8 metadata",
  0xe9: "APP9 metadata",
  0xea: "APP10 metadata",
  0xeb: "APP11 metadata",
  0xec: "APP12 圖片資訊",
  0xed: "IPTC／Photoshop 資訊",
  0xef: "APP15 metadata",
  0xfe: "註解（COM）",
};

export function isJpeg(bytes: Uint8Array) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array) {
  return bytes.length > 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** 走訪 JPEG segment，丟棄含個資的 APPn／COM；遇到 SOS 之後原樣保留到檔尾。 */
export function stripJpegMetadata(bytes: Uint8Array): CleanResult {
  if (!isJpeg(bytes)) throw new Error("不是有效的 JPEG 檔案");
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed: RemovedSegment[] = [];
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("JPEG 結構異常，為安全起見不處理");
    const marker = bytes[offset + 1];
    if (marker === 0xda) { // SOS：影像資料開始，其後原樣保留
      parts.push(bytes.subarray(offset));
      break;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const segmentEnd = offset + 2 + length;
    if (length < 2 || segmentEnd > bytes.length) throw new Error("JPEG 結構異常，為安全起見不處理");
    const isMetadata = (marker >= 0xe1 && marker <= 0xef && !JPEG_KEEP_APP.has(marker)) || marker === 0xfe;
    if (isMetadata) removed.push({ label: JPEG_LABELS[marker] ?? `APP${marker - 0xe0} metadata`, bytes: segmentEnd - offset });
    else parts.push(bytes.subarray(offset, segmentEnd));
    offset = segmentEnd;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const cleaned = new Uint8Array(total);
  let position = 0;
  for (const part of parts) { cleaned.set(part, position); position += part.length; }
  return { cleaned, removed };
}

const PNG_DROP_CHUNKS = new Map([
  ["tEXt", "文字註記"],
  ["zTXt", "壓縮文字註記"],
  ["iTXt", "國際化文字註記（可能含 XMP）"],
  ["tIME", "最後修改時間"],
  ["eXIf", "EXIF（拍攝資訊、可能含 GPS 位置）"],
]);

/** 走訪 PNG chunk，丟棄文字／時間／EXIF 附註；chunk 自帶 CRC，整塊移除不需重算。 */
export function stripPngMetadata(bytes: Uint8Array): CleanResult {
  if (!isPng(bytes)) throw new Error("不是有效的 PNG 檔案");
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: RemovedSegment[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("PNG 結構異常，為安全起見不處理");
    const dropLabel = PNG_DROP_CHUNKS.get(type);
    if (dropLabel) removed.push({ label: dropLabel, bytes: chunkEnd - offset });
    else parts.push(bytes.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const cleaned = new Uint8Array(total);
  let position = 0;
  for (const part of parts) { cleaned.set(part, position); position += part.length; }
  return { cleaned, removed };
}

export function stripImageMetadata(bytes: Uint8Array): CleanResult {
  if (isJpeg(bytes)) return stripJpegMetadata(bytes);
  if (isPng(bytes)) return stripPngMetadata(bytes);
  throw new Error("目前支援 JPG 與 PNG（無損處理）；其他格式請先轉檔");
}

export function cleanedFilename(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-clean${name.slice(dot)}` : `${name}-clean`;
}
