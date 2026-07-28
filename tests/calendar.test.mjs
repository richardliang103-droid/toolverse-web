import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthGrid, shiftMonth } from "../lib/calendar/month-grid.ts";
import { HOLIDAYS_TW, holidayFor } from "../lib/calendar/holidays-tw.ts";

test("buildMonthGrid：固定 42 格，週日開頭、週六結尾", () => {
  const days = buildMonthGrid(2026, 2, new Date(2026, 1, 15));
  assert.equal(days.length, 42);
  assert.equal(days[0].weekday, 0);
  assert.equal(days[41].weekday, 6);
});

test("buildMonthGrid：本月天數與 1..N 的日期序列正確（平年 2 月 28 天）", () => {
  const days = buildMonthGrid(2026, 2, new Date(2026, 1, 1));
  const inMonth = days.filter((day) => day.inCurrentMonth);
  assert.equal(inMonth.length, 28);
  assert.deepEqual(inMonth.map((day) => day.day), Array.from({ length: 28 }, (_, i) => i + 1));
  assert.ok(inMonth.every((day) => day.month === 2 && day.year === 2026));
});

test("buildMonthGrid：閏年 2 月是 29 天", () => {
  const inMonth = buildMonthGrid(2028, 2, new Date(2028, 1, 1)).filter((day) => day.inCurrentMonth);
  assert.equal(inMonth.length, 29);
});

test("buildMonthGrid：框外的開頭日期是前一個月的尾巴，且與 1 號連續銜接", () => {
  // 不假設 7/1 是星期幾（那是要靠算的事實，不是該記住的事實）：
  // 不管框前有幾天，這些日期串起來、加上月初的 1 號，一定是逐日連續遞增。
  const days = buildMonthGrid(2026, 7, new Date(2026, 6, 1));
  const leading = days.slice(0, 7).filter((day) => !day.inCurrentMonth);
  const firstOfMonth = days.find((day) => day.inCurrentMonth);
  const sequence = [...leading, firstOfMonth];
  for (let i = 1; i < sequence.length; i += 1) {
    const previous = new Date(sequence[i - 1].year, sequence[i - 1].month - 1, sequence[i - 1].day);
    const current = new Date(sequence[i].year, sequence[i].month - 1, sequence[i].day);
    assert.equal(current.getTime() - previous.getTime(), 86_400_000, `${sequence[i - 1].date} 到 ${sequence[i].date} 不是連續一天`);
  }
  for (const day of leading) assert.notEqual(day.month, 7, `框外開頭不該屬於 7 月本身：${day.date}`);

  // 1 月往前跨年：框前如果有日期，一定屬於前一年的 12 月，不是本年 0 月或其他錯誤值。
  const januaryLeading = buildMonthGrid(2026, 1, new Date(2026, 0, 1)).slice(0, 7).filter((day) => !day.inCurrentMonth);
  for (const day of januaryLeading) { assert.equal(day.month, 12); assert.equal(day.year, 2025); }
});

test("buildMonthGrid：isToday 只標到指定的今天那一格", () => {
  const days = buildMonthGrid(2026, 7, new Date(2026, 6, 28));
  const marked = days.filter((day) => day.isToday);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].date, "2026-07-28");

  // 今天不在目前檢視的月份時，整份格線都不該有 isToday。
  const otherMonth = buildMonthGrid(2026, 1, new Date(2026, 6, 28));
  assert.equal(otherMonth.filter((day) => day.isToday).length, 0);
});

test("buildMonthGrid：isWeekend 精確對應週日／週六", () => {
  const days = buildMonthGrid(2026, 7, new Date(2026, 6, 1));
  for (const day of days) assert.equal(day.isWeekend, day.weekday === 0 || day.weekday === 6);
});

test("shiftMonth：加減月份正確跨年", () => {
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 7, 1), { year: 2026, month: 8 });
  assert.deepEqual(shiftMonth(2026, 7, -7), { year: 2025, month: 12 });
});

test("holidayFor：查得到官方公告的國定假日（含農曆節日與補假），查不到就回 null 不硬猜", () => {
  assert.deepEqual(holidayFor("2026-01-01"), { date: "2026-01-01", name: "開國紀念日" });
  assert.deepEqual(holidayFor("2026-02-17"), { date: "2026-02-17", name: "春節" }); // 農曆節日，官方換算好的西元日期
  assert.deepEqual(holidayFor("2026-02-20"), { date: "2026-02-20", name: "補假" });
  assert.deepEqual(holidayFor("2027-02-06"), { date: "2027-02-06", name: "春節" });
  assert.equal(holidayFor("2026-06-16"), null); // 涵蓋範圍內、但本來就不是假日的普通一天
  assert.equal(holidayFor("2025-01-01"), null); // 涵蓋範圍（2026～2027）以外的年份，刻意不硬猜
  assert.equal(holidayFor("2028-01-01"), null);
});

test("HOLIDAYS_TW：每筆資料格式都合法、日期不重複、且是真實存在的日期", () => {
  const seen = new Set();
  for (const holiday of HOLIDAYS_TW) {
    assert.match(holiday.date, /^\d{4}-\d{2}-\d{2}$/, `${holiday.name} 的 date 格式不對`);
    assert.ok(holiday.name.length > 0, "假日名稱不可為空");
    assert.ok(!seen.has(holiday.date), `${holiday.date} 重複出現`);
    seen.add(holiday.date);

    const [year, month, day] = holiday.date.split("-").map(Number);
    const probe = new Date(year, month - 1, day);
    assert.equal(probe.getFullYear(), year, `${holiday.date} 不是合法日期`);
    assert.equal(probe.getMonth() + 1, month, `${holiday.date} 不是合法日期`);
    assert.equal(probe.getDate(), day, `${holiday.date} 不是合法日期`);
  }
});
