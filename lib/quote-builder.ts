/**
 * 報價單產生器 —— 資料模型、稅額計算與 SVG 版面佈局。
 *
 * 台灣中小企業／接案者開報價單的兩個慣例決定了這裡的所有設計：
 *
 * 1. **金額以「元」為單位的整數處理**。報價單上不會出現 12,345.67 元，
 *    所以每一筆金額在算完之後都四捨五入成整數再往下算，而不是最後才
 *    一次進位 —— 兩者的差別會讓「未稅 + 稅額」跟「總計」差個一兩塊，
 *    客戶對帳時會被退件。
 * 2. **營業稅 5% 有「外加」與「內含」兩種報法**，計算方向相反：
 *    - 外加稅：報的是未稅價，稅額 = round(未稅 × 0.05)，總計 = 未稅 + 稅額。
 *    - 內含稅：報的是含稅價，未稅 = round(含稅 / 1.05)，稅額 = 含稅 − 未稅。
 *    內含稅一定要用「總計減未稅」回推稅額，不能另外算 round(含稅 × 0.05/1.05)，
 *    否則 subtotal + tax 不會剛好等於 total（見 tests/quote-builder.test.mjs）。
 *
 * 折扣一律在「稅前」套用：先算出品項合計，扣掉折扣得到計稅基礎，再依
 * 報價模式算稅。這是台灣報價單最常見的作法，也讓兩種模式的驗算條件
 * 一致：`taxableBase + taxAmount === grandTotal` 永遠成立。
 *
 * 純資料、零依賴，用 `node --test --experimental-strip-types` 驗證。
 */

export const TAX_MODES = ["exclusive", "inclusive"] as const;
/** `exclusive` = 未稅報價（外加 5% 稅）；`inclusive` = 含稅報價（金額已內含 5% 稅）。 */
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  exclusive: "未稅報價（外加 5% 營業稅）",
  inclusive: "含稅報價（金額已內含 5% 營業稅）",
};

export const DISCOUNT_TYPES = ["none", "amount", "percent"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** 台灣營業稅率。整份模組唯一的稅率來源，測試也讀這個常數。 */
export const TAX_RATE = 0.05;

export type QuoteParty = {
  /** 公司或個人名稱。 */
  name: string;
  /** 統一編號（8 碼）；個人接案可留空。 */
  taxId: string;
  /** 電話、Email、地址等聯絡資訊，多行。 */
  contact: string;
};

export type QuoteItem = {
  id: string;
  /** 品名。 */
  name: string;
  /** 規格說明，可留空。 */
  spec: string;
  quantity: number;
  unitPrice: number;
};

export type Quote = {
  version: 1;
  /** 報價單標題，例如「網站建置報價單」。 */
  title: string;
  /** 報價單號。 */
  number: string;
  /** 報價日期（YYYY-MM-DD）。 */
  issueDate: string;
  /** 有效期限（YYYY-MM-DD）。 */
  validUntil: string;
  seller: QuoteParty;
  buyer: QuoteParty;
  /** 客戶聯絡人姓名。 */
  buyerContactPerson: string;
  items: QuoteItem[];
  taxMode: TaxMode;
  discountType: DiscountType;
  /** 折扣數值：`amount` 是元、`percent` 是百分比；`none` 時忽略。 */
  discountValue: number;
  /** 付款條件。 */
  paymentTerms: string;
  /** 備註。 */
  notes: string;
};

export const MAX_ITEMS = 40;

export function newQuoteId() {
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

function cleanFreeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.slice(0, maxLength).trimEnd();
}

/** 只認 YYYY-MM-DD，其他一律當作沒填（空字串）——版面上留白比印出亂碼好。 */
function cleanDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  if (year < 1900 || year > 2999) return "";
  return text;
}

/** 數量允許小數（例如 1.5 小時），但夾在合理範圍內避免版面爆掉。 */
function cleanQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value * 100) / 100, 0), 999999);
}

/** 單價一律整數元：台灣報價單不會出現角、分。 */
function cleanMoney(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), -99999999), 99999999);
}

function cleanParty(raw: unknown, fallbackName: string): QuoteParty {
  const record = isRecord(raw) ? raw : {};
  return {
    name: cleanText(record.name, fallbackName, 60),
    taxId: cleanTaxId(record.taxId),
    contact: cleanFreeText(record.contact, 200),
  };
}

/** 統編只留數字，最多 8 碼；不強制檢核碼，很多情境會先填半組。 */
function cleanTaxId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "").slice(0, 8);
}

export function createItem(overrides: Partial<QuoteItem> = {}): QuoteItem {
  return { id: newQuoteId(), name: "", spec: "", quantity: 1, unitPrice: 0, ...overrides };
}

export function createSampleQuote(): Quote {
  return {
    version: 1,
    title: "網站建置報價單",
    number: "Q-2026-001",
    issueDate: "2026-08-02",
    validUntil: "2026-09-01",
    seller: { name: "青竹數位工作室", taxId: "12345678", contact: "台北市中正區忠孝東路一段 1 號\n02-2345-6789\nhello@example.com" },
    buyer: { name: "宏昌實業股份有限公司", taxId: "87654321", contact: "台中市西屯區台灣大道三段 99 號\n04-2345-6789" },
    buyerContactPerson: "王大明 採購經理",
    items: [
      createItem({ id: "i-1", name: "形象網站設計", spec: "首頁＋內頁 5 頁，含 RWD", quantity: 1, unitPrice: 68000 }),
      createItem({ id: "i-2", name: "前端切版與程式實作", spec: "Next.js，含 SEO 基礎設定", quantity: 1, unitPrice: 52000 }),
      createItem({ id: "i-3", name: "後續維護", spec: "每月 4 小時，先報 6 個月", quantity: 6, unitPrice: 4000 }),
    ],
    taxMode: "exclusive",
    discountType: "percent",
    discountValue: 5,
    paymentTerms: "簽約付 30%，設計確認付 40%，驗收後 30%。",
    notes: "本報價未含網域與主機費用。超出範圍的需求另行報價。",
  };
}

export function createEmptyQuote(): Quote {
  return {
    version: 1,
    title: "報價單",
    number: "",
    issueDate: "",
    validUntil: "",
    seller: { name: "", taxId: "", contact: "" },
    buyer: { name: "", taxId: "", contact: "" },
    buyerContactPerson: "",
    items: [createItem()],
    taxMode: "exclusive",
    discountType: "none",
    discountValue: 0,
    paymentTerms: "",
    notes: "",
  };
}

/**
 * 驗證並修復來自 localStorage 或匯入 JSON 的資料。
 * 逐欄檢查、逐欄給預設值；完全不像報價單的資料回傳 null。
 */
export function sanitizeQuote(raw: unknown): Quote | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.items) && typeof raw.title !== "string") return null;

  const items: QuoteItem[] = [];
  const seenIds = new Set<string>();
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    if (items.length >= MAX_ITEMS) break;
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === "string" && entry.id !== "" && !seenIds.has(entry.id) ? entry.id : newQuoteId();
    seenIds.add(id);
    items.push({
      id,
      name: cleanFreeText(entry.name, 80),
      spec: cleanFreeText(entry.spec, 160),
      quantity: cleanQuantity(entry.quantity),
      unitPrice: cleanMoney(entry.unitPrice),
    });
  }

  const taxMode = typeof raw.taxMode === "string" && (TAX_MODES as readonly string[]).includes(raw.taxMode) ? (raw.taxMode as TaxMode) : "exclusive";
  const discountType = typeof raw.discountType === "string" && (DISCOUNT_TYPES as readonly string[]).includes(raw.discountType)
    ? (raw.discountType as DiscountType)
    : "none";
  const rawDiscount = typeof raw.discountValue === "number" && Number.isFinite(raw.discountValue) ? raw.discountValue : 0;
  const discountValue = discountType === "percent"
    ? Math.min(Math.max(Math.round(rawDiscount * 100) / 100, 0), 100)
    : Math.min(Math.max(Math.round(rawDiscount), 0), 99999999);

  return {
    version: 1,
    title: cleanText(raw.title, "報價單", 40),
    number: cleanFreeText(raw.number, 30).trim(),
    issueDate: cleanDate(raw.issueDate),
    validUntil: cleanDate(raw.validUntil),
    seller: cleanParty(raw.seller, ""),
    buyer: cleanParty(raw.buyer, ""),
    buyerContactPerson: cleanFreeText(raw.buyerContactPerson, 40).trim(),
    items: items.length > 0 ? items : [createItem()],
    taxMode,
    discountType,
    discountValue,
    paymentTerms: cleanFreeText(raw.paymentTerms, 300),
    notes: cleanFreeText(raw.notes, 300),
  };
}

// --- 稅額計算 ---

export type QuoteItemTotal = { id: string; amount: number };

export type QuoteTotals = {
  /** 每一筆品項的小計（已四捨五入成整數元）。 */
  itemTotals: QuoteItemTotal[];
  /** 品項小計加總（折扣前）。 */
  itemsSubtotal: number;
  /** 實際折抵的金額（整數元，永遠 ≥ 0，且不超過 itemsSubtotal）。 */
  discountAmount: number;
  /** 折扣後、用來計稅的基礎金額。外加稅時是未稅金額；內含稅時是含稅金額。 */
  taxableBase: number;
  /** 未稅金額。 */
  subtotal: number;
  /** 5% 營業稅額。 */
  taxAmount: number;
  /** 總計（客戶要付的金額）。 */
  grandTotal: number;
};

/**
 * 算出一張報價單的所有金額。**全程整數元**：品項小計先四捨五入，
 * 折扣在稅前套用，最後才依報價模式分出未稅／稅額。
 *
 * 兩種模式的不變條件都是 `subtotal + taxAmount === grandTotal`：
 * - 外加稅：subtotal = taxableBase，taxAmount = round(subtotal × 0.05)，
 *   grandTotal = subtotal + taxAmount。
 * - 內含稅：grandTotal = taxableBase，subtotal = round(grandTotal / 1.05)，
 *   taxAmount = grandTotal − subtotal（相減回推，不另外算，才不會差 1 元）。
 */
export function computeQuoteTotals(quote: Quote): QuoteTotals {
  const itemTotals: QuoteItemTotal[] = quote.items.map((item) => ({
    id: item.id,
    amount: Math.round(item.quantity * item.unitPrice),
  }));
  const itemsSubtotal = itemTotals.reduce((sum, entry) => sum + entry.amount, 0);

  let discountAmount = 0;
  if (quote.discountType === "amount") discountAmount = Math.round(quote.discountValue);
  else if (quote.discountType === "percent") discountAmount = Math.round((itemsSubtotal * quote.discountValue) / 100);
  discountAmount = Math.min(Math.max(discountAmount, 0), Math.max(itemsSubtotal, 0));

  const taxableBase = itemsSubtotal - discountAmount;

  let subtotal: number;
  let taxAmount: number;
  let grandTotal: number;
  if (quote.taxMode === "inclusive") {
    grandTotal = taxableBase;
    subtotal = Math.round(grandTotal / (1 + TAX_RATE));
    taxAmount = grandTotal - subtotal;
  } else {
    subtotal = taxableBase;
    taxAmount = Math.round(subtotal * TAX_RATE);
    grandTotal = subtotal + taxAmount;
  }

  return { itemTotals, itemsSubtotal, discountAmount, taxableBase, subtotal, taxAmount, grandTotal };
}

/** 新台幣慣例的千分位顯示，不帶小數。 */
export function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ",";
    grouped += digits[index];
  }
  return `${negative ? "-" : ""}${grouped}`;
}

/** 數量顯示：整數不補小數點，小數最多兩位。 */
export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

// --- JSON 匯出／匯入 ---

export function serializeQuote(quote: Quote): string {
  return JSON.stringify(quote, null, 2);
}

/** 解析本工具匯出的 JSON；壞掉或不是報價單就回傳 null（呼叫端顯示錯誤訊息）。 */
export function parseQuote(text: string): Quote | null {
  try {
    return sanitizeQuote(JSON.parse(text));
  } catch {
    return null;
  }
}

// --- SVG 版面佈局 ---

export type QuoteLayoutTextRow = { label: string; value: string };
export type QuoteLayoutItemRow = {
  id: string;
  index: number;
  y: number;
  height: number;
  name: string;
  spec: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};
export type QuoteLayoutTotalRow = { label: string; value: string; emphasis: boolean; y: number };

export type QuoteLayout = {
  width: number;
  height: number;
  /** 內容區左右邊界（含裝飾外框的內縮）。 */
  contentLeft: number;
  contentRight: number;
  titleY: number;
  metaRows: QuoteLayoutTextRow[];
  metaY: number;
  sellerY: number;
  buyerY: number;
  sellerLines: string[];
  buyerLines: string[];
  partyBlockHeight: number;
  tableTop: number;
  tableHeaderHeight: number;
  /** 五個欄位的 x 座標：序號、品名、數量、單價、小計。 */
  columnX: { index: number; name: number; quantity: number; unitPrice: number; amount: number };
  rows: QuoteLayoutItemRow[];
  tableBottom: number;
  totalRows: QuoteLayoutTotalRow[];
  totalsTop: number;
  totalsBottom: number;
  taxNote: string;
  footerBlocks: Array<{ heading: string; lines: string[]; y: number }>;
  footerBottom: number;
};

/** A4 直式 210mm 換算成 96dpi 的像素寬，讓列印／貼進文件時比例正確。 */
export const QUOTE_PAGE_WIDTH = 794;
const PAGE_MARGIN = 44;
/** 外框陰影往右下溢出的量；viewBox 一定要含進來，否則匯出的 SVG 會被切掉一角。 */
export const QUOTE_SHADOW_OFFSET = 6;
const ROW_HEIGHT = 30;
const ROW_HEIGHT_WITH_SPEC = 44;
const LINE_HEIGHT = 16;

function splitLines(text: string, maxLines: number): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function partyLines(party: QuoteParty, extra?: string): string[] {
  const lines: string[] = [];
  if (party.taxId) lines.push(`統一編號：${party.taxId}`);
  if (extra) lines.push(extra);
  lines.push(...splitLines(party.contact, 4));
  return lines.map((line) => truncate(line, 38));
}

/**
 * 算出報價單 SVG 每個區塊的座標。版面由上到下：標題與單號 → 買賣雙方 →
 * 品項表格 → 金額小計 → 付款條件與備註。高度隨品項數量與備註行數長高。
 *
 * `width`／`height` 已經含入右下角外框陰影的溢出量（`QUOTE_SHADOW_OFFSET`），
 * 讓 SVG 元件可以直接把它當成 viewBox 用，不會裁掉陰影。
 */
export function layoutQuote(quote: Quote, totals: QuoteTotals): QuoteLayout {
  const contentLeft = PAGE_MARGIN;
  const contentRight = QUOTE_PAGE_WIDTH - PAGE_MARGIN;

  const titleY = PAGE_MARGIN + 34;

  const metaRows: QuoteLayoutTextRow[] = [];
  if (quote.number) metaRows.push({ label: "報價單號", value: truncate(quote.number, 24) });
  if (quote.issueDate) metaRows.push({ label: "報價日期", value: quote.issueDate });
  if (quote.validUntil) metaRows.push({ label: "有效期限", value: quote.validUntil });
  const metaY = titleY + 26;

  const sellerLines = partyLines(quote.seller);
  const buyerLines = partyLines(quote.buyer, quote.buyerContactPerson ? `聯絡人：${truncate(quote.buyerContactPerson, 24)}` : undefined);
  const partyTop = metaY + Math.max(metaRows.length, 1) * 18 + 20;
  const sellerY = partyTop;
  const buyerY = partyTop;
  const partyBlockHeight = 26 + Math.max(sellerLines.length, buyerLines.length, 1) * LINE_HEIGHT + 14;

  const tableTop = partyTop + partyBlockHeight + 22;
  const tableHeaderHeight = 30;

  const columnX = {
    index: contentLeft + 12,
    name: contentLeft + 44,
    quantity: contentRight - 250,
    unitPrice: contentRight - 140,
    amount: contentRight - 12,
  };

  const rows: QuoteLayoutItemRow[] = [];
  let cursor = tableTop + tableHeaderHeight;
  quote.items.forEach((item, index) => {
    const spec = truncate(item.spec.replace(/\s*\n\s*/g, " ").trim(), 34);
    const height = spec ? ROW_HEIGHT_WITH_SPEC : ROW_HEIGHT;
    rows.push({
      id: item.id,
      index: index + 1,
      y: cursor,
      height,
      name: truncate(item.name.trim() || "（未填品名）", 24),
      spec,
      quantity: formatQuantity(item.quantity),
      unitPrice: formatMoney(item.unitPrice),
      amount: formatMoney(totals.itemTotals[index]?.amount ?? 0),
    });
    cursor += height;
  });
  const tableBottom = Math.max(cursor, tableTop + tableHeaderHeight + ROW_HEIGHT);

  const totalRows: QuoteLayoutTotalRow[] = [];
  const totalsTop = tableBottom + 18;
  let totalCursor = totalsTop;
  function pushTotal(label: string, value: string, emphasis = false) {
    totalRows.push({ label, value, emphasis, y: totalCursor + (emphasis ? 16 : 12) });
    totalCursor += emphasis ? 34 : 24;
  }

  pushTotal("品項合計", formatMoney(totals.itemsSubtotal));
  if (quote.discountType !== "none") {
    const label = quote.discountType === "percent" ? `折扣（稅前 ${formatQuantity(quote.discountValue)}%）` : "折扣（稅前）";
    pushTotal(label, `-${formatMoney(totals.discountAmount)}`);
  }
  pushTotal("未稅金額", formatMoney(totals.subtotal));
  pushTotal("營業稅 5%", formatMoney(totals.taxAmount));
  pushTotal("總計（含稅）", formatMoney(totals.grandTotal), true);
  const totalsBottom = totalCursor + 6;

  const taxNote = quote.taxMode === "inclusive"
    ? "本報價為含稅價，上列單價已內含 5% 營業稅。"
    : "本報價為未稅價，另加 5% 營業稅。";

  const footerBlocks: Array<{ heading: string; lines: string[]; y: number }> = [];
  let footerCursor = totalsBottom + 22;
  for (const [heading, text] of [["付款條件", quote.paymentTerms], ["備註", quote.notes]] as const) {
    const lines = splitLines(text, 6).map((line) => truncate(line, 46));
    if (lines.length === 0) continue;
    footerBlocks.push({ heading, lines, y: footerCursor });
    footerCursor += 20 + lines.length * LINE_HEIGHT + 12;
  }
  const footerBottom = footerCursor + 8;

  // 高度取「內容底部」與「A4 一頁高」的較大者，短報價單也維持標準比例。
  const contentHeight = Math.max(footerBottom + PAGE_MARGIN, 1123);
  return {
    width: QUOTE_PAGE_WIDTH + QUOTE_SHADOW_OFFSET,
    height: contentHeight + QUOTE_SHADOW_OFFSET,
    contentLeft,
    contentRight,
    titleY,
    metaRows,
    metaY,
    sellerY,
    buyerY,
    sellerLines,
    buyerLines,
    partyBlockHeight,
    tableTop,
    tableHeaderHeight,
    columnX,
    rows,
    tableBottom,
    totalRows,
    totalsTop,
    totalsBottom,
    taxNote,
    footerBlocks,
    footerBottom,
  };
}

/** 檔名用：把標題與單號組成安全的檔名（不含路徑分隔與 Windows 禁用字元）。 */
export function quoteFilename(quote: Quote): string {
  const base = [quote.number, quote.title].filter(Boolean).join("-");
  const safe = base.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48);
  return safe || "toolverse-quote";
}
