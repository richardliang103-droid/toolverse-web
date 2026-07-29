/**
 * 營運架構圖 —— 資料模型、驗證與固定三欄佈局。
 *
 * 跟股權架構圖不同，這裡的形狀是固定的：受查公司置中，左欄是上游
 * 供應商、右欄是下游客戶，不需要分層演算法。徵信報告要看的是
 * 「錢從哪裡來、貨賣去哪裡、佔比多少、關係人交易有沒有藏在裡面」，
 * 固定版型比自動佈局更容易一眼看懂、也更適合直接貼進報告。
 *
 * 純資料、零依賴，用 `node --test --experimental-strip-types` 驗證。
 */

export const PAYMENT_TERMS = ["cash", "net30", "net60", "net90", "lc", "wire", "other"] as const;
export type PaymentTerm = (typeof PAYMENT_TERMS)[number];

export const PAYMENT_TERM_LABELS: Record<PaymentTerm, string> = {
  cash: "現金",
  net30: "月結 30 天",
  net60: "月結 60 天",
  net90: "月結 90 天",
  lc: "信用狀",
  wire: "電匯",
  other: "其他",
};

export type PartySide = "upstream" | "downstream";

export type OperationsParty = {
  id: string;
  name: string;
  side: PartySide;
  /** 佔採購／銷售的百分比。 */
  percentage: number;
  term: PaymentTerm;
  /** 是否為關係人交易（徵信報告的重點紅旗）。 */
  relatedParty: boolean;
  note?: string;
};

export type OperationsChart = {
  version: 1;
  title: string;
  subjectName: string;
  /** 受查公司的營運模式，如「製造・買賣」。 */
  businessModel: string;
  parties: OperationsParty[];
};

export function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().slice(0, maxLength);
  return text || fallback;
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, maxLength);
  return text || undefined;
}

export function createParty(overrides: Partial<OperationsParty> = {}): OperationsParty {
  return {
    id: newId(),
    name: "未命名",
    side: "upstream",
    percentage: 0,
    term: "net30",
    relatedParty: false,
    ...overrides,
  };
}

export function createSampleChart(): OperationsChart {
  return {
    version: 1,
    title: "宏昌實業 營運架構",
    subjectName: "宏昌實業",
    businessModel: "製造・買賣（內銷 70%・外銷 30%）",
    parties: [
      createParty({ name: "中鋼鋼鐵", side: "upstream", percentage: 35, term: "net60" }),
      createParty({ name: "宏昌貿易", side: "upstream", percentage: 25, term: "net30", relatedParty: true, note: "受查公司轉投資" }),
      createParty({ name: "其他供應商", side: "upstream", percentage: 40, term: "cash" }),
      createParty({ name: "台達電子", side: "downstream", percentage: 30, term: "net90" }),
      createParty({ name: "鴻海精密", side: "downstream", percentage: 20, term: "wire" }),
      createParty({ name: "其他客戶", side: "downstream", percentage: 50, term: "net60" }),
    ],
  };
}

/** 驗證並修復來自 localStorage 或匯入 JSON 的資料；完全無法修復時回傳 null。 */
export function normalizeChart(raw: unknown): { chart: OperationsChart; repairs: string[] } | null {
  if (!isRecord(raw) || !Array.isArray(raw.parties)) return null;
  const repairs: string[] = [];

  const parties: OperationsParty[] = [];
  const partyIds = new Set<string>();
  for (const item of raw.parties) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id === "") continue;
    if (partyIds.has(item.id)) { repairs.push(`移除重複的對象 id「${item.id}」`); continue; }
    partyIds.add(item.id);
    const side = item.side === "downstream" ? "downstream" : "upstream";
    const term = typeof item.term === "string" && (PAYMENT_TERMS as readonly string[]).includes(item.term) ? (item.term as PaymentTerm) : "net30";
    const percentage = typeof item.percentage === "number" && Number.isFinite(item.percentage) ? item.percentage : 0;
    parties.push({
      id: item.id,
      name: cleanText(item.name, "未命名", 60),
      side,
      percentage: Math.min(Math.max(percentage, 0), 100),
      term,
      relatedParty: item.relatedParty === true,
      note: cleanOptionalText(item.note, 120),
    });
  }

  return {
    chart: {
      version: 1,
      title: cleanText(raw.title, "未命名營運架構", 80),
      subjectName: cleanText(raw.subjectName, "受查公司", 60),
      businessModel: cleanText(raw.businessModel, "", 80),
      parties,
    },
    repairs,
  };
}

export type ChartWarning = { side: PartySide; message: string };

/** 上游／下游各自的佔比加總異常提醒（不阻擋使用）。 */
export function chartWarnings(chart: OperationsChart): ChartWarning[] {
  const warnings: ChartWarning[] = [];
  for (const side of ["upstream", "downstream"] as const) {
    const parties = chart.parties.filter((party) => party.side === side);
    if (parties.length === 0) continue; // 這側完全沒有對象，不算「未滿 100%」
    const total = parties.reduce((sum, party) => sum + party.percentage, 0);
    const label = side === "upstream" ? "上游供應商" : "下游客戶";
    if (total > 100.001) warnings.push({ side, message: `${label}佔比加總 ${round1(total)}%，超過 100%` });
    else if (total < 99.999) warnings.push({ side, message: `${label}佔比加總 ${round1(total)}%，未滿 100%` });
  }
  return warnings;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

// --- 固定三欄佈局 ---

export type OperationsLayoutParty = { party: OperationsParty; x: number; y: number; width: number; height: number };
export type OperationsLayout = {
  subject: { x: number; y: number; width: number; height: number };
  upstream: OperationsLayoutParty[];
  downstream: OperationsLayoutParty[];
  width: number;
  height: number;
};

export const PARTY_BOX_WIDTH = 200;
export const PARTY_BOX_HEIGHT = 64;
export const SUBJECT_BOX_WIDTH = 200;
const ROW_GAP = 20;
const MARGIN = 40;
const COLUMN_GAP = 120;

/**
 * 上游在左欄、下游在右欄，受查公司置中；每欄依佔比由高到低排序，
 * 讓最重要的往來對象排在最上面，一眼就能看出集中度。
 */
export function computeOperationsLayout(chart: OperationsChart): OperationsLayout {
  const upstream = [...chart.parties.filter((party) => party.side === "upstream")].sort((a, b) => b.percentage - a.percentage);
  const downstream = [...chart.parties.filter((party) => party.side === "downstream")].sort((a, b) => b.percentage - a.percentage);

  const rows = Math.max(upstream.length, downstream.length, 1);
  const contentHeight = rows * PARTY_BOX_HEIGHT + Math.max(0, rows - 1) * ROW_GAP;
  const height = MARGIN * 2 + Math.max(contentHeight, PARTY_BOX_HEIGHT);
  const width = MARGIN * 2 + PARTY_BOX_WIDTH * 2 + COLUMN_GAP * 2 + SUBJECT_BOX_WIDTH;

  const upstreamX = MARGIN;
  const subjectX = MARGIN + PARTY_BOX_WIDTH + COLUMN_GAP;
  const downstreamX = subjectX + SUBJECT_BOX_WIDTH + COLUMN_GAP;

  function place(list: OperationsParty[], x: number): OperationsLayoutParty[] {
    const listHeight = list.length * PARTY_BOX_HEIGHT + Math.max(0, list.length - 1) * ROW_GAP;
    const startY = MARGIN + (height - MARGIN * 2 - listHeight) / 2;
    return list.map((party, index) => ({ party, x, y: startY + index * (PARTY_BOX_HEIGHT + ROW_GAP), width: PARTY_BOX_WIDTH, height: PARTY_BOX_HEIGHT }));
  }

  const subjectY = MARGIN + (height - MARGIN * 2 - PARTY_BOX_HEIGHT) / 2;

  return {
    subject: { x: subjectX, y: subjectY, width: SUBJECT_BOX_WIDTH, height: PARTY_BOX_HEIGHT },
    upstream: place(upstream, upstreamX),
    downstream: place(downstream, downstreamX),
    width: Math.round(width),
    height: Math.round(height),
  };
}
