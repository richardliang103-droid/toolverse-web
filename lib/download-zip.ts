import { zipSync } from "fflate";

export type ZipEntry = { name: string; blob: Blob };

function uniqueName(name: string, used: Set<string>) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}${extension}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

/** 將少量本機產生的檔案打成 ZIP；避免瀏覽器攔截連續下載。 */
export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const used = new Set<string>();
  const files = Object.fromEntries(await Promise.all(entries.map(async ({ name, blob }) => [
    uniqueName(name || "download", used),
    new Uint8Array(await blob.arrayBuffer()),
  ])));
  const archive = zipSync(files, { level: 6 });
  // 複製到明確的 ArrayBuffer，避免 TypeScript 將 fflate 的 ArrayBufferLike 視為 SharedArrayBuffer。
  const copy = new Uint8Array(archive.byteLength);
  copy.set(archive);
  return new Blob([copy.buffer], { type: "application/zip" });
}

// downloadBlob 已搬到 lib/download.ts（那裡不需要 fflate）。這裡繼續匯出，
// 讓同時要打包又要下載的工具維持單一 import。
export { downloadBlob } from "./download.ts";
