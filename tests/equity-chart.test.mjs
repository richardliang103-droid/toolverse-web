import assert from "node:assert/strict";
import test from "node:test";
import {
  EQUITY_BOX_WIDTH,
  chartWarnings,
  computeEquityLayout,
  createEntity,
  createSampleChart,
  findSubject,
  holdingTotals,
  normalizeChart,
  parseQuickPaste,
} from "../lib/equity-chart.ts";

function chartOf(entities, holdings) {
  return { version: 1, title: "測試", entities, holdings };
}

test("sample chart normalizes cleanly with exactly one subject", () => {
  const sample = createSampleChart();
  const result = normalizeChart(sample);
  assert.ok(result);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.chart.entities.filter((e) => e.isSubject).length, 1);
});

test("normalizeChart repairs missing, duplicate and multiple subjects", () => {
  const a = createEntity({ id: "a", name: "A" });
  const b = createEntity({ id: "b", name: "B", isSubject: true });
  const c = createEntity({ id: "b", name: "重複的 b", isSubject: true }); // 重複 id
  const noSubject = normalizeChart(chartOf([{ ...a, isSubject: false }], []));
  assert.equal(noSubject.chart.entities[0].isSubject, true);
  assert.match(noSubject.repairs[0], /沒有指定受查公司/);

  const dup = normalizeChart(chartOf([a, b, c], []));
  assert.equal(dup.chart.entities.length, 2);
  assert.match(dup.repairs.join(""), /重複的實體 id/);

  const twoSubjects = createEntity({ id: "d", name: "D", isSubject: true });
  const multi = normalizeChart(chartOf([b, twoSubjects], []));
  assert.equal(multi.chart.entities.filter((e) => e.isSubject).length, 1);
  assert.equal(multi.chart.entities.find((e) => e.id === "b").isSubject, true);
  assert.match(multi.repairs.join(""), /受查公司只能有一個/);
});

test("normalizeChart drops holdings with missing entities or self-holding", () => {
  const a = createEntity({ id: "a", name: "A", isSubject: true });
  const raw = chartOf([a], [
    { id: "h1", holderId: "a", ownedId: "a", percentage: 10 },
    { id: "h2", holderId: "a", ownedId: "missing", percentage: 20 },
    { id: "h3", holderId: "a", ownedId: "a", percentage: 5 },
  ]);
  const result = normalizeChart(raw);
  assert.equal(result.chart.holdings.length, 0);
  assert.equal(result.repairs.length, 3);
});

test("normalizeChart clamps out-of-range percentages", () => {
  const a = createEntity({ id: "a", isSubject: true });
  const b = createEntity({ id: "b" });
  const result = normalizeChart(chartOf([a, b], [{ id: "h1", holderId: "b", ownedId: "a", percentage: 150 }]));
  assert.equal(result.chart.holdings[0].percentage, 100);
});

test("holdingTotals sums percentages per owned entity", () => {
  const a = createEntity({ id: "a", isSubject: true });
  const b = createEntity({ id: "b" });
  const c = createEntity({ id: "c" });
  const chart = chartOf([a, b, c], [
    { id: "h1", holderId: "b", ownedId: "a", percentage: 60 },
    { id: "h2", holderId: "c", ownedId: "a", percentage: 30 },
  ]);
  const totals = holdingTotals(chart);
  assert.equal(totals.get("a"), 90);
});

test("chartWarnings flags totals over and under 100%", () => {
  const a = createEntity({ id: "a", name: "甲公司", isSubject: true });
  const b = createEntity({ id: "b", name: "乙" });
  const c = createEntity({ id: "c", name: "丙" });
  const over = chartOf([a, b], [{ id: "h1", holderId: "b", ownedId: "a", percentage: 100 }, { id: "h2", holderId: "c", ownedId: "a", percentage: 20 }]);
  const overWarnings = chartWarnings({ ...over, entities: [a, b, c] });
  assert.match(overWarnings.map((w) => w.message).join(""), /超過 100%/);

  const under = chartOf([a, b], [{ id: "h1", holderId: "b", ownedId: "a", percentage: 40 }]);
  const underWarnings = chartWarnings(under);
  assert.match(underWarnings.map((w) => w.message).join(""), /未滿 100%/);

  const exact = chartOf([a, b], [{ id: "h1", holderId: "b", ownedId: "a", percentage: 100 }]);
  assert.equal(chartWarnings(exact).length, 0);
});

test("computeEquityLayout places the subject at layer 0, shareholders above, subsidiaries below", () => {
  const chart = createSampleChart();
  const layout = computeEquityLayout(chart);
  const subject = findSubject(chart);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get(subject.id).layer, 0);

  for (const holding of chart.holdings) {
    if (holding.ownedId === subject.id) assert.equal(byId.get(holding.holderId).layer, -1);
    if (holding.holderId === subject.id) assert.equal(byId.get(holding.ownedId).layer, 1);
  }
});

test("computeEquityLayout does not overlap boxes within the same layer", () => {
  const chart = createSampleChart();
  const layout = computeEquityLayout(chart);
  const byLayer = new Map();
  for (const node of layout.nodes) {
    if (!byLayer.has(node.layer)) byLayer.set(node.layer, []);
    byLayer.get(node.layer).push(node);
  }
  for (const nodes of byLayer.values()) {
    const sorted = [...nodes].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(sorted[i].x >= sorted[i - 1].x + 100, "同層節點不應重疊");
    }
  }
});

test("computeEquityLayout terminates and marks a genuine cycle as a cross edge", () => {
  const a = createEntity({ id: "a", name: "A", isSubject: true });
  const b = createEntity({ id: "b", name: "B" });
  const c = createEntity({ id: "c", name: "C" });
  // a 持有 b，b 持有 c，c 又持有 a：循環持股。
  const chart = chartOf([a, b, c], [
    { id: "h1", holderId: "a", ownedId: "b", percentage: 10 },
    { id: "h2", holderId: "b", ownedId: "c", percentage: 10 },
    { id: "h3", holderId: "c", ownedId: "a", percentage: 10 },
  ]);
  const layout = computeEquityLayout(chart);
  assert.equal(layout.nodes.length, 3);
  const crossEdges = layout.edges.filter((edge) => edge.kind === "cross");
  assert.equal(crossEdges.length, 1);
});

test("computeEquityLayout still places entities disconnected from the subject", () => {
  const a = createEntity({ id: "a", name: "A", isSubject: true });
  const b = createEntity({ id: "b", name: "B" });
  const chart = chartOf([a, b], []); // b 完全沒有持股關係
  const layout = computeEquityLayout(chart);
  assert.equal(layout.nodes.length, 2);
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test("computeEquityLayout：connected 只標記真正跟受查公司連通的節點，跟受查公司無關的獨立分支要標成 false", () => {
  const a = createEntity({ id: "a", name: "A", isSubject: true });
  const b = createEntity({ id: "b", name: "B" }); // a 持有 b，跟受查公司連通
  const c = createEntity({ id: "c", name: "C" });
  const d = createEntity({ id: "d", name: "D" }); // c 持有 d，這條分支跟受查公司完全無關
  const chart = chartOf([a, b, c, d], [
    { id: "h1", holderId: "a", ownedId: "b", percentage: 10 },
    { id: "h2", holderId: "c", ownedId: "d", percentage: 10 },
  ]);
  const layout = computeEquityLayout(chart);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get("a").connected, true);
  assert.equal(byId.get("b").connected, true);
  assert.equal(byId.get("c").connected, false);
  assert.equal(byId.get("d").connected, false);
});

test("computeEquityLayout：沒有受查公司時，所有節點一律視為 connected（沒有基準點可以比較誰不連通）", () => {
  const a = createEntity({ id: "a", name: "A" });
  const b = createEntity({ id: "b", name: "B" });
  const layout = computeEquityLayout(chartOf([a, b], []));
  assert.ok(layout.nodes.every((node) => node.connected === true));
});

test("computeEquityLayout handles an empty chart without throwing", () => {
  const layout = computeEquityLayout(chartOf([], []));
  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(layout.edges, []);
  assert.ok(layout.width > 0 && layout.height > 0);
});

test("computeEquityLayout widens the canvas so a cross edge's curve and label stay inside the viewBox", () => {
  const s = createEntity({ id: "s", name: "S", isSubject: true });
  const b1 = createEntity({ id: "b1", name: "B1" });
  const b2 = createEntity({ id: "b2", name: "B2" });
  const b3 = createEntity({ id: "b3", name: "B3" });
  const chart = chartOf([s, b1, b2, b3], [
    { id: "h1", holderId: "s", ownedId: "b1", percentage: 10 },
    { id: "h2", holderId: "s", ownedId: "b2", percentage: 10 },
    { id: "h3", holderId: "s", ownedId: "b3", percentage: 10 }, // b3 排在該層最右邊
    { id: "h4", holderId: "b3", ownedId: "s", percentage: 5 }, // 交叉持股，弧線與標籤都會往 b3 右側延伸
  ]);
  const layout = computeEquityLayout(chart);
  const crossEdge = layout.edges.find((edge) => edge.kind === "cross");
  assert.ok(crossEdge);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const from = byId.get(crossEdge.fromId);
  const to = byId.get(crossEdge.toId);
  const rightmostNodeEdge = Math.max(from.x, to.x) + EQUITY_BOX_WIDTH;
  const bulge = Math.max(60, Math.abs(to.y - from.y) / 2); // 跟 equity-chart-svg.tsx 的 crossPath 同一個公式
  assert.ok(layout.width >= rightmostNodeEdge + bulge, "畫布要能完整容納交叉持股弧線");
  assert.ok(layout.width >= rightmostNodeEdge + 130, "畫布要能完整容納「交叉持股 xx%」標籤");
});

test("parseQuickPaste creates entities and holdings from 股東 > 公司 百分比 lines", () => {
  const { chart, warnings } = parseQuickPaste("王大明 > 宏昌實業 45\n林美惠 > 宏昌實業 35", "股權");
  assert.equal(warnings.length, 0);
  assert.equal(chart.entities.length, 3);
  assert.equal(chart.holdings.length, 2);
  const subject = chart.entities.find((e) => e.isSubject);
  assert.equal(subject.name, "宏昌實業");
});

test("parseQuickPaste honors an explicit *subject marker", () => {
  const { chart } = parseQuickPaste("王大明 > 甲公司 60\n*甲公司 > 乙公司 30", "股權");
  const subject = chart.entities.find((e) => e.isSubject);
  assert.equal(subject.name, "甲公司");
});

test("parseQuickPaste guesses offshore and person kinds from the name", () => {
  const { chart } = parseQuickPaste("遠見控股(BVI) > 甲股份有限公司 20\n王小明 > 甲股份有限公司 80", "股權");
  const holdco = chart.entities.find((e) => e.name.includes("BVI"));
  const person = chart.entities.find((e) => e.name === "王小明");
  const company = chart.entities.find((e) => e.name === "甲股份有限公司");
  assert.equal(holdco.kind, "offshore");
  assert.equal(person.kind, "person");
  assert.equal(company.kind, "domestic");
});

test("parseQuickPaste reports unparsable lines instead of silently dropping them", () => {
  const { warnings } = parseQuickPaste("這不是有效格式", "股權");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /看不懂這一行/);
});

test("parseQuickPaste rejects a self-holding line instead of creating a fake loop", () => {
  const { chart, warnings } = parseQuickPaste("甲公司 > 甲公司 100", "股權");
  assert.equal(chart.holdings.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /股東與被投資公司相同/);
});
