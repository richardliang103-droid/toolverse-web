export type TextCleanerOptions = {
  trimLines: boolean;
  dropEmptyLines: boolean;
  dedupeLines: boolean;
  toHalfwidth: boolean;
  collapseSpaces: boolean;
  sort: "none" | "asc" | "desc";
  casing: "none" | "upper" | "lower";
};

export const DEFAULT_CLEANER_OPTIONS: TextCleanerOptions = {
  trimLines: true,
  dropEmptyLines: false,
  dedupeLines: false,
  toHalfwidth: false,
  collapseSpaces: false,
  sort: "none",
  casing: "none",
};

/** 全形英數與標點轉半形（U+FF01–FF5E → ASCII；全形空白 → 半形空白）。 */
export function fullwidthToHalfwidth(text: string) {
  return text
    .replaceAll("　", " ")
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

export function cleanText(input: string, options: TextCleanerOptions) {
  let lines = input.split(/\r?\n/);
  if (options.toHalfwidth) lines = lines.map(fullwidthToHalfwidth);
  if (options.trimLines) lines = lines.map((line) => line.trim());
  if (options.collapseSpaces) lines = lines.map((line) => line.replace(/[ \t]+/g, " "));
  if (options.dropEmptyLines) lines = lines.filter((line) => line.trim() !== "");
  if (options.dedupeLines) lines = [...new Set(lines)];
  if (options.sort !== "none") {
    lines = [...lines].sort((a, b) => a.localeCompare(b, "zh-Hant-TW"));
    if (options.sort === "desc") lines.reverse();
  }
  if (options.casing === "upper") lines = lines.map((line) => line.toUpperCase());
  if (options.casing === "lower") lines = lines.map((line) => line.toLowerCase());
  return lines.join("\n");
}

// Segmenter 建構成本高，模組層建一次重複用。
// grapheme：把「使用者看到的一個字」當一個單位——展開字串只切到 code point，
// 家庭 emoji（👨‍👩‍👧‍👦，ZWJ 連接）會被算成 7 個、國旗算 2 個，與直覺不符。
// word：中文沒有空格，靠 \S+ 之類的規則永遠切不出詞，只有 Segmenter 能斷詞。
const graphemeSegmenter = new Intl.Segmenter("zh-Hant", { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter("zh-Hant", { granularity: "word" });

/** 只數個數，不把片段收成陣列——字數統計每次輸入都會重算。 */
function countGraphemes(text: string) {
  const iterator = graphemeSegmenter.segment(text)[Symbol.iterator]();
  let count = 0;
  while (!iterator.next().done) count += 1;
  return count;
}

/** 詞數。只計 isWordLike 的片段，跳過空白與標點。 */
export function countWords(text: string) {
  let count = 0;
  for (const segment of wordSegmenter.segment(text)) if (segment.isWordLike) count += 1;
  return count;
}

export function textStats(text: string) {
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  return {
    characters: countGraphemes(text),
    charactersNoSpaces: countGraphemes(text.replace(/\s/g, "")),
    words: countWords(text),
    lines: lines.length,
    nonEmptyLines: nonEmpty.length,
    uniqueLines: new Set(nonEmpty).size,
  };
}
