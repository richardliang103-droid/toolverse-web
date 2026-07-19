export type DiffGranularity = "line" | "word" | "char";

export type DiffOptions = {
  granularity: DiffGranularity;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
};

export type DiffOp = { type: "equal" | "remove" | "add"; text: string };

export type DiffRow =
  | { kind: "equal"; left: string; right: string }
  | { kind: "remove"; left: string }
  | { kind: "add"; right: string }
  | { kind: "modify"; left: string; right: string };

export type DiffStats = { added: number; removed: number; modified: number };

export const DEFAULT_DIFF_OPTIONS: DiffOptions = { granularity: "line", ignoreCase: false, ignoreWhitespace: false };

function tokenize(text: string, granularity: DiffGranularity): string[] {
  if (granularity === "line") return text.split(/\r?\n/);
  if (granularity === "word") return text.match(/\S+|\s+/g) ?? [];
  return Array.from(text);
}

function normalizeToken(token: string, options: DiffOptions): string {
  let result = token;
  if (options.ignoreWhitespace) result = result.replace(/\s+/g, " ").trim();
  if (options.ignoreCase) result = result.toLowerCase();
  return result;
}

// 比較上限：超過就退回「整段不同」的粗略結果，避免 DP 卡住瀏覽器。
const MAX_CELLS = 4_000_000;

/**
 * LCS 動態規劃 diff。回傳的 text 一律是「原始」token（比較時才做
 * ignoreCase／ignoreWhitespace 正規化，呈現不失真）。
 */
export function diffTokens(a: string, b: string, options: DiffOptions = DEFAULT_DIFF_OPTIONS): DiffOp[] {
  const rawA = tokenize(a, options.granularity);
  const rawB = tokenize(b, options.granularity);
  const normA = rawA.map((token) => normalizeToken(token, options));
  const normB = rawB.map((token) => normalizeToken(token, options));

  if (rawA.length * rawB.length > MAX_CELLS) {
    const ops: DiffOp[] = [];
    if (a) ops.push({ type: "remove", text: a });
    if (b) ops.push({ type: "add", text: b });
    return ops;
  }

  // lengths[i][j] = LCS length of normA[i:] 與 normB[j:]
  const width = rawB.length + 1;
  const lengths = new Uint32Array((rawA.length + 1) * width);
  for (let i = rawA.length - 1; i >= 0; i -= 1) {
    for (let j = rawB.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = normA[i] === normB[j]
        ? lengths[(i + 1) * width + j + 1] + 1
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffOp["type"], text: string) => {
    const last = ops[ops.length - 1];
    const joiner = options.granularity === "line" ? "\n" : "";
    if (last && last.type === type) last.text += joiner + text;
    else ops.push({ type, text });
  };
  while (i < rawA.length && j < rawB.length) {
    if (normA[i] === normB[j]) { push("equal", rawA[i]); i += 1; j += 1; }
    else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) { push("remove", rawA[i]); i += 1; }
    else { push("add", rawB[j]); j += 1; }
  }
  while (i < rawA.length) { push("remove", rawA[i]); i += 1; }
  while (j < rawB.length) { push("add", rawB[j]); j += 1; }
  return ops;
}

/**
 * 行級 diff 排成對齊的列，連續的「刪除＋新增」逐行配對為「修改」。
 */
export function diffRows(a: string, b: string, options: DiffOptions = DEFAULT_DIFF_OPTIONS): { rows: DiffRow[]; stats: DiffStats } {
  const ops = diffTokens(a, b, { ...options, granularity: "line" });
  const rows: DiffRow[] = [];
  const stats: DiffStats = { added: 0, removed: 0, modified: 0 };
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type === "equal") {
      for (const line of op.text.split("\n")) rows.push({ kind: "equal", left: line, right: line });
      index += 1;
      continue;
    }
    if (op.type === "remove" && ops[index + 1]?.type === "add") {
      const removed = op.text.split("\n");
      const added = ops[index + 1].text.split("\n");
      const paired = Math.min(removed.length, added.length);
      for (let at = 0; at < paired; at += 1) { rows.push({ kind: "modify", left: removed[at], right: added[at] }); stats.modified += 1; }
      for (let at = paired; at < removed.length; at += 1) { rows.push({ kind: "remove", left: removed[at] }); stats.removed += 1; }
      for (let at = paired; at < added.length; at += 1) { rows.push({ kind: "add", right: added[at] }); stats.added += 1; }
      index += 2;
      continue;
    }
    if (op.type === "remove") {
      for (const line of op.text.split("\n")) { rows.push({ kind: "remove", left: line }); stats.removed += 1; }
    } else {
      for (const line of op.text.split("\n")) { rows.push({ kind: "add", right: line }); stats.added += 1; }
    }
    index += 1;
  }
  return { rows, stats };
}
