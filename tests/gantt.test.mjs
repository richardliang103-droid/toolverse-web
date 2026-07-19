import assert from "node:assert/strict";
import test from "node:test";
import { addDays, collectDependents, createSampleProject, criticalPathIds, diffDays, fromCsv, isValidIsoDate, isWeekend, dayNumber, normalizeProject, toCsv, toMermaid, weekdayOfDay, wouldCreateCycle } from "../lib/gantt.ts";

test("date math crosses months, years and leap days without timezone drift", () => {
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-15", -20), "2026-02-23");
  assert.equal(diffDays("2026-07-06", "2026-08-07"), 32);
  assert.equal(diffDays("2026-08-07", "2026-07-06"), -32);
});

test("weekday helpers agree with the calendar", () => {
  assert.equal(weekdayOfDay(dayNumber("2026-07-16")), 4); // 星期四
  assert.equal(weekdayOfDay(dayNumber("2026-07-19")), 0); // 星期日
  assert.equal(isWeekend(dayNumber("2026-07-18")), true);
  assert.equal(isWeekend(dayNumber("2026-07-20")), false);
});

test("date validation rejects malformed and impossible dates", () => {
  assert.equal(isValidIsoDate("2026-07-16"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("16/07/2026"), false);
  assert.equal(isValidIsoDate(20260716), false);
});

test("cycle detection blocks direct, transitive and self dependencies", () => {
  const tasks = [
    { id: "a", name: "a", start: "2026-07-01", durationDays: 1, progress: 0, color: "hanada", dependsOn: [] },
    { id: "b", name: "b", start: "2026-07-02", durationDays: 1, progress: 0, color: "hanada", dependsOn: ["a"] },
    { id: "c", name: "c", start: "2026-07-03", durationDays: 1, progress: 0, color: "hanada", dependsOn: ["b"] },
  ];
  assert.equal(wouldCreateCycle(tasks, "a", "a"), true);
  assert.equal(wouldCreateCycle(tasks, "a", "c"), true);
  assert.equal(wouldCreateCycle(tasks, "b", "c"), true);
  assert.equal(wouldCreateCycle(tasks, "c", "a"), false);
});

test("normalizeProject repairs broken input and keeps valid data", () => {
  const normalized = normalizeProject({
    title: "  測試專案  ",
    view: "flying-car",
    groups: [{ id: "g1", name: "設計" }, { id: "g1", name: "重複" }, { bad: true }],
    tasks: [
      { id: "t1", name: "任務一", start: "2026-07-01", durationDays: 3, progress: 250, color: "neon", groupId: "g1", dependsOn: ["missing", "t1"] },
      { id: "t1", name: "重複 id", start: "2026-07-02", durationDays: 1, progress: 0, dependsOn: [] },
      { id: "t2", name: "壞日期", start: "2026-02-30", durationDays: 1, progress: 0, dependsOn: [] },
      { id: "t3", name: "里程碑", start: "2026-07-09", durationDays: 9, progress: 40, milestone: true, dependsOn: ["t1"] },
    ],
  });
  assert.ok(normalized);
  const { project, repairs } = normalized;
  assert.equal(project.title, "測試專案");
  assert.equal(project.view, "day");
  assert.equal(project.groups.length, 1);
  assert.equal(project.tasks.length, 2);
  const [first, milestone] = project.tasks;
  assert.equal(first.progress, 100);
  assert.equal(first.color, "hanada");
  assert.deepEqual(first.dependsOn, []);
  assert.equal(milestone.durationDays, 0);
  assert.deepEqual(milestone.dependsOn, ["t1"]);
  assert.ok(repairs.length >= 2);
  assert.equal(normalizeProject({ nope: true }), null);
  assert.equal(normalizeProject("gantt"), null);
});

test("normalizeProject drops dependency edges that already form a cycle", () => {
  const normalized = normalizeProject({
    title: "環",
    tasks: [
      { id: "a", name: "a", start: "2026-07-01", durationDays: 1, progress: 0, dependsOn: ["b"] },
      { id: "b", name: "b", start: "2026-07-02", durationDays: 1, progress: 0, dependsOn: ["a"] },
    ],
  });
  assert.ok(normalized);
  const edges = normalized.project.tasks.flatMap((task) => task.dependsOn.map((id) => `${id}->${task.id}`));
  assert.ok(edges.length < 2, `迴圈邊沒有被拆掉：${edges.join(", ")}`);
});

test("csv export quotes tricky fields and lists dependencies by name", () => {
  const project = createSampleProject("2026-07-16");
  project.tasks[0].name = '含,逗號"引號';
  const csv = toCsv(project);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"含,逗號""引號"/);
  assert.match(csv, /里程碑/);
  assert.match(csv, /QA 測試/);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 1 + project.tasks.length);
});

test("mermaid export produces sections, milestones and done tags", () => {
  const project = createSampleProject("2026-07-16");
  const mermaid = toMermaid(project);
  assert.match(mermaid, /^gantt\n/);
  assert.match(mermaid, /dateFormat YYYY-MM-DD/);
  assert.match(mermaid, /section 設計/);
  assert.match(mermaid, /:milestone, m-design, /);
  assert.match(mermaid, /:done, t-research, /);
  assert.match(mermaid, /t-pages, .*7d/);
});

test("sample project passes its own validation with no repairs", () => {
  const project = createSampleProject("2026-07-16");
  const normalized = normalizeProject(project);
  assert.ok(normalized);
  assert.deepEqual(normalized.repairs, []);
  assert.deepEqual(normalized.project, project);
});

test("collectDependents finds transitive successors only", () => {
  const project = createSampleProject("2026-07-16");
  const dependents = collectDependents(project.tasks, "t-wireframe");
  assert.ok(dependents.has("t-visual") && dependents.has("m-design") && dependents.has("t-pages") && dependents.has("m-launch"));
  assert.ok(!dependents.has("t-research") && !dependents.has("t-ia") && !dependents.has("t-wireframe"));
});

test("criticalPathIds walks back from the latest finish", () => {
  const project = createSampleProject("2026-07-16");
  const path = criticalPathIds(project.tasks);
  assert.ok(path.has("m-launch") && path.has("t-qa"));
  assert.ok(path.has("t-research")); // 鏈條一路回到起點
  assert.ok(!path.has("t-pages")); // 非決定完工日的支線（t-api 結束較晚，才是關鍵前置）
  assert.equal(criticalPathIds([]).size, 0);
});

test("CSV 匯出後可用 fromCsv 還原（雙向互通）", () => {
  const { project } = normalizeProject(createSampleProject());
  const restored = fromCsv(toCsv(project), "還原測試");
  assert.ok(restored, "fromCsv 應能解析自家匯出的 CSV");
  assert.equal(restored.project.tasks.length, project.tasks.length);
  assert.equal(restored.project.groups.length, project.groups.length);
  const byName = new Map(restored.project.tasks.map((task) => [task.name, task]));
  for (const original of project.tasks) {
    const match = byName.get(original.name);
    assert.ok(match, `缺少任務 ${original.name}`);
    assert.equal(match.start, original.start);
    assert.equal(match.durationDays, original.durationDays);
    assert.equal(Boolean(match.milestone), Boolean(original.milestone));
    assert.equal(match.dependsOn.length, original.dependsOn.length, `${original.name} 依賴數不符`);
  }
});

test("fromCsv：欄內逗號與引號、無效輸入", () => {
  const { project } = normalizeProject(createSampleProject());
  const renamed = { ...project, tasks: project.tasks.map((task, index) => (index === 0 ? { ...task, name: '設計, "初稿"' } : task)) };
  const restored = fromCsv(toCsv(renamed), "quoted");
  assert.ok(restored.project.tasks.some((task) => task.name === '設計, "初稿"'));
  assert.equal(fromCsv("亂七八糟", "x"), null);
  assert.equal(fromCsv("a,b,c\n1,2,3", "x"), null);
});
