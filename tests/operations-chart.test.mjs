import assert from "node:assert/strict";
import test from "node:test";
import {
  PARTY_BOX_HEIGHT,
  chartWarnings,
  computeOperationsLayout,
  createParty,
  createSampleChart,
  normalizeChart,
} from "../lib/operations-chart.ts";

function chartOf(parties, overrides = {}) {
  return { version: 1, title: "測試", subjectName: "受查公司", businessModel: "", parties, ...overrides };
}

test("sample chart normalizes cleanly with no repairs", () => {
  const sample = createSampleChart();
  const result = normalizeChart(sample);
  assert.ok(result);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.chart.parties.length, 6);
});

test("normalizeChart drops duplicate ids and clamps percentage range", () => {
  const a = createParty({ id: "a", name: "A", percentage: 150 });
  const b = createParty({ id: "a", name: "重複", percentage: -10 });
  const result = normalizeChart(chartOf([a, b]));
  assert.equal(result.chart.parties.length, 1);
  assert.equal(result.chart.parties[0].percentage, 100);
  assert.match(result.repairs.join(""), /重複的對象 id/);
});

test("normalizeChart defaults an invalid side to upstream and an invalid term to net30", () => {
  const raw = chartOf([{ id: "a", name: "A", side: "sideways", percentage: 10, term: "bitcoin" }]);
  const result = normalizeChart(raw);
  assert.equal(result.chart.parties[0].side, "upstream");
  assert.equal(result.chart.parties[0].term, "net30");
});

test("normalizeChart returns null for malformed input", () => {
  assert.equal(normalizeChart(null), null);
  assert.equal(normalizeChart({ title: "x" }), null);
});

test("chartWarnings flags each side's total independently", () => {
  const parties = [
    createParty({ side: "upstream", percentage: 60 }),
    createParty({ side: "upstream", percentage: 60 }), // 上游 120%，超過
    createParty({ side: "downstream", percentage: 40 }), // 下游 40%，未滿
  ];
  const warnings = chartWarnings(chartOf(parties));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((w) => w.side === "upstream" && /超過 100%/.test(w.message)));
  assert.ok(warnings.some((w) => w.side === "downstream" && /未滿 100%/.test(w.message)));
});

test("chartWarnings stays silent when a side has no parties at all", () => {
  const warnings = chartWarnings(chartOf([createParty({ side: "upstream", percentage: 100 })]));
  assert.equal(warnings.length, 0); // downstream 完全沒有對象，不該被當成「0% 未滿」報警
});

test("chartWarnings still flags a side that has parties but they're all still at 0%", () => {
  const parties = [
    createParty({ side: "upstream", percentage: 100 }),
    createParty({ side: "downstream", percentage: 0 }), // 已新增對象，只是還沒填佔比
  ];
  const warnings = chartWarnings(chartOf(parties));
  assert.ok(warnings.some((w) => w.side === "downstream" && /未滿 100%/.test(w.message)));
});

test("chartWarnings is silent when totals are exactly 100%", () => {
  const parties = [createParty({ side: "upstream", percentage: 60 }), createParty({ side: "upstream", percentage: 40 })];
  assert.equal(chartWarnings(chartOf(parties)).length, 0);
});

test("computeOperationsLayout puts upstream on the left and downstream on the right of the subject", () => {
  const chart = createSampleChart();
  const layout = computeOperationsLayout(chart);
  for (const item of layout.upstream) assert.ok(item.x + item.width < layout.subject.x, "上游應在受查公司左邊");
  for (const item of layout.downstream) assert.ok(item.x > layout.subject.x + layout.subject.width, "下游應在受查公司右邊");
});

test("computeOperationsLayout orders each column by descending percentage", () => {
  const chart = createSampleChart();
  const layout = computeOperationsLayout(chart);
  const upstreamPercents = layout.upstream.map((item) => item.party.percentage);
  const downstreamPercents = layout.downstream.map((item) => item.party.percentage);
  assert.deepEqual(upstreamPercents, [...upstreamPercents].sort((a, b) => b - a));
  assert.deepEqual(downstreamPercents, [...downstreamPercents].sort((a, b) => b - a));
});

test("computeOperationsLayout does not overlap rows within the same column", () => {
  const chart = createSampleChart();
  const layout = computeOperationsLayout(chart);
  for (const column of [layout.upstream, layout.downstream]) {
    const sorted = [...column].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(sorted[i].y >= sorted[i - 1].y + PARTY_BOX_HEIGHT, "同欄對象不應重疊");
    }
  }
});

test("computeOperationsLayout handles an empty chart without throwing", () => {
  const layout = computeOperationsLayout(chartOf([]));
  assert.deepEqual(layout.upstream, []);
  assert.deepEqual(layout.downstream, []);
  assert.ok(layout.width > 0 && layout.height > 0);
});

test("computeOperationsLayout handles a lopsided chart (only upstream parties)", () => {
  const chart = chartOf([createParty({ side: "upstream", percentage: 100 })]);
  const layout = computeOperationsLayout(chart);
  assert.equal(layout.upstream.length, 1);
  assert.equal(layout.downstream.length, 0);
});
