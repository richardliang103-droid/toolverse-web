export type CsvDelimiter = "," | ";" | "\t";

// Excel 在使用者的 Windows 地區設定「清單分隔符號」不是逗號時，直接雙擊開啟
// CSV 會整列塞進同一欄——這是造成「下載下來編輯，重新打開欄位全部合併在一起」
// 最常見的原因，跟檔案內容本身無關。在檔案第一列放一個 Excel 認得的 `sep=X`
// 宣告列，可以強制 Excel 用指定分隔符號開啟，不受使用者當下的地區設定影響。
const SEP_DIRECTIVE = /^sep=(.)\r?\n/;

/** 去掉 BOM，並在偵測到 `sep=X` 宣告列時一併去掉那一列，避免它被誤判成資料列；
 *  宣告的分隔符號一併回傳，讓呼叫端可以直接採用，不需要再用啟發式猜一次。 */
function stripBomAndSepDirective(text: string): { delimiter: CsvDelimiter | null; rest: string } {
  const withoutBom = text.replace(/^﻿/, "");
  const match = withoutBom.match(SEP_DIRECTIVE);
  if (!match) return { delimiter: null, rest: withoutBom };
  const char = match[1];
  const delimiter: CsvDelimiter | null = char === "," || char === ";" || char === "\t" ? char : null;
  return { delimiter, rest: withoutBom.slice(match[0].length) };
}

/** 從前幾行猜分隔符：優先採用 `sep=X` 宣告，否則從逗號、分號、Tab 取出現最穩定的一個。 */
export function detectDelimiter(text: string): CsvDelimiter {
  const { delimiter: declared, rest } = stripBomAndSepDirective(text);
  if (declared) return declared;
  const lines = rest.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 10);
  if (lines.length === 0) return ",";
  const candidates: CsvDelimiter[] = [",", ";", "\t"];
  let best: CsvDelimiter = ",";
  let bestScore = -1;
  for (const delimiter of candidates) {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const min = Math.min(...counts);
    if (min > 0 && min > bestScore) { bestScore = min; best = delimiter; }
  }
  return best;
}

/** 解析 CSV／TSV：支援引號欄位、欄內分隔符與換行、"" 跳脫、BOM、`sep=X` 宣告列。 */
export function parseDelimited(text: string, delimiter: CsvDelimiter = ","): string[][] {
  const { rest: source } = stripBomAndSepDirective(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { row.push(field); field = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((item) => item !== "")) rows.push(row);
  // 對齊欄數：短列補空字串
  const width = Math.max(0, ...rows.map((item) => item.length));
  return rows.map((item) => [...item, ...Array.from({ length: width - item.length }, () => "")]);
}

function encodeField(value: string, delimiter: CsvDelimiter): string {
  return value.includes(delimiter) || /["\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** 序列化為 CSV 文字（含 BOM 讓 Excel 以 UTF-8 開啟）。 */
export function toDelimitedText(rows: string[][], delimiter: CsvDelimiter = ","): string {
  return `﻿${rows.map((row) => row.map((field) => encodeField(field, delimiter)).join(delimiter)).join("\r\n")}`;
}

/** 轉 JSON：首列為欄名時輸出物件陣列，否則輸出二維陣列。 */
export function toJsonText(rows: string[][], headerRow: boolean): string {
  if (!headerRow || rows.length === 0) return JSON.stringify(rows, null, 2);
  const headers = rows[0].map((name, index) => name.trim() || `欄位${index + 1}`);
  const records = rows.slice(1).map((row) => Object.fromEntries(headers.map((name, index) => [name, row[index] ?? ""])));
  return JSON.stringify(records, null, 2);
}

/** 依某欄排序（數字欄用數值比較，其餘用 zh 排序）；headerRow 時首列固定。 */
export function sortRows(rows: string[][], column: number, direction: "asc" | "desc", headerRow: boolean): string[][] {
  const head = headerRow ? rows.slice(0, 1) : [];
  const body = headerRow ? rows.slice(1) : [...rows];
  const numeric = body.length > 0 && body.every((row) => row[column]?.trim() === "" || Number.isFinite(Number(row[column])));
  const collator = new Intl.Collator("zh-Hant");
  body.sort((a, b) => {
    const left = a[column] ?? "";
    const right = b[column] ?? "";
    const compared = numeric ? Number(left || 0) - Number(right || 0) : collator.compare(left, right);
    return direction === "asc" ? compared : -compared;
  });
  return [...head, ...body];
}
