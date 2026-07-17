// 明確的 .ts 副檔名讓 node --experimental-strip-types 的測試也能解析這個模組。
import { cryptoShuffle, normalizeParticipants } from "./lottery.ts";

export type GroupingMode = "byCount" | "bySize";

export type GroupingResult = {
  groups: string[][];
  groupCount: number;
};

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

export { normalizeParticipants };
