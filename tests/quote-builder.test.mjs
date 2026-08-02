import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ITEMS,
  TAX_RATE,
  computeQuoteTotals,
  createEmptyQuote,
  createItem,
  createSampleQuote,
  formatMoney,
  formatQuantity,
  layoutQuote,
  parseQuote,
  quoteFilename,
  sanitizeQuote,
  serializeQuote,
} from "../lib/quote-builder.ts";

function quoteWith(overrides = {}) {
  return { ...createEmptyQuote(), ...overrides };
}

function itemsOf(...pairs) {
  return pairs.map(([quantity, unitPrice], index) =>
    createItem({ id: `i-${index}`, name: `品項 ${index + 1}`, quantity, unitPrice }));
}

test("營業稅率是台灣的 5%", () => {
  assert.equal(TAX_RATE, 0.05);
});

// --- 外加稅（未稅報價） ---

test("外加稅：小計 = Σ(數量×單價)，稅額 = round(小計 × 0.05)，總計 = 小計 + 稅額", () => {
  const totals = computeQuoteTotals(quoteWith({ taxMode: "exclusive", items: itemsOf([1, 68000], [6, 4000]) }));
  assert.equal(totals.itemsSubtotal, 92000);
  assert.equal(totals.subtotal, 92000);
  assert.equal(totals.taxAmount, 4600);
  assert.equal(totals.grandTotal, 96600);
});

test("外加稅：稅額四捨五入到整數元，未稅 + 稅額 仍等於總計", () => {
  // 12345 × 0.05 = 617.25 → 617
  const totals = computeQuoteTotals(quoteWith({ taxMode: "exclusive", items: itemsOf([1, 12345]) }));
  assert.equal(totals.subtotal, 12345);
  assert.equal(totals.taxAmount, 617);
  assert.equal(totals.grandTotal, 12962);
  assert.equal(totals.subtotal + totals.taxAmount, totals.grandTotal);
});

test("外加稅：.5 進位方向一致（Math.round 向上）", () => {
  // 12350 × 0.05 = 617.5 → 618
  const totals = computeQuoteTotals(quoteWith({ taxMode: "exclusive", items: itemsOf([1, 12350]) }));
  assert.equal(totals.taxAmount, 618);
  assert.equal(totals.grandTotal, 12968);
});

// --- 內含稅（含稅報價） ---

test("內含稅：總計 = Σ(數量×單價)，未稅 = round(總計 / 1.05)，稅額 = 總計 − 未稅", () => {
  const totals = computeQuoteTotals(quoteWith({ taxMode: "inclusive", items: itemsOf([1, 105000]) }));
  assert.equal(totals.grandTotal, 105000);
  assert.equal(totals.subtotal, 100000);
  assert.equal(totals.taxAmount, 5000);
});

test("內含稅：不能整除時稅額用相減回推，未稅 + 稅額 精確等於總計", () => {
  // 10000 / 1.05 = 9523.809… → 9524；稅額必須是 10000 − 9524 = 476，
  // 不是 round(10000 × 0.05 / 1.05) = 476 之外的任何值。
  const totals = computeQuoteTotals(quoteWith({ taxMode: "inclusive", items: itemsOf([1, 10000]) }));
  assert.equal(totals.grandTotal, 10000);
  assert.equal(totals.subtotal, 9524);
  assert.equal(totals.taxAmount, 476);
  assert.equal(totals.subtotal + totals.taxAmount, totals.grandTotal);
});

test("內含稅：大量隨機金額都不會出現 1 元誤差", () => {
  for (let amount = 1; amount <= 3000; amount += 1) {
    const totals = computeQuoteTotals(quoteWith({ taxMode: "inclusive", items: itemsOf([1, amount]) }));
    assert.equal(totals.subtotal + totals.taxAmount, totals.grandTotal, `含稅 ${amount} 元對不起來`);
    assert.equal(totals.grandTotal, amount);
    assert.ok(totals.taxAmount >= 0, `含稅 ${amount} 元的稅額不該是負的`);
  }
});

test("兩種模式的驗算不變條件：未稅 + 稅額 = 總計，且計稅基礎對應到正確的一邊", () => {
  for (const taxMode of ["exclusive", "inclusive"]) {
    for (const price of [0, 1, 7, 99, 1234, 56789, 1000000]) {
      const totals = computeQuoteTotals(quoteWith({ taxMode, items: itemsOf([3, price]) }));
      assert.equal(totals.subtotal + totals.taxAmount, totals.grandTotal, `${taxMode} ${price} 驗算失敗`);
      assert.equal(totals.taxableBase, taxMode === "inclusive" ? totals.grandTotal : totals.subtotal);
    }
  }
});

test("同一筆金額在兩種模式下的總計不同（外加稅比較貴）", () => {
  const items = itemsOf([1, 100000]);
  const exclusive = computeQuoteTotals(quoteWith({ taxMode: "exclusive", items }));
  const inclusive = computeQuoteTotals(quoteWith({ taxMode: "inclusive", items }));
  assert.equal(exclusive.grandTotal, 105000);
  assert.equal(inclusive.grandTotal, 100000);
  assert.ok(exclusive.grandTotal > inclusive.grandTotal);
  assert.equal(exclusive.subtotal, 100000);
  assert.equal(inclusive.subtotal, 95238);
});

// --- 折扣（稅前套用） ---

test("百分比折扣在稅前套用：先折後稅", () => {
  const totals = computeQuoteTotals(quoteWith({
    taxMode: "exclusive",
    items: itemsOf([1, 100000]),
    discountType: "percent",
    discountValue: 10,
  }));
  assert.equal(totals.itemsSubtotal, 100000);
  assert.equal(totals.discountAmount, 10000);
  assert.equal(totals.taxableBase, 90000);
  assert.equal(totals.subtotal, 90000);
  assert.equal(totals.taxAmount, 4500);
  assert.equal(totals.grandTotal, 94500);
});

test("金額折扣在稅前套用，含稅模式一樣先折再拆稅", () => {
  const totals = computeQuoteTotals(quoteWith({
    taxMode: "inclusive",
    items: itemsOf([1, 10500]),
    discountType: "amount",
    discountValue: 500,
  }));
  assert.equal(totals.discountAmount, 500);
  assert.equal(totals.grandTotal, 10000);
  assert.equal(totals.subtotal, 9524);
  assert.equal(totals.taxAmount, 476);
  assert.equal(totals.subtotal + totals.taxAmount, totals.grandTotal);
});

test("折扣金額不會超過品項合計，也不會變成負的加價", () => {
  const over = computeQuoteTotals(quoteWith({
    items: itemsOf([1, 1000]),
    discountType: "amount",
    discountValue: 99999,
  }));
  assert.equal(over.discountAmount, 1000);
  assert.equal(over.taxableBase, 0);
  assert.equal(over.grandTotal, 0);

  const negative = computeQuoteTotals(quoteWith({
    items: itemsOf([1, 1000]),
    discountType: "amount",
    discountValue: -500,
  }));
  assert.equal(negative.discountAmount, 0);
  assert.equal(negative.grandTotal, 1050);
});

test("discountType 是 none 時，即使留著折扣數值也不折抵", () => {
  const totals = computeQuoteTotals(quoteWith({
    items: itemsOf([1, 1000]),
    discountType: "none",
    discountValue: 30,
  }));
  assert.equal(totals.discountAmount, 0);
  assert.equal(totals.grandTotal, 1050);
});

test("百分比折扣四捨五入成整數元", () => {
  // 3333 × 7% = 233.31 → 233
  const totals = computeQuoteTotals(quoteWith({
    items: itemsOf([1, 3333]),
    discountType: "percent",
    discountValue: 7,
  }));
  assert.equal(totals.discountAmount, 233);
  assert.equal(totals.taxableBase, 3100);
});

// --- 邊界 ---

test("空品項與零金額不會炸掉，全部回 0", () => {
  for (const taxMode of ["exclusive", "inclusive"]) {
    const empty = computeQuoteTotals(quoteWith({ taxMode, items: [] }));
    assert.equal(empty.itemsSubtotal, 0);
    assert.equal(empty.subtotal, 0);
    assert.equal(empty.taxAmount, 0);
    assert.equal(empty.grandTotal, 0);
    assert.deepEqual(empty.itemTotals, []);
  }
});

test("數量為 0 或單價為 0 的品項小計是 0", () => {
  const totals = computeQuoteTotals(quoteWith({ items: itemsOf([0, 5000], [3, 0], [2, 100]) }));
  assert.deepEqual(totals.itemTotals.map((entry) => entry.amount), [0, 0, 200]);
  assert.equal(totals.itemsSubtotal, 200);
});

test("小數數量的小計四捨五入成整數元後才加總", () => {
  // 1.5 × 333 = 499.5 → 500；2.5 × 111 = 277.5 → 278
  const totals = computeQuoteTotals(quoteWith({ items: itemsOf([1.5, 333], [2.5, 111]) }));
  assert.deepEqual(totals.itemTotals.map((entry) => entry.amount), [500, 278]);
  assert.equal(totals.itemsSubtotal, 778);
});

test("範例報價單的金額算得出來且驗算通過", () => {
  const totals = computeQuoteTotals(createSampleQuote());
  assert.equal(totals.itemsSubtotal, 68000 + 52000 + 24000);
  assert.equal(totals.discountAmount, Math.round(144000 * 0.05));
  assert.equal(totals.subtotal + totals.taxAmount, totals.grandTotal);
});

// --- sanitize / JSON 往返 ---

test("sanitizeQuote 逐欄驗證，壞欄位換成安全預設值", () => {
  const cleaned = sanitizeQuote({
    title: "   ",
    number: "  Q-9  ",
    issueDate: "2026/08/02",
    validUntil: "2026-13-40",
    seller: { name: "我方", taxId: "12-345-678x9", contact: 42 },
    buyer: "不是物件",
    buyerContactPerson: "  陳小美  ",
    items: [
      { id: "a", name: "正常", quantity: 2, unitPrice: 100 },
      { id: "a", name: "重複 id", quantity: 1, unitPrice: 1 },
      "不是物件",
      { name: "沒有 id", quantity: "三", unitPrice: 10.6 },
    ],
    taxMode: "unknown",
    discountType: "percent",
    discountValue: 999,
    notes: 12345,
  });
  assert.ok(cleaned);
  assert.equal(cleaned.title, "報價單");
  assert.equal(cleaned.number, "Q-9");
  assert.equal(cleaned.issueDate, "", "非 YYYY-MM-DD 一律清成空字串");
  assert.equal(cleaned.validUntil, "", "月份 13 不合法");
  assert.equal(cleaned.seller.taxId, "12345678", "統編只留數字並截到 8 碼");
  assert.equal(cleaned.seller.contact, "");
  assert.equal(cleaned.buyer.name, "");
  assert.equal(cleaned.buyerContactPerson, "陳小美");
  assert.equal(cleaned.taxMode, "exclusive", "看不懂的稅別退回外加稅");
  assert.equal(cleaned.discountValue, 100, "百分比折扣夾在 0～100");
  assert.equal(cleaned.notes, "");
  assert.equal(cleaned.items.length, 3);
  assert.notEqual(cleaned.items[1].id, cleaned.items[0].id, "重複 id 要換成新的");
  assert.equal(cleaned.items[2].quantity, 0, "看不懂的數量當 0");
  assert.equal(cleaned.items[2].unitPrice, 11, "單價四捨五入成整數元");
});

test("sanitizeQuote 拒絕完全不像報價單的資料，但空品項會補一列", () => {
  assert.equal(sanitizeQuote(null), null);
  assert.equal(sanitizeQuote("字串"), null);
  assert.equal(sanitizeQuote({ hello: "world" }), null);
  const blank = sanitizeQuote({ items: [] });
  assert.ok(blank);
  assert.equal(blank.items.length, 1);
});

test("sanitizeQuote 截斷超量品項", () => {
  const many = Array.from({ length: MAX_ITEMS + 12 }, (_, index) => ({ id: `x-${index}`, name: `第 ${index}`, quantity: 1, unitPrice: 1 }));
  assert.equal(sanitizeQuote({ items: many }).items.length, MAX_ITEMS);
});

test("JSON 往返：序列化再解析回來完全相同，金額也一致", () => {
  const original = createSampleQuote();
  const restored = parseQuote(serializeQuote(original));
  assert.ok(restored);
  assert.deepEqual(restored, original);
  assert.deepEqual(computeQuoteTotals(restored), computeQuoteTotals(original));
});

test("JSON 往返：內含稅模式與折扣設定都保留", () => {
  const original = { ...createSampleQuote(), taxMode: "inclusive", discountType: "amount", discountValue: 3000 };
  const restored = parseQuote(serializeQuote(original));
  assert.equal(restored.taxMode, "inclusive");
  assert.equal(restored.discountType, "amount");
  assert.equal(restored.discountValue, 3000);
});

test("parseQuote 對壞掉的 JSON 回 null，不丟例外", () => {
  assert.equal(parseQuote("{ 不是 JSON"), null);
  assert.equal(parseQuote("[]"), null);
  assert.equal(parseQuote('"字串"'), null);
});

// --- 顯示格式 ---

test("金額用新台幣千分位顯示，不帶小數", () => {
  assert.equal(formatMoney(0), "0");
  assert.equal(formatMoney(999), "999");
  assert.equal(formatMoney(1000), "1,000");
  assert.equal(formatMoney(96600), "96,600");
  assert.equal(formatMoney(1234567), "1,234,567");
  assert.equal(formatMoney(-2500), "-2,500");
  assert.equal(formatMoney(1234.6), "1,235");
});

test("數量整數不補小數點，小數最多兩位", () => {
  assert.equal(formatQuantity(3), "3");
  assert.equal(formatQuantity(1.5), "1.5");
  assert.equal(formatQuantity(1.25), "1.25");
  assert.equal(formatQuantity(1.2567), "1.26");
});

test("檔名去掉路徑分隔與禁用字元", () => {
  assert.equal(quoteFilename({ number: "Q/2026:1", title: "報價 單" }), "Q-2026-1-報價-單");
  assert.equal(quoteFilename({ number: "", title: "" }), "toolverse-quote");
});

// --- 版面佈局 ---

test("layoutQuote 的 viewBox 涵蓋所有內容與外框陰影", () => {
  const quote = createSampleQuote();
  const layout = layoutQuote(quote, computeQuoteTotals(quote));
  assert.ok(layout.width > layout.contentRight, "寬度必須含入右側邊界與陰影");
  assert.ok(layout.height > layout.footerBottom, "高度必須含入頁尾之後的留白與陰影");
  for (const row of layout.rows) {
    assert.ok(row.y + row.height <= layout.height, "品項列不可超出畫布");
  }
  for (const row of layout.totalRows) {
    assert.ok(row.y <= layout.height, "金額列不可超出畫布");
  }
  assert.ok(layout.columnX.amount <= layout.contentRight, "小計欄不可超出內容右界");
});

test("layoutQuote 的區塊由上到下不重疊", () => {
  const quote = createSampleQuote();
  const layout = layoutQuote(quote, computeQuoteTotals(quote));
  assert.ok(layout.titleY < layout.metaY);
  assert.ok(layout.metaY < layout.sellerY);
  assert.ok(layout.sellerY + layout.partyBlockHeight <= layout.tableTop);
  assert.ok(layout.tableTop < layout.tableBottom);
  assert.ok(layout.tableBottom <= layout.totalsTop);
  assert.ok(layout.totalsTop < layout.totalsBottom);
  assert.ok(layout.totalsBottom <= layout.footerBottom);
});

test("品項變多時畫布會長高，每一列都排在前一列下面", () => {
  const few = createSampleQuote();
  const many = { ...few, items: Array.from({ length: 30 }, (_, index) => createItem({ id: `m-${index}`, name: `品項 ${index}`, spec: "規格說明", quantity: 1, unitPrice: 1000 })) };
  const layoutFew = layoutQuote(few, computeQuoteTotals(few));
  const layoutMany = layoutQuote(many, computeQuoteTotals(many));
  assert.ok(layoutMany.height > layoutFew.height);
  for (let index = 1; index < layoutMany.rows.length; index += 1) {
    const previous = layoutMany.rows[index - 1];
    assert.equal(layoutMany.rows[index].y, previous.y + previous.height, "列與列之間不可重疊或留縫");
  }
});

test("有規格說明的品項列比較高", () => {
  const quote = quoteWith({ items: [createItem({ id: "a", name: "無規格" }), createItem({ id: "b", name: "有規格", spec: "含 RWD" })] });
  const layout = layoutQuote(quote, computeQuoteTotals(quote));
  assert.ok(layout.rows[1].height > layout.rows[0].height);
});

test("稅別說明文字對應報價模式", () => {
  const exclusive = quoteWith({ taxMode: "exclusive" });
  const inclusive = quoteWith({ taxMode: "inclusive" });
  assert.match(layoutQuote(exclusive, computeQuoteTotals(exclusive)).taxNote, /未稅價，另加/);
  assert.match(layoutQuote(inclusive, computeQuoteTotals(inclusive)).taxNote, /含稅價/);
});

test("沒有折扣時不畫折扣列；有折扣時標示稅前", () => {
  const plain = quoteWith({ items: itemsOf([1, 1000]) });
  const plainLabels = layoutQuote(plain, computeQuoteTotals(plain)).totalRows.map((row) => row.label);
  assert.ok(!plainLabels.some((label) => label.includes("折扣")));

  const discounted = quoteWith({ items: itemsOf([1, 1000]), discountType: "percent", discountValue: 10 });
  const discountedRows = layoutQuote(discounted, computeQuoteTotals(discounted)).totalRows;
  const discountRow = discountedRows.find((row) => row.label.includes("折扣"));
  assert.ok(discountRow);
  assert.match(discountRow.label, /稅前/);
  assert.equal(discountRow.value, "-100");
});

test("空的付款條件與備註不會留下空白區塊", () => {
  const quote = quoteWith({ paymentTerms: "  \n  ", notes: "" });
  assert.deepEqual(layoutQuote(quote, computeQuoteTotals(quote)).footerBlocks, []);
});

test("品項全空時仍畫得出表格，未填品名有替代文字", () => {
  const quote = quoteWith({ items: [createItem({ id: "blank" })] });
  const layout = layoutQuote(quote, computeQuoteTotals(quote));
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].name, "（未填品名）");
  assert.ok(layout.tableBottom > layout.tableTop);
});

test("版面上的總計字串與 computeQuoteTotals 一致", () => {
  const quote = quoteWith({ taxMode: "inclusive", items: itemsOf([1, 10000]) });
  const totals = computeQuoteTotals(quote);
  const layout = layoutQuote(quote, totals);
  const grand = layout.totalRows.find((row) => row.emphasis);
  assert.equal(grand.value, formatMoney(totals.grandTotal));
  assert.equal(layout.totalRows.find((row) => row.label === "未稅金額").value, formatMoney(totals.subtotal));
  assert.equal(layout.totalRows.find((row) => row.label === "營業稅 5%").value, formatMoney(totals.taxAmount));
});
