/**
 * 貼上文字的型別偵測。純函式、零依賴。
 *
 * 檢查順序是刻意的：先驗證比較嚴格、不容易誤判的格式（mermaid 關鍵字、合法 JSON、
 * 單一網址），再驗證比較寬鬆、容易跟別的格式撞在一起的格式（CSV 的「有分隔符」
 * 特徵可能出現在其他格式裡），一般段落永遠是最後的保底。
 */

export type IntakeTextType = "mermaid" | "json" | "markdown" | "url" | "base64" | "csv" | "date-list" | "name-list" | "paragraph" | "empty";

export interface TextTypeDetection {
  type: IntakeTextType;
  confidence: number;
}

const MERMAID_KEYWORDS = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|gantt|pie|erDiagram|journey|mindmap|timeline)\b/;
const URL_PATTERN = /^(https?:\/\/|www\.)[^\s]+$/i;
// 標準 Base64 字母表；允許內部換行（常見的多行貼上），但不允許字母表以外的字元。
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const MARKDOWN_HEADING = /^#{1,6}\s+\S/m;
const MARKDOWN_LIST = /^\s*([-*+]|\d+\.)\s+\S/m;
const MARKDOWN_CODE_FENCE = /^```/m;
const MARKDOWN_LINK = /\[[^\]]+\]\([^)]+\)/;
const MARKDOWN_TABLE = /^\s*\|.+\|\s*$/m;
const MARKDOWN_BOLD = /\*\*[^*]+\*\*/;
// ISO（2026-07-25）、斜線（2026/7/25、7/25）與中文（7月25日、2026年7月25日）三種常見寫法。
const DATE_LINE = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}|\d{1,4}年\d{1,2}月\d{1,2}日?|\d{1,2}月\d{1,2}日?)$/;

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}

/** 供 `detect-file.ts` 對「猜不出二進位格式、試著當文字讀」的檔案重用。 */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || !(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * CSV／TSV 的判斷方式：多數非空行的欄位數一致（同一個分隔符切出 ≥2 欄）。
 * 一般段落裡的逗號很常見，但很少每一行都恰好被逗號切成同樣的欄位數。
 */
export function looksLikeCsv(text: string): { matches: boolean; ratio: number; delimiter: "," | "\t" } {
  const lines = nonEmptyLines(text);
  if (lines.length < 2) return { matches: false, ratio: 0, delimiter: "," };

  const delimiter: "," | "\t" = lines[0].includes("\t") ? "\t" : ",";
  const fieldCounts = lines.map((line) => line.split(delimiter).length);
  const expected = fieldCounts[0];
  if (expected < 2) return { matches: false, ratio: 0, delimiter };

  const consistent = fieldCounts.filter((count) => count === expected).length;
  const ratio = consistent / fieldCounts.length;
  return { matches: ratio >= 0.8, ratio, delimiter };
}

function looksLikeMarkdown(text: string): number {
  const signals = [MARKDOWN_CODE_FENCE, MARKDOWN_HEADING, MARKDOWN_TABLE, MARKDOWN_LIST, MARKDOWN_LINK, MARKDOWN_BOLD].filter((pattern) => pattern.test(text)).length;
  // 程式碼區塊單獨出現就夠明確；其餘訊號至少要湊到兩種，避免一行「1. 待辦」
  // 這種平常文字裡也很常見的寫法被誤判。
  if (MARKDOWN_CODE_FENCE.test(text)) return 0.9;
  if (signals >= 2) return Math.min(0.5 + signals * 0.1, 0.9);
  return 0;
}

function looksLikeBase64(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  // 太短的話一般字詞也很容易湊巧全部落在 base64 字母表裡，不值得判定。
  if (compact.length < 24 || compact.length % 4 !== 0) return false;
  return BASE64_BODY.test(compact);
}

/** 多數非空行都像「一個名字」：字數少、沒有句子結尾標點。 */
function nameListRatio(lines: string[]): number {
  if (lines.length === 0) return 0;
  const nameLike = lines.filter((line) => line.length <= 24 && !/[。.!?！？]$/.test(line) && !/\s{2,}/.test(line));
  return nameLike.length / lines.length;
}

function dateListRatio(lines: string[]): number {
  if (lines.length === 0) return 0;
  return lines.filter((line) => DATE_LINE.test(line)).length / lines.length;
}

/**
 * 偵測貼上文字的型別。空字串回傳 `"empty"`，信心 0——呼叫端不該把這個當成
 * 「判斷不出來的一般段落」，而是根本沒有內容可判斷。
 */
export function detectTextType(raw: string): TextTypeDetection {
  const text = raw.slice(0, 50_000); // 避免超長貼上讓正規表示式跑很久
  const trimmed = text.trim();
  if (trimmed === "") return { type: "empty", confidence: 0 };

  if (MERMAID_KEYWORDS.test(trimmed)) return { type: "mermaid", confidence: 0.9 };
  if (looksLikeJson(trimmed)) return { type: "json", confidence: 0.95 };

  const markdownConfidence = looksLikeMarkdown(text);
  if (markdownConfidence > 0) return { type: "markdown", confidence: markdownConfidence };

  if (URL_PATTERN.test(trimmed)) return { type: "url", confidence: 0.95 };
  if (looksLikeBase64(trimmed)) return { type: "base64", confidence: 0.6 };

  const csv = looksLikeCsv(text);
  if (csv.matches) return { type: "csv", confidence: 0.6 + csv.ratio * 0.3 };

  const lines = nonEmptyLines(text);
  const dateRatio = dateListRatio(lines);
  if (lines.length >= 2 && dateRatio >= 0.7) return { type: "date-list", confidence: 0.5 + dateRatio * 0.3 };

  const nameRatio = nameListRatio(lines);
  if (lines.length >= 2 && nameRatio >= 0.7) return { type: "name-list", confidence: 0.4 + nameRatio * 0.3 };

  return { type: "paragraph", confidence: 0.5 };
}
