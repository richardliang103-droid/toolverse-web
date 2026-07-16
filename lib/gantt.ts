export type GanttColor = "hanada" | "toki" | "matsuba";
export type GanttView = "day" | "week" | "month";

export type GanttTask = {
  id: string;
  name: string;
  start: string;
  durationDays: number;
  progress: number;
  color: GanttColor;
  assignee?: string;
  groupId?: string;
  milestone?: boolean;
  dependsOn: string[];
};

export type GanttGroup = { id: string; name: string };

export type GanttProject = {
  version: 1;
  title: string;
  view: GanttView;
  groups: GanttGroup[];
  tasks: GanttTask[];
};

// 和色任務色票：縹・鴇・松葉；藤保留給里程碑。
export const GANTT_COLORS: Record<GanttColor, { name: string; soft: string; strong: string }> = {
  hanada: { name: "縹", soft: "#e4ecf3", strong: "#5f83a8" },
  toki: { name: "鴇", soft: "#f9e9ec", strong: "#cf7f8d" },
  matsuba: { name: "松葉", soft: "#ebf1e2", strong: "#7d9a63" },
};
export const GANTT_MILESTONE_COLOR = { soft: "#ece7f5", strong: "#9b8bbf" };

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// 日期一律以 "YYYY-MM-DD" 字串儲存、以 UTC 正午運算，避免時區與日光節約造成位移。
export function dayNumber(iso: string) {
  return Math.floor(Date.parse(`${iso}T12:00:00Z`) / DAY_MS);
}

export function isoFromDay(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  return isoFromDay(dayNumber(iso) + days);
}

export function diffDays(from: string, to: string) {
  return dayNumber(to) - dayNumber(from);
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && isoFromDay(Math.floor(time / DAY_MS)) === value;
}

/** 0 = Sunday … 6 = Saturday（1970-01-01 是星期四）。 */
export function weekdayOfDay(day: number) {
  return (((day + 4) % 7) + 7) % 7;
}

export function isWeekend(day: number) {
  const weekday = weekdayOfDay(day);
  return weekday === 0 || weekday === 6;
}

export function todayIso() {
  const now = new Date();
  return isoFromDay(Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12) / DAY_MS));
}

export function taskEndDay(task: Pick<GanttTask, "start" | "durationDays" | "milestone">) {
  return dayNumber(task.start) + (task.milestone ? 0 : Math.max(task.durationDays, 1));
}

export function projectRangeDays(tasks: GanttTask[]) {
  if (tasks.length === 0) {
    const today = dayNumber(todayIso());
    return { startDay: today - 7, endDay: today + 21 };
  }
  let startDay = Infinity;
  let endDay = -Infinity;
  for (const task of tasks) {
    startDay = Math.min(startDay, dayNumber(task.start));
    endDay = Math.max(endDay, taskEndDay(task));
  }
  return { startDay, endDay };
}

/** task 若（直接或間接）依賴 dependencyId 之外，dependencyId 也依賴 task，就會成環。 */
export function wouldCreateCycle(tasks: GanttTask[], taskId: string, dependencyId: string) {
  if (taskId === dependencyId) return true;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const stack = [dependencyId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === taskId) return true;
    if (seen.has(currentId)) continue;
    seen.add(currentId);
    for (const nextId of byId.get(currentId)?.dependsOn ?? []) stack.push(nextId);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().slice(0, maxLength);
  return text || fallback;
}

/** 驗證並修復來自 localStorage 或匯入 JSON 的資料；完全無法修復時回傳 null。 */
export function normalizeProject(raw: unknown): { project: GanttProject; repairs: string[] } | null {
  if (!isRecord(raw) || !Array.isArray(raw.tasks)) return null;
  const repairs: string[] = [];

  const groups: GanttGroup[] = [];
  const groupIds = new Set<string>();
  for (const item of Array.isArray(raw.groups) ? raw.groups : []) {
    if (!isRecord(item) || typeof item.id !== "string" || groupIds.has(item.id)) continue;
    groupIds.add(item.id);
    groups.push({ id: item.id, name: cleanText(item.name, "未命名群組", 60) });
  }

  const tasks: GanttTask[] = [];
  const taskIds = new Set<string>();
  for (const item of raw.tasks) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id === "") continue;
    if (taskIds.has(item.id)) { repairs.push(`移除重複的任務 id「${item.id}」`); continue; }
    if (!isValidIsoDate(item.start)) { repairs.push(`移除日期無效的任務「${cleanText(item.name, item.id, 60)}」`); continue; }
    taskIds.add(item.id);
    const milestone = item.milestone === true;
    const duration = typeof item.durationDays === "number" && Number.isFinite(item.durationDays) ? Math.round(item.durationDays) : 1;
    const progress = typeof item.progress === "number" && Number.isFinite(item.progress) ? Math.round(item.progress) : 0;
    const color = typeof item.color === "string" && item.color in GANTT_COLORS ? (item.color as GanttColor) : "hanada";
    const assignee = typeof item.assignee === "string" && item.assignee.trim() ? item.assignee.trim().slice(0, 40) : undefined;
    const groupId = typeof item.groupId === "string" && groupIds.has(item.groupId) ? item.groupId : undefined;
    tasks.push({
      id: item.id,
      name: cleanText(item.name, "未命名任務", 80),
      start: item.start,
      durationDays: milestone ? 0 : Math.min(Math.max(duration, 1), 3650),
      progress: Math.min(Math.max(progress, 0), 100),
      color,
      ...(assignee ? { assignee } : {}),
      ...(groupId ? { groupId } : {}),
      ...(milestone ? { milestone: true } : {}),
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.filter((id): id is string => typeof id === "string") : [],
    });
  }

  for (const task of tasks) {
    const valid = task.dependsOn.filter((id) => taskIds.has(id) && id !== task.id && !wouldCreateCycle(tasks.map((t) => (t === task ? { ...t, dependsOn: [] } : t)), task.id, id));
    if (valid.length !== task.dependsOn.length) repairs.push(`整理「${task.name}」的無效前置任務`);
    task.dependsOn = valid;
  }

  return {
    project: {
      version: 1,
      title: cleanText(raw.title, "未命名專案", 80),
      view: raw.view === "week" || raw.view === "month" ? raw.view : "day",
      groups,
      tasks,
    },
    repairs,
  };
}

function csvField(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(project: GanttProject) {
  const groupName = new Map(project.groups.map((group) => [group.id, group.name]));
  const nameById = new Map(project.tasks.map((task) => [task.id, task.name]));
  const rows = [["群組", "任務", "類型", "開始", "結束", "工期(天)", "進度(%)", "負責人", "前置任務"]];
  for (const task of project.tasks) {
    rows.push([
      task.groupId ? groupName.get(task.groupId) ?? "" : "",
      task.name,
      task.milestone ? "里程碑" : "任務",
      task.start,
      task.milestone ? task.start : addDays(task.start, Math.max(task.durationDays, 1) - 1),
      task.milestone ? "0" : String(task.durationDays),
      task.milestone ? "" : String(task.progress),
      task.assignee ?? "",
      task.dependsOn.map((id) => nameById.get(id) ?? id).join("；"),
    ]);
  }
  // 前置 BOM 讓 Excel 以 UTF-8 開啟中文欄位。
  return `\uFEFF${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}`;
}

function mermaidText(value: string) {
  return value.replaceAll(/[:;#\n]/g, " ").trim() || "未命名";
}

export function toMermaid(project: GanttProject) {
  const lines = ["gantt", `  title ${mermaidText(project.title)}`, "  dateFormat YYYY-MM-DD"];
  const sections: Array<{ name: string | null; tasks: GanttTask[] }> = [
    { name: null, tasks: project.tasks.filter((task) => !task.groupId) },
    ...project.groups.map((group) => ({ name: group.name, tasks: project.tasks.filter((task) => task.groupId === group.id) })),
  ];
  for (const section of sections) {
    if (section.tasks.length === 0) continue;
    if (section.name !== null) lines.push(`  section ${mermaidText(section.name)}`);
    for (const task of section.tasks) {
      const tags = task.milestone ? "milestone, " : task.progress >= 100 ? "done, " : "";
      const duration = task.milestone ? "0d" : `${Math.max(task.durationDays, 1)}d`;
      lines.push(`  ${mermaidText(task.name)} :${tags}${task.id}, ${task.start}, ${duration}`);
    }
  }
  return lines.join("\n");
}

export function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export function createSampleProject(today = todayIso()): GanttProject {
  const anchor = addDays(today, -10);
  const at = (offset: number) => addDays(anchor, offset);
  return {
    version: 1,
    title: "產品上線計畫",
    view: "day",
    groups: [
      { id: "g-plan", name: "規劃" },
      { id: "g-design", name: "設計" },
      { id: "g-build", name: "開發" },
      { id: "g-launch", name: "上線" },
    ],
    tasks: [
      { id: "t-research", name: "需求盤點", start: at(0), durationDays: 3, progress: 100, color: "hanada", groupId: "g-plan", dependsOn: [] },
      { id: "t-ia", name: "資訊架構", start: at(3), durationDays: 3, progress: 100, color: "hanada", groupId: "g-plan", dependsOn: ["t-research"] },
      { id: "t-wireframe", name: "線稿 Wireframe", start: at(7), durationDays: 4, progress: 80, color: "matsuba", groupId: "g-design", dependsOn: ["t-ia"] },
      { id: "t-visual", name: "視覺設計", start: at(10), durationDays: 5, progress: 45, color: "matsuba", groupId: "g-design", dependsOn: ["t-wireframe"] },
      { id: "m-design", name: "設計評審", start: at(17), durationDays: 0, progress: 0, color: "matsuba", groupId: "g-design", milestone: true, dependsOn: ["t-visual"] },
      { id: "t-components", name: "元件庫", start: at(11), durationDays: 6, progress: 30, color: "toki", groupId: "g-build", dependsOn: ["t-wireframe"] },
      { id: "t-pages", name: "頁面實作", start: at(18), durationDays: 7, progress: 0, color: "toki", groupId: "g-build", dependsOn: ["m-design", "t-components"] },
      { id: "t-api", name: "API 整合", start: at(22), durationDays: 4, progress: 0, color: "toki", groupId: "g-build", dependsOn: ["t-components"] },
      { id: "t-qa", name: "QA 測試", start: at(28), durationDays: 4, progress: 0, color: "hanada", groupId: "g-launch", dependsOn: ["t-pages", "t-api"] },
      { id: "m-launch", name: "正式上線", start: at(32), durationDays: 0, progress: 0, color: "hanada", groupId: "g-launch", milestone: true, dependsOn: ["t-qa"] },
    ],
  };
}
