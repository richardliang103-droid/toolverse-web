"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { GANTT_COLORS, GANTT_MILESTONE_COLOR, addDays, dayNumber, isWeekend, projectRangeDays, taskEndDay, weekdayOfDay } from "@/lib/gantt";
import type { GanttProject, GanttTask, GanttView } from "@/lib/gantt";

export const GANTT_ROW_HEIGHT = 40;
export const GANTT_HEADER_HEIGHT = 54;
const PX_PER_DAY: Record<GanttView, number> = { day: 38, week: 13, month: 4.6 };

const INK = "#101628";
const PAPER = "#f5f1e8";
const LINE = "#dcd7cb";
const MUTED = "#656a76";
const CORAL = "#ff6d4a";
const WEEKEND = "rgba(16,22,40,.045)";

export type GanttRow = { kind: "group"; id: string; name: string } | { kind: "task"; task: GanttTask };

export function buildRows(project: GanttProject): GanttRow[] {
  const rows: GanttRow[] = project.tasks.filter((task) => !task.groupId).map((task) => ({ kind: "task", task }));
  for (const group of project.groups) {
    rows.push({ kind: "group", id: group.id, name: group.name });
    for (const task of project.tasks) if (task.groupId === group.id) rows.push({ kind: "task", task });
  }
  return rows;
}

type DragState =
  | { kind: "move" | "resize"; taskId: string; startX: number; originStart: string; originDuration: number; moved: boolean }
  | { kind: "link"; taskId: string; x: number; y: number };

export type GanttChartHandle = { scrollToToday: () => void; exportSvg: () => string | null };

type GanttChartProps = {
  project: GanttProject;
  todayIso: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onCommitTask: (id: string, patch: Partial<GanttTask>) => void;
  onAddDependency: (taskId: string, dependencyId: string) => void;
  onDeleteTask: (id: string) => void;
};

export const GanttChart = forwardRef<GanttChartHandle, GanttChartProps>(function GanttChart(
  { project, todayIso, selectedId, onSelect, onOpenEditor, onCommitTask, onAddDependency, onDeleteTask },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{ taskId: string; start: string; durationDays: number } | null>(null);

  const view = project.view;
  const pxPerDay = PX_PER_DAY[view];
  const rows = buildRows(project);

  const tasks = preview
    ? project.tasks.map((task) => (task.id === preview.taskId ? { ...task, start: preview.start, durationDays: task.milestone ? 0 : preview.durationDays } : task))
    : project.tasks;

  const range = projectRangeDays(tasks);
  let startDay = range.startDay - 7;
  startDay -= (weekdayOfDay(startDay) + 6) % 7; // 對齊週一，表頭刻度才整齊
  const endDay = Math.max(range.endDay + 14, dayNumber(todayIso) + 14);
  const totalDays = endDay - startDay;

  const width = Math.ceil(totalDays * pxPerDay);
  const height = GANTT_HEADER_HEIGHT + rows.length * GANTT_ROW_HEIGHT + 6;
  const xOf = (day: number) => (day - startDay) * pxPerDay;

  const rowY = new Map<string, number>();
  rows.forEach((row, index) => { if (row.kind === "task") rowY.set(row.task.id, GANTT_HEADER_HEIGHT + index * GANTT_ROW_HEIGHT); });

  useImperativeHandle(ref, () => ({
    scrollToToday() {
      const container = scrollRef.current;
      if (container) container.scrollLeft = Math.max(0, xOf(dayNumber(todayIso)) - container.clientWidth / 2);
    },
    exportSvg() {
      return svgRef.current ? svgRef.current.outerHTML : null;
    },
  }));

  function daysFromDrag(event: React.PointerEvent, startX: number) {
    return Math.round((event.clientX - startX) / pxPerDay);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const target = (event.target as Element).closest<SVGElement>("[data-drag]");
    if (!target || event.button !== 0) return;
    const taskId = target.dataset.taskId!;
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) return;
    onSelect(taskId);
    event.currentTarget.setPointerCapture(event.pointerId);
    const kind = target.dataset.drag as "move" | "resize" | "link";
    if (kind === "link") {
      const bounds = event.currentTarget.getBoundingClientRect();
      setDrag({ kind: "link", taskId, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    } else {
      setDrag({ kind, taskId, startX: event.clientX, originStart: task.start, originDuration: task.durationDays, moved: false });
    }
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    if (drag.kind === "link") {
      const bounds = event.currentTarget.getBoundingClientRect();
      setDrag({ ...drag, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      return;
    }
    const days = daysFromDrag(event, drag.startX);
    if (days === 0 && !drag.moved) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    setPreview(
      drag.kind === "move"
        ? { taskId: drag.taskId, start: addDays(drag.originStart, days), durationDays: drag.originDuration }
        : { taskId: drag.taskId, start: drag.originStart, durationDays: Math.max(1, drag.originDuration + days) },
    );
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    if (drag.kind === "link") {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const targetId = element?.closest<SVGElement>("[data-task-id]")?.dataset.taskId;
      if (targetId && targetId !== drag.taskId) onAddDependency(targetId, drag.taskId);
    } else if (preview) {
      onCommitTask(drag.taskId, { start: preview.start, durationDays: preview.durationDays });
    }
    setDrag(null);
    setPreview(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGGElement>, task: GanttTask) {
    if (event.key === "Enter") { event.preventDefault(); onOpenEditor(task.id); return; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onDeleteTask(task.id); return; }
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    if (event.shiftKey && !task.milestone) onCommitTask(task.id, { durationDays: Math.max(1, task.durationDays + direction) });
    else onCommitTask(task.id, { start: addDays(task.start, direction) });
  }

  const headerCells: React.ReactNode[] = [];
  const gridLines: React.ReactNode[] = [];
  const monthLabels: React.ReactNode[] = [];

  for (let day = startDay; day <= endDay; day += 1) {
    const x = xOf(day);
    const weekday = weekdayOfDay(day);
    const date = new Date(day * 86_400_000);
    const isUnitStart = view === "day" ? true : view === "week" ? weekday === 1 : date.getUTCDate() === 1;
    if (view === "day" && day < endDay && isWeekend(day)) {
      headerCells.push(<rect key={`we-${day}`} x={x} y={GANTT_HEADER_HEIGHT} width={pxPerDay} height={height - GANTT_HEADER_HEIGHT} fill={WEEKEND} />);
    }
    if (!isUnitStart) continue;
    gridLines.push(<line key={`v-${day}`} x1={x} y1={GANTT_HEADER_HEIGHT} x2={x} y2={height} stroke={LINE} />);
    if (day >= endDay) continue;
    const label = view === "day" ? String(date.getUTCDate()) : view === "week" ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : `${date.getUTCMonth() + 1}月`;
    headerCells.push(
      <text key={`u-${day}`} x={view === "day" ? x + pxPerDay / 2 : x + 5} y={GANTT_HEADER_HEIGHT - 10} textAnchor={view === "day" ? "middle" : "start"} fontSize={10.5} fontWeight={600} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={view === "day" && isWeekend(day) ? CORAL : INK}>
        {label}
      </text>,
    );
  }

  {
    const first = new Date(startDay * 86_400_000);
    let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1, 12);
    while (Math.floor(cursor / 86_400_000) < endDay) {
      const monthStart = new Date(cursor);
      const nextMonth = Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1, 12);
      const spanStart = Math.max(Math.floor(cursor / 86_400_000), startDay);
      const spanEnd = Math.min(Math.floor(nextMonth / 86_400_000), endDay);
      if ((spanEnd - spanStart) * pxPerDay > 64) {
        monthLabels.push(
          <text key={`m-${cursor}`} x={(xOf(spanStart) + xOf(spanEnd)) / 2} y={18} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={MUTED}>
            {view === "month" ? `${monthStart.getUTCFullYear()}年` : `${monthStart.getUTCFullYear()}年${monthStart.getUTCMonth() + 1}月`}
          </text>,
        );
      }
      cursor = nextMonth;
    }
  }

  const dependencyPaths: React.ReactNode[] = [];
  for (const task of tasks) {
    const toY = rowY.get(task.id);
    if (toY === undefined) continue;
    for (const dependencyId of task.dependsOn) {
      const from = tasks.find((item) => item.id === dependencyId);
      const fromY = from ? rowY.get(from.id) : undefined;
      if (!from || fromY === undefined) continue;
      const fromX = from.milestone ? xOf(dayNumber(from.start)) + pxPerDay / 2 + 9 : xOf(taskEndDay(from));
      const toX = (task.milestone ? xOf(dayNumber(task.start)) + pxPerDay / 2 - 9 : xOf(dayNumber(task.start))) - 3;
      const fromMid = fromY + GANTT_ROW_HEIGHT / 2;
      const toMid = toY + GANTT_ROW_HEIGHT / 2;
      const elbow = fromX + 9;
      const path = toX - 6 > elbow
        ? `M${fromX} ${fromMid} H${elbow} V${toMid} H${toX}`
        : `M${fromX} ${fromMid} H${elbow} V${toMid - GANTT_ROW_HEIGHT / 2} H${toX - 9} V${toMid} H${toX}`;
      dependencyPaths.push(<path key={`${dependencyId}-${task.id}`} d={path} fill="none" stroke={MUTED} strokeWidth={1.3} markerEnd="url(#gantt-arrow)" />);
    }
  }

  const todayX = xOf(dayNumber(todayIso)) + pxPerDay / 2;

  return (
    <div className="gantt-canvas" ref={scrollRef}>
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fontFamily='Inter, "Noto Sans TC", sans-serif'
        style={{ touchAction: "pan-x pan-y" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { setDrag(null); setPreview(null); }}
      >
        <defs>
          <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill={MUTED} />
          </marker>
        </defs>
        <rect x={0} y={0} width={width} height={height} fill="#fffdf7" />
        {rows.map((row, index) =>
          row.kind === "group"
            ? <rect key={row.id} x={0} y={GANTT_HEADER_HEIGHT + index * GANTT_ROW_HEIGHT} width={width} height={GANTT_ROW_HEIGHT} fill={PAPER} />
            : null,
        )}
        {headerCells}
        {gridLines}
        {rows.map((row, index) => (
          <line key={`h-${row.kind === "group" ? row.id : row.task.id}`} x1={0} y1={GANTT_HEADER_HEIGHT + (index + 1) * GANTT_ROW_HEIGHT} x2={width} y2={GANTT_HEADER_HEIGHT + (index + 1) * GANTT_ROW_HEIGHT} stroke={LINE} />
        ))}
        <line x1={0} y1={GANTT_HEADER_HEIGHT} x2={width} y2={GANTT_HEADER_HEIGHT} stroke={INK} />
        {monthLabels}
        {dependencyPaths}
        {tasks.map((task) => {
          const y = rowY.get(task.id);
          if (y === undefined) return null;
          const selected = task.id === selectedId;
          if (task.milestone) {
            const cx = xOf(dayNumber(task.start)) + pxPerDay / 2;
            const cy = y + GANTT_ROW_HEIGHT / 2;
            return (
              <g key={task.id} tabIndex={0} role="button" aria-label={`里程碑 ${task.name}，${task.start}`} data-task-id={task.id} style={{ outline: "none" }} onKeyDown={(event) => handleKeyDown(event, task)} onDoubleClick={() => onOpenEditor(task.id)}>
                <rect data-drag="move" data-task-id={task.id} x={cx - 9} y={cy - 9} width={18} height={18} rx={3} transform={`rotate(45 ${cx} ${cy})`} fill={GANTT_MILESTONE_COLOR.soft} stroke={selected ? GANTT_MILESTONE_COLOR.strong : INK} strokeWidth={selected ? 2.4 : 1.25} style={{ cursor: "grab" }} />
                <circle data-drag="link" data-task-id={task.id} cx={cx + 15} cy={cy} r={5} fill={selected ? GANTT_MILESTONE_COLOR.strong : "transparent"} stroke={selected ? INK : "transparent"} style={{ cursor: "crosshair" }} />
                <text x={cx + 24} y={cy + 4} fontSize={11} fontWeight={700} fill={INK} pointerEvents="none">{task.name}</text>
              </g>
            );
          }
          const colors = GANTT_COLORS[task.color];
          const x = xOf(dayNumber(task.start));
          const barWidth = Math.max(task.durationDays * pxPerDay, 6);
          const barY = y + 8;
          const barHeight = GANTT_ROW_HEIGHT - 16;
          const labelInside = barWidth > task.name.length * 12 + 26;
          return (
            <g key={task.id} tabIndex={0} role="button" aria-label={`任務 ${task.name}，${task.start} 起 ${task.durationDays} 天，進度 ${task.progress}%`} data-task-id={task.id} style={{ outline: "none" }} onKeyDown={(event) => handleKeyDown(event, task)} onDoubleClick={() => onOpenEditor(task.id)}>
              <clipPath id={`gantt-clip-${task.id}`}><rect x={x} y={barY} width={barWidth} height={barHeight} rx={7} /></clipPath>
              <rect data-drag="move" data-task-id={task.id} x={x} y={barY} width={barWidth} height={barHeight} rx={7} fill={colors.soft} stroke={selected ? colors.strong : INK} strokeWidth={selected ? 2.4 : 1.25} style={{ cursor: "grab" }} />
              {task.progress > 0 && (
                <rect x={x} y={barY} width={(barWidth * task.progress) / 100} height={barHeight} rx={7} clipPath={`url(#gantt-clip-${task.id})`} fill={colors.strong} pointerEvents="none" />
              )}
              <text x={labelInside ? x + 10 : x + barWidth + 9} y={barY + barHeight / 2 + 4} fontSize={11} fontWeight={600} fill={INK} pointerEvents="none">{task.name}</text>
              <rect data-drag="resize" data-task-id={task.id} x={x + barWidth - 6} y={barY} width={12} height={barHeight} fill="transparent" style={{ cursor: "ew-resize" }} />
              <circle data-drag="link" data-task-id={task.id} cx={x + barWidth + (labelInside ? 8 : task.name.length * 12 + 18)} cy={barY + barHeight / 2} r={5} fill={selected ? colors.strong : "transparent"} stroke={selected ? INK : "transparent"} style={{ cursor: "crosshair" }} />
            </g>
          );
        })}
        {drag?.kind === "link" && (() => {
          const from = tasks.find((item) => item.id === drag.taskId);
          const fromY = from ? rowY.get(from.id) : undefined;
          if (!from || fromY === undefined) return null;
          const fromX = from.milestone ? xOf(dayNumber(from.start)) + pxPerDay / 2 + 15 : xOf(taskEndDay(from));
          return <line x1={fromX} y1={fromY + GANTT_ROW_HEIGHT / 2} x2={drag.x} y2={drag.y} stroke={MUTED} strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />;
        })()}
        <line x1={todayX} y1={GANTT_HEADER_HEIGHT - 4} x2={todayX} y2={height} stroke={CORAL} strokeWidth={2} />
        <rect x={todayX - 19} y={GANTT_HEADER_HEIGHT - 26} width={38} height={17} rx={8.5} fill={CORAL} pointerEvents="none" />
        <text x={todayX} y={GANTT_HEADER_HEIGHT - 14} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff" pointerEvents="none">今天</text>
      </svg>
    </div>
  );
});
