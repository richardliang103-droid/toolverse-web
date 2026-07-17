"use client";

import { useEffect, useRef, useState } from "react";
import { GANTT_COLORS, createSampleProject, isValidIsoDate, newId, normalizeProject, toCsv, toMermaid, todayIso, wouldCreateCycle } from "@/lib/gantt";
import type { GanttColor, GanttProject, GanttTask, GanttView } from "@/lib/gantt";
import { GanttChart, buildRows } from "./gantt-chart";
import type { GanttChartHandle } from "./gantt-chart";

const STORAGE_KEY = "toolverse:gantt:v1";
const VIEW_LABELS: Record<GanttView, string> = { day: "日", week: "週", month: "月" };

function safeFilename(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "toolverse-gantt";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatShortDate(iso: string) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

export function GanttTool() {
  const [project, setProject] = useState<GanttProject | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const [copied, setCopied] = useState(false);
  const [today] = useState(() => todayIso());

  const chartRef = useRef<GanttChartHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<GanttProject[]>([]);
  const redoRef = useRef<GanttProject[]>([]);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let restored: GanttProject | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) restored = normalizeProject(JSON.parse(saved))?.project ?? null;
    } catch { localStorage.removeItem(STORAGE_KEY); }
    // 還原此裝置的專案需要一次性的 client hydration。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProject(restored ?? createSampleProject());
  }, []);

  useEffect(() => {
    if (project) localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  const view = project?.view;
  useEffect(() => {
    if (view) chartRef.current?.scrollToToday();
  }, [view]);

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  function showNotice(message: string, tone: "info" | "error" = "info") {
    setNotice({ message, tone });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3200);
  }

  function syncHistoryDepth() {
    setHistoryDepth({ undo: undoRef.current.length, redo: redoRef.current.length });
  }

  function pushSnapshot(snapshot: GanttProject) {
    undoRef.current = [...undoRef.current.slice(-49), snapshot];
    redoRef.current = [];
    syncHistoryDepth();
  }

  // 快照操作放在 setProject 的 updater 外：updater 必須是純函式
  //（StrictMode 會重跑 updater，副作用會讓快照被推兩次）。
  function commit(updater: (previous: GanttProject) => GanttProject) {
    if (!project) return;
    pushSnapshot(project);
    setProject(updater(project));
  }

  /** 編輯抽屜內的連續輸入不逐字進 undo 堆疊；開抽屜時已存過快照。 */
  function updateDirect(updater: (previous: GanttProject) => GanttProject) {
    setProject((previous) => (previous ? updater(previous) : previous));
  }

  function undo() {
    const snapshot = undoRef.current.at(-1);
    if (!project || !snapshot) return;
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, project];
    setProject(snapshot);
    syncHistoryDepth();
  }

  function redo() {
    const snapshot = redoRef.current.at(-1);
    if (!project || !snapshot) return;
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current, project];
    setProject(snapshot);
    syncHistoryDepth();
  }

  const keyboardActionsRef = useRef({ undo, redo });
  useEffect(() => { keyboardActionsRef.current = { undo, redo }; });

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      if (event.shiftKey) keyboardActionsRef.current.redo();
      else keyboardActionsRef.current.undo();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function patchTask(id: string, patch: Partial<GanttTask>, options: { snapshot: boolean } = { snapshot: true }) {
    const apply = (previous: GanttProject) => ({ ...previous, tasks: previous.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)) });
    if (options.snapshot) commit(apply); else updateDirect(apply);
  }

  function openEditor(id: string) {
    if (project) pushSnapshot(project);
    setSelectedId(id);
    setEditorId(id);
  }

  function addTask(milestone: boolean) {
    if (!project) return;
    const id = newId();
    const groupId = project.tasks.find((task) => task.id === selectedId)?.groupId ?? project.groups.at(-1)?.id;
    const colors = Object.keys(GANTT_COLORS) as GanttColor[];
    const task: GanttTask = {
      id,
      name: milestone ? "新里程碑" : "新任務",
      start: today,
      durationDays: milestone ? 0 : 3,
      progress: 0,
      color: colors[project.tasks.length % colors.length],
      groupId,
      milestone: milestone || undefined,
      dependsOn: [],
    };
    commit((previous) => ({ ...previous, tasks: [...previous.tasks, task] }));
    setSelectedId(id);
    setEditorId(id);
  }

  function deleteTask(id: string) {
    commit((previous) => ({
      ...previous,
      tasks: previous.tasks.filter((task) => task.id !== id).map((task) => ({ ...task, dependsOn: task.dependsOn.filter((dependencyId) => dependencyId !== id) })),
    }));
    if (selectedId === id) setSelectedId(null);
    if (editorId === id) setEditorId(null);
  }

  function addGroup() {
    commit((previous) => ({ ...previous, groups: [...previous.groups, { id: newId(), name: `新群組 ${previous.groups.length + 1}` }] }));
  }

  function deleteGroup(id: string) {
    commit((previous) => ({
      ...previous,
      groups: previous.groups.filter((group) => group.id !== id),
      tasks: previous.tasks.map((task) => (task.groupId === id ? { ...task, groupId: undefined } : task)),
    }));
  }

  function addDependency(taskId: string, dependencyId: string) {
    if (!project) return;
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (task.dependsOn.includes(dependencyId)) { showNotice("這條依賴已經存在"); return; }
    if (wouldCreateCycle(project.tasks, taskId, dependencyId)) { showNotice("加入這條依賴會形成循環，已略過", "error"); return; }
    commit((previous) => ({ ...previous, tasks: previous.tasks.map((item) => (item.id === taskId ? { ...item, dependsOn: [...item.dependsOn, dependencyId] } : item)) }));
    showNotice("已建立依賴關係");
  }

  function changeView(nextView: GanttView) {
    updateDirect((previous) => ({ ...previous, view: nextView }));
  }

  function exportSvgMarkup() {
    const markup = chartRef.current?.exportSvg();
    if (!markup) { showNotice("圖表尚未就緒，請再試一次", "error"); return null; }
    return markup;
  }

  function downloadSvg() {
    if (!project) return;
    const markup = exportSvgMarkup();
    if (markup) downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${safeFilename(project.title)}.svg`);
  }

  function downloadPng() {
    if (!project) return;
    const markup = exportSvgMarkup();
    if (!markup) return;
    const size = markup.match(/width="(\d+)" height="(\d+)"/);
    const width = size ? Number(size[1]) : 1200;
    const height = size ? Number(size[2]) : 600;
    const image = new Image();
    const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const scale = Math.min(2, 4200 / width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${safeFilename(project.title)}.png`); }, "image/png");
      URL.revokeObjectURL(source);
    };
    image.onerror = () => { URL.revokeObjectURL(source); showNotice("PNG 產生失敗，請改下載 SVG", "error"); };
    image.src = source;
  }

  function downloadCsv() {
    if (!project) return;
    downloadBlob(new Blob([toCsv(project)], { type: "text/csv;charset=utf-8" }), `${safeFilename(project.title)}.csv`);
  }

  function downloadJson() {
    if (!project) return;
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFilename(project.title)}.json`);
  }

  async function copyMermaid() {
    if (!project) return;
    try {
      await navigator.clipboard.writeText(toMermaid(project));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      showNotice("無法複製到剪貼簿，請展開下方原始碼手動複製", "error");
    }
  }

  async function importJson(file: File) {
    try {
      const normalized = normalizeProject(JSON.parse(await file.text()));
      if (!normalized) { showNotice("這個檔案不是有效的甘特圖 JSON", "error"); return; }
      commit(() => normalized.project);
      setSelectedId(null);
      setEditorId(null);
      showNotice(normalized.repairs.length > 0 ? `已匯入，並自動整理 ${normalized.repairs.length} 個問題` : "已匯入專案");
    } catch {
      showNotice("讀取 JSON 失敗，請確認檔案內容", "error");
    }
  }

  const rows = project ? buildRows(project) : [];
  const editingTask = project?.tasks.find((task) => task.id === editorId) ?? null;
  const groupTaskCount = new Map<string, number>();
  for (const task of project?.tasks ?? []) {
    if (task.groupId) groupTaskCount.set(task.groupId, (groupTaskCount.get(task.groupId) ?? 0) + 1);
  }

  return (
    <section className="gantt-workspace page-shell" aria-label="甘特圖工具">
      <div className="gantt-toolbar">
        <input
          className="gantt-title-input"
          aria-label="專案名稱"
          value={project?.title ?? ""}
          maxLength={80}
          disabled={!project}
          onChange={(event) => updateDirect((previous) => ({ ...previous, title: event.target.value }))}
          onBlur={() => updateDirect((previous) => ({ ...previous, title: previous.title.trim() || "未命名專案" }))}
        />
        <div className="gantt-seg" role="group" aria-label="時間刻度">
          {(Object.keys(VIEW_LABELS) as GanttView[]).map((option) => (
            <button key={option} type="button" className={project?.view === option ? "on" : ""} aria-pressed={project?.view === option} disabled={!project} onClick={() => changeView(option)}>{VIEW_LABELS[option]}</button>
          ))}
        </div>
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={() => chartRef.current?.scrollToToday()}>今天</button>
        <button className="button button-small button-secondary" type="button" disabled={!project || historyDepth.undo === 0} onClick={undo} aria-label="復原">↺ 復原</button>
        <button className="button button-small button-secondary" type="button" disabled={!project || historyDepth.redo === 0} onClick={redo} aria-label="重做">↻ 重做</button>
        <span className="gantt-toolbar-spring" />
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={addGroup}>＋ 群組</button>
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={() => addTask(true)}>＋ 里程碑</button>
        <button className="button button-small button-blue" type="button" disabled={!project} onClick={() => addTask(false)}>＋ 新增任務</button>
      </div>
      {notice && <p className={`gantt-notice gantt-notice-${notice.tone}`} role="status">{notice.message}</p>}
      {project ? (
        <div className="gantt-body">
          <div className="gantt-table" role="grid" aria-label="任務列表">
            <div className="gantt-table-head" role="row"><span>任務</span><span>開始</span><span>工期</span><span>進度</span></div>
            {rows.map((row) =>
              row.kind === "group" ? (
                <div className="gantt-row gantt-row-group" role="row" key={row.id}>
                  <input className="gantt-group-name" aria-label="群組名稱" value={row.name} maxLength={60} onChange={(event) => updateDirect((previous) => ({ ...previous, groups: previous.groups.map((group) => (group.id === row.id ? { ...group, name: event.target.value } : group)) }))} onFocus={() => project && pushSnapshot(project)} />
                  <span className="gantt-cell-dim">{groupTaskCount.get(row.id) ?? 0} 項</span>
                  <span />
                  <button className="gantt-row-delete" type="button" aria-label={`刪除群組 ${row.name}`} title="刪除群組（任務會保留）" onClick={() => deleteGroup(row.id)}>✕</button>
                </div>
              ) : (
                <div
                  className={`gantt-row${row.task.id === selectedId ? " gantt-row-selected" : ""}`}
                  role="row"
                  key={row.task.id}
                  tabIndex={0}
                  onClick={() => setSelectedId(row.task.id)}
                  onDoubleClick={() => openEditor(row.task.id)}
                  onKeyDown={(event) => { if (event.key === "Enter") openEditor(row.task.id); }}
                >
                  <span className="gantt-cell-name">{row.task.milestone ? "◆ " : ""}{row.task.name}</span>
                  <span className="gantt-cell-dim">{formatShortDate(row.task.start)}</span>
                  <span className="gantt-cell-dim">{row.task.milestone ? "—" : `${row.task.durationDays}d`}</span>
                  <span className="gantt-cell-dim">{row.task.milestone ? "—" : `${row.task.progress}%`}</span>
                </div>
              ),
            )}
            {project.tasks.length === 0 && <p className="gantt-empty">還沒有任務，按「＋ 新增任務」開始。</p>}
          </div>
          <GanttChart
            ref={chartRef}
            project={project}
            todayIso={today}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenEditor={openEditor}
            onCommitTask={(id, patch) => patchTask(id, patch)}
            onAddDependency={addDependency}
            onDeleteTask={deleteTask}
          />
        </div>
      ) : (
        <div className="gantt-body gantt-loading">正在載入這台裝置上的專案…</div>
      )}
      <div className="gantt-hint">
        <span>拖曳任務條＝移動</span><span>拖右緣＝調整工期</span><span>選取後拖曳尾端圓點＝建立依賴</span><span>雙擊＝編輯</span><span>← →＝移動一天，Shift＋← →＝調整工期</span>
      </div>
      <div className="export-toolbar">
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={downloadPng}>下載 PNG</button>
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={downloadSvg}>下載 SVG</button>
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={downloadCsv}>下載 CSV</button>
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={downloadJson}>下載備份 JSON</button>
        <button className="button button-small button-secondary" type="button" disabled={!project} onClick={() => fileInputRef.current?.click()}>匯入 JSON</button>
        <button className="button button-small button-coral" type="button" disabled={!project} onClick={copyMermaid}>{copied ? "已複製 ✓" : "複製 Mermaid"}</button>
        <input ref={fileInputRef} className="file-input" type="file" accept="application/json,.json" aria-label="匯入 JSON 檔" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importJson(file); event.target.value = ""; }} />
      </div>
      {project && (
        <details className="mermaid-code"><summary>查看 Mermaid 原始碼</summary><pre>{toMermaid(project)}</pre></details>
      )}
      {project && editingTask && (
        <>
          <div className="gantt-editor-backdrop" onClick={() => setEditorId(null)} aria-hidden="true" />
          <aside className="gantt-editor" role="dialog" aria-label={`編輯 ${editingTask.name}`}>
            <div className="panel-header"><h2>編輯{editingTask.milestone ? "里程碑" : "任務"}</h2><button className="gantt-row-delete" type="button" aria-label="關閉編輯" onClick={() => setEditorId(null)}>✕</button></div>
            <label className="field-label" htmlFor="gantt-edit-name">名稱
              <input id="gantt-edit-name" className="key-input" value={editingTask.name} maxLength={80} onChange={(event) => patchTask(editingTask.id, { name: event.target.value }, { snapshot: false })} />
            </label>
            <label className="check-row gantt-editor-check">
              <input type="checkbox" checked={editingTask.milestone === true} onChange={(event) => patchTask(editingTask.id, event.target.checked ? { milestone: true } : { milestone: undefined, durationDays: Math.max(1, editingTask.durationDays || 3) }, { snapshot: false })} />
              里程碑（單一日期）
            </label>
            <label className="field-label" htmlFor="gantt-edit-start">開始日期
              <input id="gantt-edit-start" className="key-input" type="date" value={editingTask.start} onChange={(event) => { if (isValidIsoDate(event.target.value)) patchTask(editingTask.id, { start: event.target.value }, { snapshot: false }); }} />
            </label>
            {!editingTask.milestone && (
              <>
                <label className="field-label" htmlFor="gantt-edit-duration">工期（天）
                  <input id="gantt-edit-duration" className="key-input" type="number" min={1} max={3650} value={editingTask.durationDays} onChange={(event) => { const value = Math.round(Number(event.target.value)); if (Number.isFinite(value)) patchTask(editingTask.id, { durationDays: Math.min(Math.max(value, 1), 3650) }, { snapshot: false }); }} />
                </label>
                <label className="field-label" htmlFor="gantt-edit-progress">進度：{editingTask.progress}%
                  <input id="gantt-edit-progress" className="gantt-range" type="range" min={0} max={100} step={5} value={editingTask.progress} onChange={(event) => patchTask(editingTask.id, { progress: Number(event.target.value) }, { snapshot: false })} />
                </label>
                <fieldset className="gantt-color-picker">
                  <legend className="field-label">顏色</legend>
                  {(Object.keys(GANTT_COLORS) as GanttColor[]).map((color) => (
                    <label key={color} className={`gantt-swatch${editingTask.color === color ? " on" : ""}`} style={{ background: GANTT_COLORS[color].strong }} title={GANTT_COLORS[color].name}>
                      <input type="radio" name="gantt-color" checked={editingTask.color === color} onChange={() => patchTask(editingTask.id, { color }, { snapshot: false })} />
                      <span className="visually-hidden">{GANTT_COLORS[color].name}</span>
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            <label className="field-label" htmlFor="gantt-edit-assignee">負責人
              <input id="gantt-edit-assignee" className="key-input" value={editingTask.assignee ?? ""} maxLength={40} placeholder="選填" onChange={(event) => patchTask(editingTask.id, { assignee: event.target.value || undefined }, { snapshot: false })} />
            </label>
            <label className="field-label" htmlFor="gantt-edit-group">群組
              <select id="gantt-edit-group" className="key-input" value={editingTask.groupId ?? ""} onChange={(event) => patchTask(editingTask.id, { groupId: event.target.value || undefined }, { snapshot: false })}>
                <option value="">未分組</option>
                {project.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            {project.tasks.length > 1 && (
              <fieldset className="gantt-deps">
                <legend className="field-label">前置任務（完成後才能開始）</legend>
                {project.tasks.filter((task) => task.id !== editingTask.id).map((task) => {
                  const checked = editingTask.dependsOn.includes(task.id);
                  const blocked = !checked && wouldCreateCycle(project.tasks, editingTask.id, task.id);
                  return (
                    <label key={task.id} className="check-row gantt-dep-row" title={blocked ? "會形成循環依賴" : undefined}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={(event) => patchTask(editingTask.id, { dependsOn: event.target.checked ? [...editingTask.dependsOn, task.id] : editingTask.dependsOn.filter((id) => id !== task.id) }, { snapshot: false })}
                      />
                      <span>{task.milestone ? "◆ " : ""}{task.name}{blocked ? "（循環）" : ""}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            <button className="button button-small button-coral gantt-delete-button" type="button" onClick={() => deleteTask(editingTask.id)}>刪除這個{editingTask.milestone ? "里程碑" : "任務"}</button>
          </aside>
        </>
      )}
    </section>
  );
}
