/**
 * 股權架構圖 —— 資料模型、驗證與自動分層佈局。
 *
 * 資料是一張以「受查公司」為錨點的持股關係圖（股東可能交叉持股，
 * 不是單純的樹），佈局演算法把它攤成上下分層的圖：受查公司固定在
 * 第 0 層，往上是股東（第 -1、-2…層），往下是轉投資（第 1、2…層）。
 * 用 BFS 從受查公司往外展開，第一次到達某個實體的路徑決定它的層數；
 * 之後再到達同一個實體、但層數對不起來的持股關係，畫成交叉持股的
 * 虛線（不影響版面），避免循環持股把演算法卡死。
 *
 * 純資料、零依賴，用 `node --test --experimental-strip-types` 驗證。
 */

export const ENTITY_KINDS = ["person", "domestic", "offshore"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_STATUSES = ["active", "suspended", "closed", "dissolved", "revoked", "liquidation"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const ENTITY_STATUS_LABELS: Record<EntityStatus, string> = {
  active: "營業中",
  suspended: "停業",
  closed: "歇業",
  dissolved: "解散",
  revoked: "撤銷／廢止",
  liquidation: "清算中",
};

export type EquityEntity = {
  id: string;
  name: string;
  kind: EntityKind;
  /** 是否為受查公司（佈局錨點）；一份圖恰好一個。 */
  isSubject: boolean;
  status: EntityStatus;
  /** 境外公司的登記地區，如 BVI、開曼、薩摩亞；其他類型留空。 */
  region?: string;
  /** 統編、資本額等給使用者看的備註。 */
  note?: string;
};

export type EquityHolding = {
  id: string;
  /** 股東（持有方）entity id。 */
  holderId: string;
  /** 被投資公司 entity id。 */
  ownedId: string;
  percentage: number;
  note?: string;
};

export type EquityChart = {
  version: 1;
  title: string;
  entities: EquityEntity[];
  holdings: EquityHolding[];
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

export function createEntity(overrides: Partial<EquityEntity> = {}): EquityEntity {
  return {
    id: newId(),
    name: "未命名",
    kind: "domestic",
    isSubject: false,
    status: "active",
    ...overrides,
  };
}

export function createSampleChart(): EquityChart {
  const subject = createEntity({ id: "e-subject", name: "宏昌實業股份有限公司", kind: "domestic", isSubject: true, note: "統編 12345678" });
  const founder = createEntity({ id: "e-founder", name: "王大明", kind: "person", note: "董事長" });
  const partner = createEntity({ id: "e-partner", name: "林美惠", kind: "person", note: "董事" });
  const holdco = createEntity({ id: "e-holdco", name: "遠見控股", kind: "offshore", region: "BVI" });
  const tradeSub = createEntity({ id: "e-trade", name: "宏昌貿易", kind: "offshore", region: "薩摩亞", status: "suspended" });
  const logistics = createEntity({ id: "e-logistics", name: "昌隆物流股份有限公司", kind: "domestic" });
  return {
    version: 1,
    title: "宏昌實業 股權架構",
    entities: [founder, partner, holdco, subject, tradeSub, logistics],
    holdings: [
      { id: newId(), holderId: founder.id, ownedId: subject.id, percentage: 45 },
      { id: newId(), holderId: partner.id, ownedId: subject.id, percentage: 35 },
      { id: newId(), holderId: holdco.id, ownedId: subject.id, percentage: 20 },
      { id: newId(), holderId: subject.id, ownedId: tradeSub.id, percentage: 100 },
      { id: newId(), holderId: subject.id, ownedId: logistics.id, percentage: 60 },
    ],
  };
}

/** 驗證並修復來自 localStorage 或匯入 JSON 的資料；完全無法修復時回傳 null。 */
export function normalizeChart(raw: unknown): { chart: EquityChart; repairs: string[] } | null {
  if (!isRecord(raw) || !Array.isArray(raw.entities)) return null;
  const repairs: string[] = [];

  const entities: EquityEntity[] = [];
  const entityIds = new Set<string>();
  for (const item of raw.entities) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id === "") continue;
    if (entityIds.has(item.id)) { repairs.push(`移除重複的實體 id「${item.id}」`); continue; }
    entityIds.add(item.id);
    const kind = typeof item.kind === "string" && (ENTITY_KINDS as readonly string[]).includes(item.kind) ? (item.kind as EntityKind) : "domestic";
    const status = typeof item.status === "string" && (ENTITY_STATUSES as readonly string[]).includes(item.status) ? (item.status as EntityStatus) : "active";
    entities.push({
      id: item.id,
      name: cleanText(item.name, "未命名", 60),
      kind,
      isSubject: item.isSubject === true,
      status,
      region: cleanOptionalText(item.region, 30),
      note: cleanOptionalText(item.note, 120),
    });
  }

  const subjects = entities.filter((entity) => entity.isSubject);
  if (subjects.length === 0 && entities.length > 0) {
    entities[0].isSubject = true;
    repairs.push(`沒有指定受查公司，已將「${entities[0].name}」設為受查公司`);
  } else if (subjects.length > 1) {
    for (const entity of subjects.slice(1)) entity.isSubject = false;
    repairs.push(`受查公司只能有一個，已保留「${subjects[0].name}」`);
  }

  const holdings: EquityHolding[] = [];
  const holdingIds = new Set<string>();
  for (const item of Array.isArray(raw.holdings) ? raw.holdings : []) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id === "") continue;
    if (holdingIds.has(item.id)) { repairs.push(`移除重複的持股關係 id「${item.id}」`); continue; }
    if (typeof item.holderId !== "string" || typeof item.ownedId !== "string" || !entityIds.has(item.holderId) || !entityIds.has(item.ownedId)) {
      repairs.push("移除指向不存在實體的持股關係");
      continue;
    }
    if (item.holderId === item.ownedId) { repairs.push("移除自我持股的關係"); continue; }
    holdingIds.add(item.id);
    const percentage = typeof item.percentage === "number" && Number.isFinite(item.percentage) ? item.percentage : 0;
    holdings.push({
      id: item.id,
      holderId: item.holderId,
      ownedId: item.ownedId,
      percentage: Math.min(Math.max(percentage, 0), 100),
      note: cleanOptionalText(item.note, 60),
    });
  }

  return {
    chart: {
      version: 1,
      title: cleanText(raw.title, "未命名股權架構", 80),
      entities,
      holdings,
    },
    repairs,
  };
}

export function findSubject(chart: EquityChart): EquityEntity | undefined {
  return chart.entities.find((entity) => entity.isSubject);
}

/** 每家被投資公司的持股加總，用來提示「加起來超過／不足 100%」。 */
export function holdingTotals(chart: EquityChart): Map<string, number> {
  const totals = new Map<string, number>();
  for (const holding of chart.holdings) totals.set(holding.ownedId, (totals.get(holding.ownedId) ?? 0) + holding.percentage);
  return totals;
}

export type ChartWarning = { entityId: string; message: string };

/** 回傳持股加總異常的警告（不阻擋使用，只是提醒）。 */
export function chartWarnings(chart: EquityChart): ChartWarning[] {
  const warnings: ChartWarning[] = [];
  const byId = new Map(chart.entities.map((entity) => [entity.id, entity]));
  for (const [ownedId, total] of holdingTotals(chart)) {
    const entity = byId.get(ownedId);
    if (!entity) continue;
    if (total > 100.001) warnings.push({ entityId: ownedId, message: `「${entity.name}」的持股加總 ${round1(total)}%，超過 100%` });
    else if (total < 99.999 && total > 0) warnings.push({ entityId: ownedId, message: `「${entity.name}」的持股加總 ${round1(total)}%，未滿 100%` });
  }
  return warnings;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

// --- 分層佈局 ---

export type EquityLayoutNode = { id: string; entity: EquityEntity; layer: number; column: number; x: number; y: number; connected: boolean };
export type EquityLayoutEdge = { id: string; holding: EquityHolding; fromId: string; toId: string; kind: "tree" | "cross" };
export type EquityLayout = { nodes: EquityLayoutNode[]; edges: EquityLayoutEdge[]; width: number; height: number };

export const EQUITY_BOX_WIDTH = 176;
export const EQUITY_BOX_HEIGHT = 60;
const COLUMN_GAP = 28;
const LAYER_GAP = 96;
const MARGIN = 40;

/** 交叉持股虛線弧線往右繞出去的最小幅度；SVG 元件畫弧線時用同一個常數，避免版面算的寬度跟實際畫的弧線兜不起來。 */
export const CROSS_EDGE_MIN_BULGE = 60;
/** 「交叉持股 100%」這類標籤的保守寬度估計，用來預留畫布右側空間，避免文字被裁切。 */
const CROSS_EDGE_LABEL_WIDTH = 130;
const CROSS_EDGE_LABEL_GAP = 6;

/**
 * 以受查公司為第 0 層，用 BFS 往外展開：「A 持有 B」代表 B 的層數是
 * A 的層數 + 1（B 在 A 下面）。同一個實體第一次被到達時決定層數與
 * 排列順序；之後再指到同一個實體、層數對不上的持股關係（交叉持股、
 * 循環持股）不影響版面，只在畫圖時標成虛線。跟受查公司完全不連通的
 * 實體，各自往下延伸出一條分支，避免疊在同一層裡看不出關係。
 */
export function computeEquityLayout(chart: EquityChart): EquityLayout {
  const subject = findSubject(chart);
  const layer = new Map<string, number>();
  const treeChildren = new Map<string, string[]>(); // parentId -> ordered child ids（同一層內的排列順序）
  const treeEdgeIds = new Set<string>();
  const visited = new Set<string>();

  const holdsFrom = new Map<string, EquityHolding[]>(); // holderId -> holdings
  const heldBy = new Map<string, EquityHolding[]>(); // ownedId -> holdings
  for (const holding of chart.holdings) {
    if (!holdsFrom.has(holding.holderId)) holdsFrom.set(holding.holderId, []);
    holdsFrom.get(holding.holderId)!.push(holding);
    if (!heldBy.has(holding.ownedId)) heldBy.set(holding.ownedId, []);
    heldBy.get(holding.ownedId)!.push(holding);
  }

  function addChild(parentId: string, childId: string) {
    if (!treeChildren.has(parentId)) treeChildren.set(parentId, []);
    treeChildren.get(parentId)!.push(childId);
  }

  function bfsFrom(rootId: string) {
    layer.set(rootId, 0);
    visited.add(rootId);
    const queue = [rootId];
    while (queue.length > 0) {
      const u = queue.shift()!;
      const uLayer = layer.get(u)!;
      // u 是持有方：往下走到被投資公司（層數 +1）。
      for (const holding of holdsFrom.get(u) ?? []) {
        const v = holding.ownedId;
        if (!visited.has(v)) {
          visited.add(v);
          layer.set(v, uLayer + 1);
          addChild(u, v);
          treeEdgeIds.add(holding.id);
          queue.push(v);
        } else if (layer.get(v) === uLayer + 1) {
          treeEdgeIds.add(holding.id);
        }
      }
      // u 是被投資方：往上走到股東（層數 -1）。
      for (const holding of heldBy.get(u) ?? []) {
        const w = holding.holderId;
        if (!visited.has(w)) {
          visited.add(w);
          layer.set(w, uLayer - 1);
          addChild(w, u); // 排列順序仍掛在較上層的父節點下
          treeEdgeIds.add(holding.id);
          queue.push(w);
        } else if (layer.get(w) === uLayer - 1) {
          treeEdgeIds.add(holding.id);
        }
      }
    }
  }

  if (subject) bfsFrom(subject.id);
  // 沒有受查公司，或圖中有跟受查公司不連通的實體：各自當作一棵獨立的樹，
  // 依序接在最深一層之後，確保每個實體都畫得出來。
  for (const entity of chart.entities) {
    if (!visited.has(entity.id)) bfsFrom(entity.id);
  }

  const nodesByLayer = new Map<number, string[]>();
  const orderedIds: string[] = [];
  // 依 BFS 樹的父子關係、以受查公司為根做前序走訪，讓同一分支的節點排在一起。
  const roots = subject ? [subject.id, ...chart.entities.map((e) => e.id).filter((id) => layer.get(id) === 0 && id !== subject.id)] : chart.entities.map((e) => e.id).filter((id) => layer.get(id) === 0);
  const placed = new Set<string>();
  function place(id: string) {
    if (placed.has(id)) return;
    placed.add(id);
    orderedIds.push(id);
    const l = layer.get(id)!;
    if (!nodesByLayer.has(l)) nodesByLayer.set(l, []);
    nodesByLayer.get(l)!.push(id);
    for (const childId of treeChildren.get(id) ?? []) place(childId);
  }
  for (const rootId of roots) place(rootId);
  for (const entity of chart.entities) place(entity.id); // 保險：理論上此時應已全數 placed

  const layers = [...nodesByLayer.keys()].sort((a, b) => a - b);
  const layerWidth = new Map<number, number>();
  for (const l of layers) {
    const count = nodesByLayer.get(l)!.length;
    layerWidth.set(l, count * EQUITY_BOX_WIDTH + Math.max(0, count - 1) * COLUMN_GAP);
  }
  const canvasWidth = Math.max(EQUITY_BOX_WIDTH, ...layerWidth.values()) + MARGIN * 2;

  const entityById = new Map(chart.entities.map((entity) => [entity.id, entity]));
  const nodes: EquityLayoutNode[] = [];
  const nodePosition = new Map<string, { x: number; y: number }>();
  for (const l of layers) {
    const ids = nodesByLayer.get(l)!;
    const rowWidth = layerWidth.get(l)!;
    const startX = MARGIN + (canvasWidth - MARGIN * 2 - rowWidth) / 2;
    const y = MARGIN + (l - layers[0]) * LAYER_GAP;
    ids.forEach((id, column) => {
      const x = startX + column * (EQUITY_BOX_WIDTH + COLUMN_GAP);
      nodePosition.set(id, { x, y });
      const entity = entityById.get(id);
      if (entity) nodes.push({ id, entity, layer: l, column, x, y, connected: subject ? id === subject.id || treeEdgeIds.size > 0 : true });
    });
  }

  const edges: EquityLayoutEdge[] = chart.holdings.map((holding) => ({
    id: holding.id,
    holding,
    fromId: holding.holderId,
    toId: holding.ownedId,
    kind: (treeEdgeIds.has(holding.id) ? "tree" : "cross") as "tree" | "cross",
  })).filter((edge) => nodePosition.has(edge.fromId) && nodePosition.has(edge.toId));

  // 交叉持股畫成往右繞出去的虛線弧線＋標籤（見 equity-chart-svg.tsx 的 crossPath）。
  // 這裡用同一套幾何算出最右邊的節點需要多少額外空間，避免弧線或標籤超出 viewBox 被裁切。
  let width = canvasWidth;
  for (const edge of edges) {
    if (edge.kind !== "cross") continue;
    const from = nodePosition.get(edge.fromId)!;
    const to = nodePosition.get(edge.toId)!;
    const fromCenterY = from.y + EQUITY_BOX_HEIGHT / 2;
    const toCenterY = to.y + EQUITY_BOX_HEIGHT / 2;
    const bulge = Math.max(CROSS_EDGE_MIN_BULGE, Math.abs(toCenterY - fromCenterY) / 2);
    const rightmostNodeEdge = Math.max(from.x, to.x) + EQUITY_BOX_WIDTH;
    const curveRightEdge = rightmostNodeEdge + bulge;
    const labelRightEdge = rightmostNodeEdge + CROSS_EDGE_LABEL_GAP + CROSS_EDGE_LABEL_WIDTH;
    width = Math.max(width, Math.max(curveRightEdge, labelRightEdge) + MARGIN);
  }

  const height = layers.length === 0 ? MARGIN * 2 + EQUITY_BOX_HEIGHT : MARGIN * 2 + (layers.length - 1) * LAYER_GAP + EQUITY_BOX_HEIGHT;
  return { nodes, edges, width: Math.round(width), height: Math.round(height) };
}

// --- 快速貼上：一行一筆「股東 > 被投資公司 百分比」 ---

const CORPORATE_SUFFIXES = ["股份有限公司", "有限公司", "企業社", "合夥", "控股", "集團", "商行", "工作室"];
const OFFSHORE_HINTS = ["BVI", "開曼", "薩摩亞", "英屬維京", "盧森堡", "百慕達", "馬紹爾", "香港", "新加坡", "模里西斯"];

function guessKind(name: string): EntityKind {
  if (OFFSHORE_HINTS.some((hint) => name.includes(hint))) return "offshore";
  if (CORPORATE_SUFFIXES.some((suffix) => name.includes(suffix))) return "domestic";
  return "person";
}

export type QuickPasteResult = { chart: EquityChart; warnings: string[] };

/**
 * 解析「股東 > 被投資公司 百分比」格式，一行一筆；行首加 `*` 可明確
 * 指定該行的股東（`>` 左邊）為受查公司。沒有明確指定時，取「被持股加總
 * 最高」的實體當受查公司 —— 徵信報告裡受查公司通常是整張圖裡被投資
 * 最集中的那一個。
 */
export function parseQuickPaste(text: string, title: string): QuickPasteResult {
  const entitiesByName = new Map<string, EquityEntity>();
  const holdings: EquityHolding[] = [];
  const warnings: string[] = [];
  let explicitSubjectName: string | null = null;

  function entityFor(rawName: string): EquityEntity {
    const name = rawName.trim().slice(0, 60);
    const existing = entitiesByName.get(name);
    if (existing) return existing;
    const entity = createEntity({ name, kind: guessKind(name) });
    entitiesByName.set(name, entity);
    return entity;
  }

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const marked = line.startsWith("*");
    const body = marked ? line.slice(1).trim() : line;
    const match = body.match(/^(.+?)\s*[>＞]\s*(.+?)\s+(\d+(?:\.\d+)?)\s*%?$/);
    if (!match) { warnings.push(`看不懂這一行，已略過：「${line}」`); continue; }
    const [, holderName, ownedName, percentageText] = match;
    const holder = entityFor(holderName);
    const owned = entityFor(ownedName);
    if (marked) explicitSubjectName = holder.name;
    if (holder.id === owned.id) { warnings.push(`股東與被投資公司相同，已略過：「${line}」`); continue; }
    const percentage = Math.min(Math.max(Number(percentageText), 0), 100);
    holdings.push({ id: newId(), holderId: holder.id, ownedId: owned.id, percentage });
  }

  const entities = [...entitiesByName.values()];
  let subjectId: string | undefined;
  if (explicitSubjectName) subjectId = entitiesByName.get(explicitSubjectName)?.id;
  if (!subjectId && entities.length > 0) {
    const totals = holdingTotals({ version: 1, title, entities, holdings });
    let best: { id: string; total: number } | null = null;
    for (const entity of entities) {
      const total = totals.get(entity.id) ?? 0;
      if (!best || total > best.total) best = { id: entity.id, total };
    }
    subjectId = best?.id;
  }
  for (const entity of entities) entity.isSubject = entity.id === subjectId;

  return { chart: { version: 1, title, entities, holdings }, warnings };
}
