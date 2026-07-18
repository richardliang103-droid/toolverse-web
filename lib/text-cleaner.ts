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

export function textStats(text: string) {
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const nonEmpty = lines.filter((line) => line.trim() !== "");
  return {
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, "")].length,
    lines: lines.length,
    nonEmptyLines: nonEmpty.length,
    uniqueLines: new Set(nonEmpty).size,
  };
}
