export type GroupingMode = "byCount" | "bySize";

export type GroupingResult = {
  groups: string[][];
  groupCount: number;
};

// 這個模組刻意零依賴（不 import 其他 lib）：node --test 可直接載入，
// 也避免跨檔 .ts 副檔名 import 需要動 tsconfig。洗牌邏輯與 lib/lottery 相同。
function cryptoRandomIndex(maxExclusive: number) {
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

/** Fisher–Yates 洗牌，使用 Web Crypto 的安全隨機來源。 */
function cryptoShuffle<T>(items: T[]) {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomIndex = cryptoRandomIndex(index + 1);
    [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
  }
  return pool;
}

export function normalizeParticipants(rawText: string, removeDuplicates = true) {
  const participants = rawText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  return removeDuplicates ? [...new Set(participants)] : participants;
}

/** 依模式換算實際組數；名單為空回傳 0。 */
export function resolveGroupCount(memberTotal: number, mode: GroupingMode, value: number) {
  if (memberTotal <= 0 || !Number.isInteger(value) || value < 1) return 0;
  if (mode === "byCount") return Math.min(value, memberTotal);
  return Math.ceil(memberTotal / value);
}

/**
 * 公平隨機分組：先用 Web Crypto 洗牌，再輪流發牌（round-robin），
 * 各組人數最多差 1，人數多的組排在前面。
 */
export function splitIntoGroups(members: string[], mode: GroupingMode, value: number): GroupingResult {
  const groupCount = resolveGroupCount(members.length, mode, value);
  if (groupCount === 0) throw new Error("請先輸入名單並設定有效的分組數字");
  const shuffled = cryptoShuffle(members);
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  shuffled.forEach((member, index) => { groups[index % groupCount].push(member); });
  return { groups, groupCount };
}

export function groupsToText(groups: string[][]) {
  return groups.map((members, index) => `第 ${index + 1} 組（${members.length} 人）：${members.join("、")}`).join("\n");
}

export function groupsToCsv(groups: string[][]) {
  const rows = [["組別", "成員"]];
  groups.forEach((members, index) => {
    for (const member of members) rows.push([`第 ${index + 1} 組`, member]);
  });
  const field = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  // 前置 BOM 讓 Excel 以 UTF-8 開啟中文欄位。
  return `\uFEFF${rows.map((row) => row.map(field).join(",")).join("\r\n")}`;
}
