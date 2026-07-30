import { detectDelimiter, parseDelimited, type CsvDelimiter } from "./csv.ts";

export type GroupingMode = "byCount" | "bySize";

export type GroupingResult = {
  groups: string[][];
  groupCount: number;
};

export type PersonnelMember = {
  id: string;
  name: string;
  department: string;
  fields: string[];
};

export type PersonnelRoster = {
  members: PersonnelMember[];
  headers: string[];
  delimiter: CsvDelimiter;
  hasHeader: boolean;
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

function isNameHeader(value: string) {
  return /^(姓名|名稱|名字|name|full[ _-]?name|employee[ _-]?name)$/i.test(value.trim());
}

function isDepartmentHeader(value: string) {
  return /^(部門|部门|department|dept|team|單位|单位)$/i.test(value.trim());
}

function defaultHeader(index: number) {
  if (index === 0) return "姓名";
  if (index === 1) return "部門";
  return `欄位${index + 1}`;
}

function createPersonnelMember(fields: string[], index: number, nameColumn: number, departmentColumn: number): PersonnelMember | null {
  const normalized = fields.map((field) => field.trim());
  const name = normalized[nameColumn]?.trim() ?? "";
  if (!name) return null;
  return {
    id: `member-${index}-${normalized.join("\u001f")}`,
    name,
    department: normalized[departmentColumn]?.trim() ?? "",
    fields: normalized,
  };
}

/**
 * 將純文字姓名或人員 CSV／TSV 正規化成可分組且可保留欄位的資料列。
 * 沒有部門欄時仍補上一個空的「部門」欄，確保下載再上傳不會遺失欄位。
 */
export function parsePersonnelRoster(rawText: string, removeDuplicates = true): PersonnelRoster {
  const source = rawText.trim();
  if (!source) return { members: [], headers: ["姓名", "部門"], delimiter: ",", hasHeader: false };

  const delimiter = detectDelimiter(source);
  const parsed = parseDelimited(source, delimiter);
  const isDelimited = parsed.some((row) => row.length > 1);
  if (!isDelimited) {
    const members = source.split(/\r?\n/).map((name, index) => createPersonnelMember([name, ""], index, 0, 1)).filter((member): member is PersonnelMember => Boolean(member));
    return { members: removeDuplicates ? dedupePersonnelMembers(members) : members, headers: ["姓名", "部門"], delimiter: ",", hasHeader: false };
  }

  const firstRow = parsed[0].map((field) => field.trim());
  const hasHeader = firstRow.some((field) => isNameHeader(field) || isDepartmentHeader(field));
  const width = Math.max(2, ...parsed.map((row) => row.length));
  const headers = (hasHeader ? firstRow : firstRow.map((_, index) => defaultHeader(index))).slice(0, width);
  while (headers.length < width) headers.push(defaultHeader(headers.length));
  let nameColumn = headers.findIndex(isNameHeader);
  if (nameColumn < 0) nameColumn = 0;
  let departmentColumn = headers.findIndex(isDepartmentHeader);
  if (departmentColumn < 0) {
    departmentColumn = headers.length;
    headers.push("部門");
  }

  const dataRows = hasHeader ? parsed.slice(1) : parsed;
  const members = dataRows
    .map((row, index) => {
      const fields = [...row, ...Array.from({ length: Math.max(0, headers.length - row.length) }, () => "")];
      return createPersonnelMember(fields, index, nameColumn, departmentColumn);
    })
    .filter((member): member is PersonnelMember => Boolean(member));
  return { members: removeDuplicates ? dedupePersonnelMembers(members) : members, headers, delimiter, hasHeader };
}

function dedupePersonnelMembers(members: PersonnelMember[]) {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = member.fields.join("\u001f");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 依模式換算實際組數；名單為空回傳 0。 */
export function resolveGroupCount(memberTotal: number, mode: GroupingMode, value: number) {
  if (memberTotal <= 0 || !Number.isInteger(value) || value < 1) return 0;
  if (mode === "byCount") return Math.min(value, memberTotal);
  return Math.ceil(memberTotal / value);
}

/** 解析「不同組」約束：一行一條，成員用逗號分隔；只保留名單裡實際存在的人。 */
export function parseSeparationRules(rawText: string, members: string[]) {
  const memberSet = new Set(members);
  return rawText
    .split(/\r?\n/)
    .map((line) => [...new Set(line.split(/[,，、]/).map((name) => name.trim()).filter((name) => memberSet.has(name)))])
    .filter((rule) => rule.length >= 2);
}

/**
 * 公平隨機分組：先用 Web Crypto 洗牌，再輪流發牌（round-robin），
 * 各組人數最多差 1，人數多的組排在前面。
 * separationRules（選填）：每條規則裡的人保證被放進不同組。
 */
export function splitIntoGroups<T>(members: T[], mode: GroupingMode, value: number, separationRules: T[][] = [], keyOf: (member: T) => string = (member) => String(member)): { groups: T[][]; groupCount: number } {
  const groupCount = resolveGroupCount(members.length, mode, value);
  if (groupCount === 0) throw new Error("請先輸入名單並設定有效的分組數字");
  for (const rule of separationRules) {
    if (rule.length > groupCount) throw new Error(`「${rule.join("、")}」有 ${rule.length} 人要分開，但只有 ${groupCount} 組 — 請增加組數`);
  }

  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  const placed = new Set<string>();

  // 先安置有約束的人：每條規則先標記已被前面規則放置者占用的組，
  // 剩下的人洗牌後放進目前人數最少、且該規則尚未占用的組。
  for (const rule of separationRules) {
    const usedGroups = new Set<number>();
    const unplaced: T[] = [];
    for (const name of rule) {
      if (placed.has(keyOf(name))) {
        const at = groups.findIndex((group) => group.some((member) => keyOf(member) === keyOf(name)));
        if (usedGroups.has(at)) throw new Error(`「${rule.join("、")}」與其他規則衝突，無法同時滿足 — 請調整規則`);
        usedGroups.add(at);
      } else {
        unplaced.push(name);
      }
    }
    for (const name of cryptoShuffle(unplaced)) {
      const candidates = groups.map((group, index) => ({ index, size: group.length })).filter(({ index }) => !usedGroups.has(index));
      if (candidates.length === 0) throw new Error(`「${rule.join("、")}」與其他規則衝突，無法排出不同組 — 請增加組數或調整規則`);
      candidates.sort((a, b) => a.size - b.size);
      const pick = candidates[0].index;
      groups[pick].push(name);
      usedGroups.add(pick);
      placed.add(keyOf(name));
    }
  }

  // 其餘的人洗牌後依「目前最缺人的組」填入，維持各組最多差 1。
  const rest = cryptoShuffle(members.filter((member) => !placed.has(keyOf(member))));
  for (const name of rest) {
    let pick = 0;
    for (let index = 1; index < groupCount; index += 1) {
      if (groups[index].length < groups[pick].length) pick = index;
    }
    groups[pick].push(name);
  }
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

export function personnelGroupsToText(groups: PersonnelMember[][]) {
  return groups
    .map((members, index) => `第 ${index + 1} 組（${members.length} 人）：${members.map((member) => member.department ? `${member.name}（${member.department}）` : member.name).join("、")}`)
    .join("\n");
}

/** 匯出時固定使用 UTF-8 BOM；即使輸入沒有部門欄，也會保留空的部門欄。 */
export function personnelGroupsToCsv(groups: PersonnelMember[][], sourceHeaders: string[] = ["姓名", "部門"]) {
  const headers = [...sourceHeaders];
  if (!headers.some(isDepartmentHeader)) headers.push("部門");
  const rows = [["組別", ...headers]];
  groups.forEach((members, index) => {
    for (const member of members) {
      const fields = [...member.fields, ...Array.from({ length: Math.max(0, headers.length - member.fields.length) }, () => "")].slice(0, headers.length);
      rows.push([`第 ${index + 1} 組`, ...fields]);
    }
  });
  const field = (value: string) => /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return `\uFEFF${rows.map((row) => row.map(field).join(",")).join("\r\n")}`;
}
