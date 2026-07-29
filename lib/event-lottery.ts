import { detectDelimiter, parseDelimited } from "./csv.ts";
import { drawWinners } from "./lottery.ts";

export const EVENT_LOTTERY_STORAGE_KEY = "toolverse:event-lottery:v1";
export const EVENT_LOTTERY_CHANNEL_NAME = "toolverse:event-lottery:v1";
export const EVENT_LOTTERY_BACKUP_FORMAT = "toolverse-event-lottery-backup";
export const EVENT_LOTTERY_VERSION = 1;

export const MAX_ROSTERS = 30;
export const MAX_PARTICIPANTS = 5000;
export const MAX_PRIZES = 200;
export const MAX_WINNERS = 20_000;
export const MAX_NAME_LENGTH = 60;
export const MAX_TITLE_LENGTH = 80;
export const MAX_IMAGE_DATA_URL_LENGTH = 700_000;
export const MAX_DRAW_COUNT_PER_ROUND = 500;
export const MAX_STATE_REVISION = 2_147_483_647;

export type Roster = { id: string; name: string };

export type EventParticipant = {
  id: string;
  name: string;
  employeeId: string;
  department: string;
  rosterId: string;
  active: boolean;
};

export type EventPrize = {
  id: string;
  name: string;
  totalCount: number;
  drawnCount: number;
  imageDataUrl: string | null;
  /** 可參加的名單群組 id；空陣列代表所有群組都可參加。 */
  eligibleRosterIds: string[];
  allowRepeatWinners: boolean;
  order: number;
};

export type WinnerRecord = {
  id: string;
  prizeId: string;
  participantId: string;
  /** 得獎當下的姓名／員工編號／部門快照，即使名單之後被刪除，紀錄仍完整。 */
  participantName: string;
  employeeId: string;
  department: string;
  drawnAt: string;
  disqualified: boolean;
  disqualifiedAt: string | null;
};

export type RevealMode = "sequential" | "simultaneous";

/**
 * 一輪已經確定、但可能還沒到揭曉時間的抽選結果。`revealAt` 之前，任何分頁
 * （包含重新整理過的舞台或控制台）都應該顯示「抽選中」；`revealAt` 之後就
 * 是「已揭曉」——這個判斷只看目前時間與這筆資料，不依賴任何計時器活著。
 */
export type PendingReveal = {
  drawId: string;
  prizeId: string;
  winnerIds: string[];
  revealMode: RevealMode;
  soundEnabled: boolean;
  /** 逐一揭曉時每位得獎者之間的間隔（毫秒）；一次揭曉時不使用。 */
  stepMs: number;
  revealAt: string;
};

/** 後台按「顯示名單」時，舞台只重播既有歷史，不新增抽獎紀錄或扣除名額。 */
export type StagePreview = {
  prizeId: string;
  winnerIds: string[];
  shownAt: string;
  /** 歷史名單也沿用前台的抽獎動畫，時間到才揭曉卡片。 */
  revealAt: string;
};

export type StageNotice = {
  message: string;
  until: string;
};

export type LotteryEventState = {
  version: typeof EVENT_LOTTERY_VERSION;
  eventTitle: string;
  rosters: Roster[];
  participants: EventParticipant[];
  prizes: EventPrize[];
  winners: WinnerRecord[];
  revealMode: RevealMode;
  animationDurationMs: number;
  soundEnabled: boolean;
  backgroundImageDataUrl: string | null;
  activePrizeId: string | null;
  /** 舞台目前這一輪的揭曉狀態；null 代表沒有正在進行或剛結束的抽選。 */
  pendingReveal: PendingReveal | null;
  /** 後台要求舞台重新顯示歷史得獎名單；不影響抽獎進度。 */
  stagePreview: StagePreview | null;
  stageNotice: StageNotice | null;
  /** 舞台「下一步」（鍵盤／滑鼠／簡報筆／手機遙控／控制台）一次抽出的人數；
   *  控制台的「本輪抽出人數」欄位直接讀寫這個欄位，不是各自維護的 local state。 */
  stageDrawCount: number;
  /** 每次活動狀態變更都遞增；手機的 expectedRevision 以此為準。 */
  stateRevision: number;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampString(value: unknown, maxLength: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isValidImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_IMAGE_DATA_URL_LENGTH && /^data:image\/(png|jpeg|webp|gif);base64,/.test(value);
}

function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export class EventLotteryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventLotteryError";
  }
}

export function createEmptyEventState(now = new Date()): LotteryEventState {
  return {
    version: EVENT_LOTTERY_VERSION,
    eventTitle: "🎊 歡樂公司尾牙 🎊",
    rosters: [
      { id: "default-roster-a", name: "A組名單" },
      { id: "default-roster-b", name: "B組名單" },
      { id: "default-roster-c", name: "C組名單" },
    ],
    participants: [],
    prizes: [],
    winners: [],
    revealMode: "sequential",
    animationDurationMs: 3000,
    soundEnabled: true,
    backgroundImageDataUrl: null,
    activePrizeId: null,
    pendingReveal: null,
    stagePreview: null,
    stageNotice: null,
    stageDrawCount: 1,
    stateRevision: 0,
    updatedAt: now.toISOString(),
  };
}

export function createRoster(name: string): Roster {
  return { id: generateId("roster"), name: clampString(name, MAX_NAME_LENGTH) || "未命名名單" };
}

export function createParticipant(input: { name: string; employeeId?: string; department?: string; rosterId: string; active?: boolean }): EventParticipant {
  return {
    id: generateId("participant"),
    name: clampString(input.name, MAX_NAME_LENGTH),
    employeeId: clampString(input.employeeId, MAX_NAME_LENGTH),
    department: clampString(input.department, MAX_NAME_LENGTH),
    rosterId: input.rosterId,
    active: input.active !== false,
  };
}

export function createPrize(input: { name: string; totalCount: number; eligibleRosterIds?: string[]; allowRepeatWinners?: boolean; imageDataUrl?: string | null; order: number }): EventPrize {
  return {
    id: generateId("prize"),
    name: clampString(input.name, MAX_NAME_LENGTH),
    totalCount: clampInt(input.totalCount, 1, 100_000, 1),
    drawnCount: 0,
    imageDataUrl: isValidImageDataUrl(input.imageDataUrl) ? input.imageDataUrl : null,
    eligibleRosterIds: [...new Set(input.eligibleRosterIds ?? [])],
    allowRepeatWinners: input.allowRepeatWinners === true,
    order: input.order,
  };
}

// ---------------------------------------------------------------------------
// normalize / migration —— localStorage 或匯入的 JSON 都可能損壞或來自舊版，
// 逐欄修復救得回多少是多少，錯誤資料一律隔離掉或給安全預設值。
// ---------------------------------------------------------------------------

function sanitizeRosterList(value: unknown): Roster[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rosters: Roster[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" && item.id !== "" ? item.id : generateId("roster");
    if (seen.has(id)) continue;
    seen.add(id);
    rosters.push({ id, name: clampString(item.name, MAX_NAME_LENGTH) || `名單 ${rosters.length + 1}` });
    if (rosters.length >= MAX_ROSTERS) break;
  }
  return rosters;
}

function sanitizeParticipantList(value: unknown, rosters: Roster[]): EventParticipant[] {
  if (!Array.isArray(value)) return [];
  const fallbackRosterId = rosters[0]?.id ?? null;
  const rosterIds = new Set(rosters.map((roster) => roster.id));
  const seen = new Set<string>();
  const participants: EventParticipant[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = clampString(item.name, MAX_NAME_LENGTH);
    if (!name) continue;
    const hasId = typeof item.id === "string" && item.id !== "";
    if (hasId && seen.has(item.id as string)) continue;
    const id = hasId ? (item.id as string) : generateId("participant");
    const rosterId = typeof item.rosterId === "string" && rosterIds.has(item.rosterId) ? item.rosterId : fallbackRosterId;
    if (!rosterId) continue;
    seen.add(id);
    participants.push({
      id,
      name,
      employeeId: clampString(item.employeeId, MAX_NAME_LENGTH),
      department: clampString(item.department, MAX_NAME_LENGTH),
      rosterId,
      active: item.active !== false,
    });
    if (participants.length >= MAX_PARTICIPANTS) break;
  }
  return participants;
}

function sanitizePrizeList(value: unknown, rosters: Roster[]): EventPrize[] {
  if (!Array.isArray(value)) return [];
  const rosterIds = new Set(rosters.map((roster) => roster.id));
  const seen = new Set<string>();
  const prizes: EventPrize[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = clampString(item.name, MAX_NAME_LENGTH);
    if (!name) continue;
    const hasId = typeof item.id === "string" && item.id !== "";
    if (hasId && seen.has(item.id as string)) continue;
    const id = hasId ? (item.id as string) : generateId("prize");
    seen.add(id);
    const totalCount = clampInt(item.totalCount, 1, 100_000, 1);
    const drawnCount = clampInt(item.drawnCount, 0, totalCount, 0);
    const eligibleRosterIds = Array.isArray(item.eligibleRosterIds)
      ? [...new Set(item.eligibleRosterIds.filter((entry): entry is string => typeof entry === "string" && rosterIds.has(entry)))]
      : [];
    prizes.push({
      id,
      name,
      totalCount,
      drawnCount,
      imageDataUrl: isValidImageDataUrl(item.imageDataUrl) ? item.imageDataUrl : null,
      eligibleRosterIds,
      allowRepeatWinners: item.allowRepeatWinners === true,
      order: clampInt(item.order, 0, 1_000_000, prizes.length),
    });
    if (prizes.length >= MAX_PRIZES) break;
  }
  prizes.sort((a, b) => a.order - b.order);
  return prizes;
}

function sanitizeWinnerList(value: unknown, prizes: EventPrize[]): WinnerRecord[] {
  if (!Array.isArray(value)) return [];
  const prizeIds = new Set(prizes.map((prize) => prize.id));
  const seen = new Set<string>();
  const winners: WinnerRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const prizeId = typeof item.prizeId === "string" && prizeIds.has(item.prizeId) ? item.prizeId : null;
    const participantId = typeof item.participantId === "string" && item.participantId !== "" ? item.participantId : null;
    const participantName = clampString(item.participantName, MAX_NAME_LENGTH);
    const drawnAt = validIsoDate(item.drawnAt);
    if (!prizeId || !participantId || !participantName || !drawnAt) continue;
    const hasId = typeof item.id === "string" && item.id !== "";
    if (hasId && seen.has(item.id as string)) continue;
    const id = hasId ? (item.id as string) : generateId("winner");
    seen.add(id);
    winners.push({
      id,
      prizeId,
      participantId,
      participantName,
      employeeId: clampString(item.employeeId, MAX_NAME_LENGTH),
      department: clampString(item.department, MAX_NAME_LENGTH),
      drawnAt,
      disqualified: item.disqualified === true,
      disqualifiedAt: item.disqualified === true ? validIsoDate(item.disqualifiedAt) : null,
    });
    if (winners.length >= MAX_WINNERS) break;
  }
  return winners;
}

function sanitizePendingReveal(value: unknown, prizeIds: Set<string>, winnerIds: Set<string>): PendingReveal | null {
  if (!isRecord(value)) return null;
  const prizeId = typeof value.prizeId === "string" && prizeIds.has(value.prizeId) ? value.prizeId : null;
  const winnerIdList = Array.isArray(value.winnerIds)
    ? value.winnerIds.filter((id): id is string => typeof id === "string" && winnerIds.has(id))
    : [];
  const revealAt = validIsoDate(value.revealAt);
  if (!prizeId || winnerIdList.length === 0 || !revealAt) return null;
  return {
    drawId: typeof value.drawId === "string" && value.drawId !== "" ? value.drawId : generateId("draw"),
    prizeId,
    winnerIds: winnerIdList,
    revealMode: value.revealMode === "simultaneous" ? "simultaneous" : "sequential",
    soundEnabled: value.soundEnabled !== false,
    stepMs: clampInt(value.stepMs, 0, 15_000, sequentialStepMs(winnerIdList.length)),
    revealAt,
  };
}

function sanitizeStagePreview(value: unknown, prizeIds: Set<string>, winnerIds: Set<string>): StagePreview | null {
  if (!isRecord(value)) return null;
  const prizeId = typeof value.prizeId === "string" && prizeIds.has(value.prizeId) ? value.prizeId : null;
  const ids = Array.isArray(value.winnerIds)
    ? [...new Set(value.winnerIds.filter((id): id is string => typeof id === "string" && winnerIds.has(id)))]
    : [];
  const shownAt = validIsoDate(value.shownAt);
  const revealAt = validIsoDate(value.revealAt) ?? shownAt;
  if (!prizeId || ids.length === 0 || !shownAt || !revealAt) return null;
  return { prizeId, winnerIds: ids, shownAt, revealAt };
}

function sanitizeStageNotice(value: unknown): StageNotice | null {
  if (!isRecord(value)) return null;
  const message = clampString(value.message, 120);
  const until = validIsoDate(value.until);
  return message && until ? { message, until } : null;
}

/** localStorage／匯入的 JSON 都可能損壞或殘缺；逐欄修復，救得回多少是多少。 */
export function sanitizeEventState(value: unknown, now = new Date()): LotteryEventState {
  const data = isRecord(value) ? value : {};
  const rosters = sanitizeRosterList(data.rosters);
  const participants = sanitizeParticipantList(data.participants, rosters);
  const prizes = sanitizePrizeList(data.prizes, rosters);
  const winners = sanitizeWinnerList(data.winners, prizes);
  const winnerIds = new Set(winners.map((winner) => winner.id));
  const prizeIds = new Set(prizes.map((prize) => prize.id));

  const activePrizeId = typeof data.activePrizeId === "string" && prizeIds.has(data.activePrizeId) ? data.activePrizeId : null;
  const pendingReveal = sanitizePendingReveal(data.pendingReveal, prizeIds, winnerIds);
  const stagePreview = sanitizeStagePreview(data.stagePreview, prizeIds, winnerIds);
  const stageNotice = sanitizeStageNotice(data.stageNotice);

  return {
    version: EVENT_LOTTERY_VERSION,
    eventTitle: clampString(data.eventTitle, MAX_TITLE_LENGTH) || "🎊 歡樂公司尾牙 🎊",
    rosters,
    participants,
    prizes,
    winners,
    revealMode: data.revealMode === "simultaneous" ? "simultaneous" : "sequential",
    animationDurationMs: clampInt(data.animationDurationMs, 1_000, 60_000, 3_000),
    soundEnabled: data.soundEnabled !== false,
    backgroundImageDataUrl: isValidImageDataUrl(data.backgroundImageDataUrl) ? data.backgroundImageDataUrl : null,
    activePrizeId,
    // pendingReveal 指向的獎項若跟 activePrizeId 對不上（例如手改壞的資料），
    // 寧可捨棄這輪揭曉狀態，也不要顯示跟目前準備獎項不符的得獎者。
    pendingReveal: pendingReveal && pendingReveal.prizeId === activePrizeId ? pendingReveal : null,
    stagePreview: stagePreview && stagePreview.prizeId === activePrizeId ? stagePreview : null,
    stageNotice,
    // 舊 localStorage／舊備份沒有這個欄位時安全回退為 1。
    stageDrawCount: clampInt(data.stageDrawCount, 1, MAX_DRAW_COUNT_PER_ROUND, 1),
    // 舊 localStorage／舊備份沒有這個欄位時從 0 開始；所有新的寫入都會遞增。
    stateRevision: clampInt(data.stateRevision, 0, MAX_STATE_REVISION, 0),
    updatedAt: validIsoDate(data.updatedAt) ?? now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 名單／員工編號
// ---------------------------------------------------------------------------

export function findDuplicateEmployeeId(participants: EventParticipant[], employeeId: string, excludeId?: string): EventParticipant | null {
  const trimmed = employeeId.trim();
  if (!trimmed) return null;
  return participants.find((participant) => participant.id !== excludeId && participant.employeeId === trimmed) ?? null;
}

export function totalParticipantCount(participants: EventParticipant[]): number {
  return participants.length;
}

export function eligibleParticipantCount(participants: EventParticipant[]): number {
  return participants.filter((participant) => participant.active).length;
}

// ---------------------------------------------------------------------------
// CSV 匯入
// ---------------------------------------------------------------------------

const PARTICIPANT_HEADER_KEYWORDS = ["姓名", "name", "員工編號", "employeeid", "employee_id", "emp_id", "id", "部門", "department", "dept"];

function isParticipantHeaderRow(row: string[]): boolean {
  return row.some((cell) => PARTICIPANT_HEADER_KEYWORDS.includes(cell.trim().toLowerCase()));
}

export type ParsedParticipantRow = { name: string; employeeId: string; department: string };

/** 解析參加者 CSV；支援 UTF-8（含 BOM），欄位順序固定為 姓名,員工編號,部門，有無標題列皆可辨識。 */
export function parseParticipantsCsv(text: string): { rows: ParsedParticipantRow[]; warnings: string[] } {
  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, delimiter);
  if (table.length === 0) return { rows: [], warnings: [] };

  let nameIndex = 0;
  let employeeIdIndex = 1;
  let departmentIndex = 2;
  let body = table;
  if (isParticipantHeaderRow(table[0])) {
    const header = table[0].map((cell) => cell.trim().toLowerCase());
    const findIndex = (keys: string[]) => header.findIndex((cell) => keys.includes(cell));
    nameIndex = Math.max(0, findIndex(["姓名", "name"]));
    employeeIdIndex = findIndex(["員工編號", "employeeid", "employee_id", "emp_id", "編號", "id"]);
    departmentIndex = findIndex(["部門", "department", "dept"]);
    body = table.slice(1);
  }

  const rows: ParsedParticipantRow[] = [];
  const warnings: string[] = [];
  body.forEach((row, index) => {
    const name = clampString(row[nameIndex], MAX_NAME_LENGTH);
    if (!name) {
      if (row.some((cell) => cell.trim() !== "")) warnings.push(`第 ${index + 1} 列缺少姓名，已略過`);
      return;
    }
    const employeeId = employeeIdIndex >= 0 ? clampString(row[employeeIdIndex], MAX_NAME_LENGTH) : "";
    // 原專案把員工編號視為必要欄位；沒有編號的列不能可靠地去重、顯示或追蹤
    // 失格後的資格恢復，因此不要把它悄悄匯入成一筆空編號資料。
    if (!employeeId) {
      warnings.push(`第 ${index + 1} 列缺少員工編號，已略過`);
      return;
    }
    rows.push({
      name,
      employeeId,
      department: departmentIndex >= 0 ? clampString(row[departmentIndex], MAX_NAME_LENGTH) : "",
    });
  });
  return { rows, warnings };
}

/** 匯入 CSV 解析出的參加者到指定名單群組；同群組既有資料可更新回原版行為，
 *  跨群組重複則只有在呼叫端已經明確提示並確認後才允許新增。 */
export function mergeParticipantsFromCsv(
  existing: EventParticipant[],
  rows: ParsedParticipantRow[],
  rosterId: string,
  options: { updateExistingInRoster?: boolean; allowCrossRosterDuplicates?: boolean } = {},
): { participants: EventParticipant[]; added: number; updated: number; skipped: string[] } {
  const next = [...existing];
  const skipped: string[] = [];
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const sameRosterDuplicate = row.employeeId
      ? next.find((participant) => participant.employeeId === row.employeeId && participant.rosterId === rosterId) ?? null
      : null;
    if (sameRosterDuplicate) {
      if (options.updateExistingInRoster) {
        const duplicateIndex = next.findIndex((participant) => participant.id === sameRosterDuplicate.id);
        if (duplicateIndex >= 0) {
          next[duplicateIndex] = { ...sameRosterDuplicate, name: row.name, department: row.department, active: true };
          updated += 1;
          continue;
        }
      }
      skipped.push(`${row.name}（員工編號 ${row.employeeId} 與「${sameRosterDuplicate.name}」重複）`);
      continue;
    }
    const duplicate = row.employeeId ? findDuplicateEmployeeId(next, row.employeeId) : null;
    if (duplicate) {
      if (options.allowCrossRosterDuplicates && duplicate.rosterId !== rosterId) {
        next.push(createParticipant({ ...row, rosterId }));
        added += 1;
        if (next.length >= MAX_PARTICIPANTS) break;
        continue;
      }
      skipped.push(`${row.name}（員工編號 ${row.employeeId} 與「${duplicate.name}」重複）`);
      continue;
    }
    next.push(createParticipant({ ...row, rosterId }));
    added += 1;
    if (next.length >= MAX_PARTICIPANTS) break;
  }
  return { participants: next, added, updated, skipped };
}

const PRIZE_HEADER_KEYWORDS = ["名稱", "獎項", "name", "prize", "總數量", "數量", "qty", "quantity", "count", "抽獎順序", "顯示順序", "順序", "order", "允許已得獎者再次參加", "allow_all", "allow_repeat", "適用名單"];

function isPrizeHeaderRow(row: string[]): boolean {
  return row.some((cell) => PRIZE_HEADER_KEYWORDS.includes(cell.trim()));
}

/** 解析獎項 CSV：名稱,總數量[,允許已得獎者再次參加][,適用名單（以「、」分隔的名單名稱）]。 */
export function parsePrizesCsv(text: string, rosters: Roster[], startOrder: number): { prizes: EventPrize[]; warnings: string[] } {
  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, delimiter);
  if (table.length === 0) return { prizes: [], warnings: [] };

  let nameIndex = 0;
  let countIndex = 1;
  let orderIndex = -1;
  let allowRepeatIndex = -1;
  let rostersIndex = -1;
  let body = table;
  if (isPrizeHeaderRow(table[0])) {
    const header = table[0].map((cell) => cell.trim());
    const findIndex = (keys: string[]) => header.findIndex((cell) => keys.includes(cell));
    nameIndex = Math.max(0, findIndex(["名稱", "獎項", "name", "prize"]));
    countIndex = Math.max(1, findIndex(["總數量", "數量", "qty", "quantity", "count"]));
    orderIndex = findIndex(["抽獎順序", "顯示順序", "順序", "order"]);
    allowRepeatIndex = findIndex(["允許已得獎者再次參加", "allow_all", "allow_repeat"]);
    rostersIndex = findIndex(["適用名單"]);
    body = table.slice(1);
  }

  const rosterByName = new Map(rosters.map((roster) => [roster.name, roster.id]));
  const prizes: EventPrize[] = [];
  const warnings: string[] = [];
  body.forEach((row, index) => {
    const name = clampString(row[nameIndex], MAX_NAME_LENGTH);
    if (!name) {
      if (row.some((cell) => cell.trim() !== "")) warnings.push(`第 ${index + 1} 列缺少名稱，已略過`);
      return;
    }
    const parsedCount = Number.parseInt(row[countIndex]?.trim() ?? "", 10);
    if (!Number.isInteger(parsedCount) || parsedCount < 1) {
      warnings.push(`第 ${index + 1} 列數量無效，已略過`);
      return;
    }
    const totalCount = clampInt(parsedCount, 1, 100_000, 1);
    const eligibleRosterIds = rostersIndex >= 0 && row[rostersIndex]
      ? row[rostersIndex].split(/[、,]/).map((label) => label.trim()).filter(Boolean).map((label) => rosterByName.get(label)).filter((id): id is string => Boolean(id))
      : [];
    const importedOrder = orderIndex >= 0 ? Number.parseInt(row[orderIndex] ?? "", 10) : Number.NaN;
    prizes.push(createPrize({
      name,
      totalCount,
      allowRepeatWinners: allowRepeatIndex >= 0 && /^(true|是|1|yes)$/i.test(row[allowRepeatIndex]?.trim() ?? ""),
      eligibleRosterIds,
      order: Number.isInteger(importedOrder) && importedOrder >= 1 ? startOrder + importedOrder - 1 : startOrder + prizes.length,
    }));
  });
  return { prizes, warnings };
}

// ---------------------------------------------------------------------------
// 抽獎
// ---------------------------------------------------------------------------

export function remainingSlots(prize: EventPrize): number {
  return Math.max(0, prize.totalCount - prize.drawnCount);
}

/** 已得獎（未失格）者的 id 集合；allowRepeatWinners=false 的獎項要排除這些人。 */
function activeWinnerParticipantIds(winners: WinnerRecord[]): Set<string> {
  return new Set(winners.filter((winner) => !winner.disqualified).map((winner) => winner.participantId));
}

/** 某個獎項目前的候選人池：在有效名單群組內、狀態為有效，且依 allowRepeatWinners 決定是否排除已得獎者。 */
export function candidatePool(state: LotteryEventState, prizeId: string): EventParticipant[] {
  const prize = state.prizes.find((item) => item.id === prizeId);
  if (!prize) return [];
  const rosterFilter = prize.eligibleRosterIds.length > 0 ? new Set(prize.eligibleRosterIds) : null;
  const alreadyWon = prize.allowRepeatWinners ? null : activeWinnerParticipantIds(state.winners);
  return state.participants.filter((participant) => {
    if (!participant.active) return false;
    if (rosterFilter && !rosterFilter.has(participant.rosterId)) return false;
    if (alreadyWon && alreadyWon.has(participant.id)) return false;
    return true;
  });
}

export type DrawValidation = { ok: true; prize: EventPrize; candidates: EventParticipant[] } | { ok: false; reason: string };

export function validateDraw(state: LotteryEventState, prizeId: string, requestedCount: number): DrawValidation {
  const prize = state.prizes.find((item) => item.id === prizeId);
  if (!prize) return { ok: false, reason: "找不到指定的獎項" };
  if (!Number.isInteger(requestedCount) || requestedCount < 1) return { ok: false, reason: "本輪抽出人數至少要有 1 位" };
  if (requestedCount > MAX_DRAW_COUNT_PER_ROUND) return { ok: false, reason: `單輪抽出人數不能超過 ${MAX_DRAW_COUNT_PER_ROUND} 位` };
  const remaining = remainingSlots(prize);
  if (requestedCount > remaining) return { ok: false, reason: `「${prize.name}」剩餘名額只有 ${remaining} 個，不能抽 ${requestedCount} 位` };
  const candidates = candidatePool(state, prizeId);
  if (requestedCount > candidates.length) return { ok: false, reason: `候選人不足：符合資格的只有 ${candidates.length} 位，無法抽出 ${requestedCount} 位` };
  return { ok: true, prize, candidates };
}

export type DrawOutcome = { winners: WinnerRecord[]; nextState: LotteryEventState };

export const MAX_SEQUENTIAL_TOTAL_MS = 60_000;
export const DEFAULT_SEQUENTIAL_STEP_MS = 1_000;
/** 原版在最後一張卡片／一次揭曉出現後，還保留約一秒才回到 WINNERS 可操作狀態。 */
export const PRESENTATION_SETTLE_MS = 1_000;
/** 原版前台單人逐次揭曉會保留較完整的 3 秒滾動時間；多人則每人約 1 秒。 */
export const DEFAULT_SINGLE_SEQUENTIAL_MS = 3_000;

/**
 * 逐一揭曉時每位得獎者之間的間隔：人數少時用預設間隔，人數多到會讓整輪逐一
 * 揭曉超過一分鐘時自動壓縮間隔，讓整輪揭曉的總時間有上限，不會出現「單輪抽
 * 500 人、逐一揭曉要播十幾分鐘」的情況。
 */
export function sequentialStepMs(winnerCount: number): number {
  if (winnerCount <= 1) return 0;
  return Math.min(DEFAULT_SEQUENTIAL_STEP_MS, MAX_SEQUENTIAL_TOTAL_MS / (winnerCount - 1));
}

/** 這一輪揭曉動畫與原版最後的展示緩衝都完成的時間點（毫秒 epoch）。 */
export function pendingRevealCompleteAt(pendingReveal: PendingReveal): number {
  const revealAtMs = Date.parse(pendingReveal.revealAt);
  if (pendingReveal.revealMode !== "sequential" || pendingReveal.winnerIds.length <= 1) return revealAtMs + PRESENTATION_SETTLE_MS;
  return revealAtMs + (pendingReveal.winnerIds.length - 1) * pendingReveal.stepMs + PRESENTATION_SETTLE_MS;
}

/** 歷史名單預覽沿用原版一次揭曉的最後展示緩衝。 */
export function stagePreviewCompleteAt(stagePreview: StagePreview): number {
  return Date.parse(stagePreview.revealAt) + PRESENTATION_SETTLE_MS;
}

/**
 * 逐一揭曉時，目前這一刻應該顯示前幾位得獎者——純粹用「經過了多久」現算，
 * 不依賴一長串 setTimeout 逐一觸發。這樣分頁被瀏覽器背景節流（例如舞台視窗被
 * 切到背景、或投影電腦進入省電模式）時，恢復後下一次重新計算就會直接跳到正確
 * 進度，不會有得獎者因為某個 timer 沒被準時觸發而永遠沒顯示出來。
 */
export function visibleWinnerCount(pendingReveal: PendingReveal, now = new Date()): number {
  const total = pendingReveal.winnerIds.length;
  if (pendingReveal.revealMode === "simultaneous" || total <= 1) return total;
  const elapsed = now.getTime() - Date.parse(pendingReveal.revealAt);
  if (elapsed < 0) return 0;
  if (pendingReveal.stepMs <= 0) return total;
  return Math.min(total, Math.floor(elapsed / pendingReveal.stepMs) + 1);
}

/**
 * 安全抽選：候選人池建立後，用 lib/lottery.ts 的 Web Crypto Fisher–Yates 洗牌抽出，
 * 不使用 Math.random()。得獎紀錄與獎項已抽數量會立刻寫入回傳的 state（歷史資料
 * 必須馬上落地，不可延後）；舞台什麼時候「看起來」揭曉，交給 pendingReveal.revealAt
 * ——這是之後每次讀取狀態時用目前時間現算的結果，不依賴任何存活的計時器，重新
 * 整理或直接關掉分頁都不會讓這輪結果卡住或消失。
 */
export function drawEventWinners(state: LotteryEventState, prizeId: string, requestedCount: number, now = new Date()): DrawOutcome {
  const validation = validateDraw(state, prizeId, requestedCount);
  if (!validation.ok) throw new EventLotteryError(validation.reason);
  const { candidates } = validation;

  const picked = drawWinners(candidates, requestedCount);
  const drawnAt = now.toISOString();
  const winners: WinnerRecord[] = picked.map((participant) => ({
    id: generateId("winner"),
    prizeId,
    participantId: participant.id,
    participantName: participant.name,
    employeeId: participant.employeeId,
    department: participant.department,
    drawnAt,
    disqualified: false,
    disqualifiedAt: null,
  }));

  const revealLeadInMs = state.revealMode === "sequential"
    ? winners.length === 1 ? DEFAULT_SINGLE_SEQUENTIAL_MS : DEFAULT_SEQUENTIAL_STEP_MS
    : state.animationDurationMs;
  const pendingReveal: PendingReveal = {
    drawId: generateId("draw"),
    prizeId,
    winnerIds: winners.map((winner) => winner.id),
    revealMode: state.revealMode,
    soundEnabled: state.soundEnabled,
    stepMs: sequentialStepMs(winners.length),
    revealAt: new Date(now.getTime() + revealLeadInMs).toISOString(),
  };

  const nextState: LotteryEventState = {
    ...state,
    prizes: state.prizes.map((item) => (item.id === prizeId ? { ...item, drawnCount: item.drawnCount + winners.length } : item)),
    winners: [...state.winners, ...winners],
    activePrizeId: prizeId,
    pendingReveal,
    stagePreview: null,
    stageNotice: null,
    updatedAt: drawnAt,
  };
  return { winners, nextState };
}

/**
 * 將一次已驗證的活動狀態變更標記成新版本。控制台、舞台本機操作與手機遙控
 * 都必須經過這個 helper，讓手機拿到的 expectedRevision 能涵蓋所有入口，而不
 * 只是涵蓋前一次手機命令。
 */
export function advanceStateRevision(state: LotteryEventState, now = new Date()): LotteryEventState {
  return {
    ...state,
    stateRevision: Math.min(MAX_STATE_REVISION, state.stateRevision + 1),
    updatedAt: now.toISOString(),
  };
}

/** 失格：獎項已抽數量歸還一位，參加者恢復抽選資格；紀錄本身保留，不會被刪除。
 *  舞台先顯示原版的感謝訊息，接著回到同一獎項的準備畫面，讓主持人可以重抽。 */
export function disqualifyWinner(state: LotteryEventState, winnerId: string, now = new Date()): LotteryEventState {
  const record = state.winners.find((winner) => winner.id === winnerId);
  if (!record) throw new EventLotteryError("找不到這筆得獎紀錄");
  if (record.disqualified) return state;

  const disqualifiedAt = now.toISOString();
  return {
    ...state,
    winners: state.winners.map((winner) => (winner.id === winnerId ? { ...winner, disqualified: true, disqualifiedAt } : winner)),
    prizes: state.prizes.map((prize) => (prize.id === record.prizeId ? { ...prize, drawnCount: Math.max(0, prize.drawnCount - 1) } : prize)),
    activePrizeId: record.prizeId,
    pendingReveal: null,
    stagePreview: null,
    stageDrawCount: 1,
    stageNotice: { message: `感謝 ${record.participantName} 的無私奉獻！ 🎉`, until: new Date(now.getTime() + 3_000).toISOString() },
    updatedAt: disqualifiedAt,
  };
}

/** 舞台準備：選定獎項、清空上一輪的揭曉狀態。 */
export function prepareStagePrize(state: LotteryEventState, prizeId: string, now = new Date()): LotteryEventState {
  return { ...state, activePrizeId: prizeId, pendingReveal: null, stagePreview: null, stageNotice: null, updatedAt: now.toISOString() };
}

/** 顯示既有獎項的歷史得獎名單，不改變抽獎數量，也不建立新的得獎紀錄。 */
export function previewPrizeWinners(state: LotteryEventState, prizeId: string, now = new Date()): LotteryEventState {
  const prizeExists = state.prizes.some((prize) => prize.id === prizeId);
  if (!prizeExists) throw new EventLotteryError("找不到指定的獎項");
  const winnerIds = state.winners
    .filter((winner) => winner.prizeId === prizeId)
    .map((winner) => winner.id);
  if (winnerIds.length === 0) throw new EventLotteryError("此獎項目前還沒有得獎紀錄");
  return {
    ...state,
    activePrizeId: prizeId,
    pendingReveal: null,
    stagePreview: {
      prizeId,
      winnerIds,
      shownAt: now.toISOString(),
      revealAt: new Date(now.getTime() + state.animationDurationMs).toISOString(),
    },
    stageNotice: null,
    updatedAt: now.toISOString(),
  };
}

/** 清除舞台顯示（不影響已抽出的紀錄與獎項數量）；抽選進行中按下也能立刻中止舞台上的倒數／揭曉畫面。 */
export function clearStage(state: LotteryEventState, now = new Date()): LotteryEventState {
  return { ...state, activePrizeId: null, pendingReveal: null, stagePreview: null, stageNotice: null, updatedAt: now.toISOString() };
}

/** 重置整場活動的抽獎進度：清空得獎紀錄與已抽數量，保留名單、獎項設定與活動資訊。 */
export function resetEventDraws(state: LotteryEventState, now = new Date()): LotteryEventState {
  return {
    ...state,
    winners: [],
    prizes: state.prizes.map((prize) => ({ ...prize, drawnCount: 0 })),
    activePrizeId: null,
    pendingReveal: null,
    stagePreview: null,
    stageNotice: null,
    updatedAt: now.toISOString(),
  };
}

/** 獎項若已有任何得獎紀錄（含失格），必須阻止刪除，避免歷史資料出現懸空引用。 */
export function canDeletePrize(state: LotteryEventState, prizeId: string): boolean {
  return !state.winners.some((winner) => winner.prizeId === prizeId);
}

/** 參加者若已有任何得獎紀錄（含失格），必須阻止刪除，只能停用，避免紀錄與失格恢復資格的邏輯出現懸空引用。 */
export function canDeleteParticipant(state: LotteryEventState, participantId: string): boolean {
  return !state.winners.some((winner) => winner.participantId === participantId);
}

/** 名單群組若含有任何已有得獎紀錄的成員，必須阻止整組刪除，理由同 canDeleteParticipant。 */
export function canDeleteRoster(state: LotteryEventState, rosterId: string): boolean {
  return !state.participants.some((participant) => participant.rosterId === rosterId && !canDeleteParticipant(state, participant.id));
}

export type StageDisplay =
  | { phase: "idle" }
  | { phase: "prepared"; prizeId: string }
  | { phase: "drawing"; prizeId: string; pendingReveal: PendingReveal }
  | { phase: "revealed"; prizeId: string; pendingReveal: PendingReveal }
  | { phase: "preview"; prizeId: string; winnerIds: string[]; rolling: boolean }
  | { phase: "notice"; message: string; until: string; prizeId: string };

/**
 * 舞台這一刻該顯示什麼，純粹是「目前狀態 + 現在幾點」的函式，不依賴任何計時
 * 器或訊息歷史——不管是剛收到廣播、重新整理、還是很久以後才打開分頁，算出
 * 來的結果都一樣，這樣舞台跟控制台才能永遠正確地互相還原。
 */
export function resolveStageDisplay(state: LotteryEventState, now = new Date()): StageDisplay {
  if (state.stageNotice && now.getTime() < Date.parse(state.stageNotice.until)) {
    return { phase: "notice", message: state.stageNotice.message, until: state.stageNotice.until, prizeId: state.activePrizeId ?? "" };
  }
  if (!state.activePrizeId) return { phase: "idle" };
  const pending = state.pendingReveal;
  if (pending && pending.prizeId === state.activePrizeId) {
    const revealed = now.getTime() >= Date.parse(pending.revealAt);
    return revealed
      ? { phase: "revealed", prizeId: pending.prizeId, pendingReveal: pending }
      : { phase: "drawing", prizeId: pending.prizeId, pendingReveal: pending };
  }
  if (state.stagePreview && state.stagePreview.prizeId === state.activePrizeId) {
    return {
      phase: "preview",
      prizeId: state.stagePreview.prizeId,
      winnerIds: state.stagePreview.winnerIds,
      rolling: now.getTime() < Date.parse(state.stagePreview.revealAt),
    };
  }
  return { phase: "prepared", prizeId: state.activePrizeId };
}

export type StageAdvanceAction =
  | { action: "none" }
  | { action: "clear" }
  | { action: "prepare"; prizeId: string }
  | { action: "draw"; prizeId: string; count: number };

/**
 * 舞台可以用簡報筆／鍵盤／點擊畫面／手機遙控控制「下一步」，不需要回到控制台
 * 操作。這個函式純粹依目前狀態決定下一步該做什麼，方便在舞台與（如果同時開
 * 著）控制台共用同一套判斷，也方便單獨測試：
 * - 這一輪揭曉還沒完全播完（逐一揭曉可能還在顯示中間的得獎者）：不做事，避免
 *   跟目前這輪疊在一起準備下一獎項或再抽一次。
 * - 還沒準備獎項、或目前獎項已經沒有剩餘名額：準備下一個還有名額的獎項
 *   （依 order 排序，找不到就代表全部抽完了，回傳 none）。
 * - 已經準備好、還有剩餘名額：抽出 state.stageDrawCount（並依剩餘名額、候選人數
 *   與單輪上限收斂）位，而不是一次把整個獎項抽光。
 * - 所有獎項都完成、目前仍停在最後一輪得獎畫面時，回到首頁提示；已經是空白
 *   首頁則維持 none。
 */
export function resolveStageAdvance(state: LotteryEventState, now = new Date()): StageAdvanceAction {
  if (state.stageNotice !== null && now.getTime() < Date.parse(state.stageNotice.until)) {
    return { action: "none" };
  }
  if (state.pendingReveal !== null && now.getTime() < pendingRevealCompleteAt(state.pendingReveal)) {
    return { action: "none" };
  }

  const display = resolveStageDisplay(state, now);

  // 顯示歷史得獎名單也要等前台動畫播完，避免按鍵／手機遙控在卡片尚未揭曉
  // 時就清掉這個預覽或切到下一個獎項。
  if (display.phase === "preview" && display.rolling) return { action: "none" };
  if (display.phase === "preview" && state.stagePreview && now.getTime() < stagePreviewCompleteAt(state.stagePreview)) return { action: "none" };

  const nextPreparablePrize = [...state.prizes].sort((a, b) => a.order - b.order).find((prize) => remainingSlots(prize) > 0);

  if (display.phase === "prepared") {
    const prize = state.prizes.find((item) => item.id === display.prizeId);
    if (prize) {
      const count = Math.min(
        state.stageDrawCount,
        remainingSlots(prize),
        candidatePool(state, prize.id).length,
        MAX_DRAW_COUNT_PER_ROUND,
      );
      if (count > 0) return { action: "draw", prizeId: prize.id, count };
    }
  }

  if (nextPreparablePrize) return { action: "prepare", prizeId: nextPreparablePrize.id };
  if (display.phase === "revealed" || display.phase === "preview") return { action: "clear" };
  return { action: "none" };
}

// ---------------------------------------------------------------------------
// 匯出
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  return /["\n\r,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** 參考專案的歷史紀錄格式：在地時間、年月日與時分秒都補零。 */
export function formatLotteryTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function winnersToCsv(state: LotteryEventState): string {
  const prizeNames = new Map(state.prizes.map((prize) => [prize.id, prize.name]));
  const rows = [["抽取時間", "獎項", "部門", "姓名", "員工編號", "狀態"]];
  // 參考專案的歷史報表以最新得獎紀錄排在最前面；保留這個順序，讓匯出的
  // Excel／CSV 與後台畫面及原版使用習慣一致。狀態欄是 Toolverse 額外保留
  // 的失格歷史資訊，不影響前五個原版欄位。
  for (const winner of [...state.winners].reverse()) {
    rows.push([
      formatLotteryTimestamp(winner.drawnAt),
      prizeNames.get(winner.prizeId) ?? "（已刪除的獎項）",
      winner.department,
      winner.participantName,
      winner.employeeId,
      winner.disqualified ? "已失格" : "得獎",
    ]);
  }
  return `﻿${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}`;
}

export function eventBackupFileName(state: LotteryEventState, date = new Date()): string {
  // 參考專案使用固定的 Lottery_Backup_時間格式；固定前綴比活動標題更容易
  // 在活動當天多次備份時排序與辨識，也避免標題中的特殊字元影響檔名。
  const pad = (value: number) => String(value).padStart(2, "0");
  return `Lottery_Backup_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

export function exportEventBackup(state: LotteryEventState, exportedAt = new Date()): string {
  const payload = {
    format: EVENT_LOTTERY_BACKUP_FORMAT,
    version: EVENT_LOTTERY_VERSION,
    exportedAt: exportedAt.toISOString(),
    state: sanitizeEventState(state, exportedAt),
  };
  return JSON.stringify(payload, null, 2);
}

/** 匯入 JSON 前先驗證格式與版本，再對內容做完整 normalize；不會信任檔案內容。 */
export function parseEventBackup(raw: unknown): LotteryEventState {
  if (!isRecord(raw) || raw.format !== EVENT_LOTTERY_BACKUP_FORMAT) {
    throw new EventLotteryError("這不是活動抽獎控制台的備份檔，請選擇先前匯出的 JSON。");
  }
  if (raw.version !== EVENT_LOTTERY_VERSION) {
    throw new EventLotteryError("這份備份版本不相容，請使用最新版本重新匯出。");
  }
  return sanitizeEventState(raw.state);
}
