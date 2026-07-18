/**
 * 解析頁碼範圍字串（如 "1-3, 5, 8-6"）為 0-based 頁索引陣列。
 * 保留使用者輸入順序、允許倒序範圍（8-6 → 8,7,6）、去除重複；
 * 超出 totalPages 或格式錯誤會 throw，訊息可直接顯示給使用者。
 */
export function parsePageRanges(input: string, totalPages: number) {
  const text = input.trim();
  if (!text) throw new Error("請輸入要取出的頁碼，例如 1-3,5");
  const indexes: number[] = [];
  const seen = new Set<number>();
  for (const rawPart of text.split(/[,，、]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (!match) throw new Error(`「${part}」不是有效的頁碼或範圍`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end < 1) throw new Error("頁碼從 1 開始");
    if (start > totalPages || end > totalPages) throw new Error(`頁碼超出範圍：這份 PDF 共 ${totalPages} 頁`);
    const step = start <= end ? 1 : -1;
    for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
      if (!seen.has(page - 1)) { seen.add(page - 1); indexes.push(page - 1); }
    }
  }
  if (indexes.length === 0) throw new Error("請輸入要取出的頁碼，例如 1-3,5");
  return indexes;
}

export function describeSelection(indexes: number[], totalPages: number) {
  return `已選 ${indexes.length} 頁（共 ${totalPages} 頁）`;
}

export function mergedFilename(names: string[]) {
  const first = (names[0] ?? "merged").replace(/\.pdf$/i, "").slice(0, 40) || "merged";
  return names.length > 1 ? `${first}-合併${names.length}份.pdf` : `${first}.pdf`;
}

export function extractedFilename(name: string) {
  const base = name.replace(/\.pdf$/i, "").slice(0, 40) || "pages";
  return `${base}-選取頁.pdf`;
}
