/**
 * 內容指紋。用來提示「這份跟工作區裡某一份內容相同」，不是安全用途。
 *
 * `crypto.subtle` 在瀏覽器與 Node 22 都有，所以這個模組測得到。
 */
import { CHECKSUM_MAX_BYTES } from "./types.ts";

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? data.slice().buffer : data;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 算 Blob 的 checksum；過大就回 undefined。
 *
 * 大檔案要整份讀進記憶體才能算，150 MB 的合併 PDF 這樣做會讓畫面卡住，
 * 而 checksum 只是個「內容重複」的提示，不值得為它卡住主執行緒。
 */
export async function checksumOf(blob: Blob): Promise<string | undefined> {
  if (blob.size > CHECKSUM_MAX_BYTES) return undefined;
  return sha256Hex(await blob.arrayBuffer());
}
