"use client";

import { useEffect, useRef, useState } from "react";
import {
  ENTITY_KINDS,
  ENTITY_STATUSES,
  ENTITY_STATUS_LABELS,
  chartWarnings,
  computeEquityLayout,
  createEntity,
  createSampleChart,
  newId,
  normalizeChart,
  parseQuickPaste,
} from "@/lib/equity-chart";
import type { EntityKind, EntityStatus, EquityChart } from "@/lib/equity-chart";
import { EquityChartSvg } from "./equity-chart-svg";
import type { EquityChartSvgHandle } from "./equity-chart-svg";

const STORAGE_KEY = "toolverse:equity-chart:v1";

const KIND_LABELS: Record<EntityKind, string> = { person: "自然人", domestic: "國內法人", offshore: "境外法人" };

function safeFilename(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "toolverse-equity-chart";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EquityChartTool() {
  const [chart, setChart] = useState<EquityChart | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickPasteOpen, setQuickPasteOpen] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const [copied, setCopied] = useState(false);

  const svgRef = useRef<EquityChartSvgHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let restored: EquityChart | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) restored = normalizeChart(JSON.parse(saved))?.chart ?? null;
    } catch { localStorage.removeItem(STORAGE_KEY); }
    // 還原此裝置的草稿需要一次性的 client hydration。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChart(restored ?? createSampleChart());
  }, []);

  useEffect(() => {
    if (chart) localStorage.setItem(STORAGE_KEY, JSON.stringify(chart));
  }, [chart]);

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  function showNotice(message: string, tone: "info" | "error" = "info") {
    setNotice({ message, tone });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3200);
  }

  function update(updater: (previous: EquityChart) => EquityChart) {
    setChart((previous) => (previous ? updater(previous) : previous));
  }

  function addEntity() {
    update((previous) => ({
      ...previous,
      entities: [...previous.entities, createEntity({ name: `實體 ${previous.entities.length + 1}`, isSubject: previous.entities.length === 0 })],
    }));
  }

  function updateEntity(id: string, patch: Partial<EquityChart["entities"][number]>) {
    update((previous) => ({ ...previous, entities: previous.entities.map((entity) => (entity.id === id ? { ...entity, ...patch } : entity)) }));
  }

  function setSubject(id: string) {
    update((previous) => ({ ...previous, entities: previous.entities.map((entity) => ({ ...entity, isSubject: entity.id === id })) }));
  }

  function deleteEntity(id: string) {
    update((previous) => {
      const remaining = previous.entities.filter((entity) => entity.id !== id);
      const removedSubject = previous.entities.find((entity) => entity.id === id)?.isSubject;
      if (removedSubject && remaining.length > 0 && !remaining.some((entity) => entity.isSubject)) remaining[0].isSubject = true;
      return { ...previous, entities: remaining, holdings: previous.holdings.filter((holding) => holding.holderId !== id && holding.ownedId !== id) };
    });
    if (selectedId === id) setSelectedId(null);
  }

  function addHolding() {
    if (!chart || chart.entities.length < 2) return;
    const holder = chart.entities[0];
    const owned = chart.entities.find((entity) => entity.id !== holder.id) ?? chart.entities[1];
    update((previous) => ({ ...previous, holdings: [...previous.holdings, { id: newId(), holderId: holder.id, ownedId: owned.id, percentage: 0 }] }));
  }

  function updateHolding(id: string, patch: Partial<EquityChart["holdings"][number]>) {
    update((previous) => ({
      ...previous,
      holdings: previous.holdings.map((holding) => {
        if (holding.id !== id) return holding;
        const next = { ...holding, ...patch };
        if (next.holderId === next.ownedId) return holding; // 不允許自我持股
        return next;
      }),
    }));
  }

  function deleteHolding(id: string) {
    update((previous) => ({ ...previous, holdings: previous.holdings.filter((holding) => holding.id !== id) }));
  }

  function applyQuickPaste() {
    if (!chart) return;
    const result = parseQuickPaste(quickText, chart.title);
    if (result.chart.entities.length === 0) { showNotice("沒有解析出任何資料，請確認格式是「股東 > 公司 百分比」", "error"); return; }
    setChart(result.chart);
    setSelectedId(null);
    setQuickPasteOpen(false);
    setQuickText("");
    showNotice(result.warnings.length > 0 ? `已套用，${result.warnings.length} 行看不懂已略過` : "已套用快速貼上的資料");
  }

  function exportSvgMarkup() {
    const markup = svgRef.current?.exportSvg();
    if (!markup) { showNotice("圖表尚未就緒，請再試一次", "error"); return null; }
    return markup;
  }

  function svgBlob() {
    const markup = exportSvgMarkup();
    return markup ? new Blob([markup], { type: "image/svg+xml;charset=utf-8" }) : null;
  }

  function downloadSvg() {
    if (!chart) return;
    const blob = svgBlob();
    if (blob) downloadBlob(blob, `${safeFilename(chart.title)}.svg`);
  }

  function pngBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const markup = exportSvgMarkup();
      if (!markup || !layout) { resolve(null); return; }
      const image = new Image();
      const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
      image.onload = () => {
        const scale = Math.min(2, 4200 / layout.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(layout.width * scale);
        canvas.height = Math.round(layout.height * scale);
        const context = canvas.getContext("2d");
        if (!context) { resolve(null); URL.revokeObjectURL(source); return; }
        context.scale(scale, scale);
        context.drawImage(image, 0, 0, layout.width, layout.height);
        canvas.toBlob((blob) => { resolve(blob); URL.revokeObjectURL(source); }, "image/png");
      };
      image.onerror = () => { URL.revokeObjectURL(source); resolve(null); };
      image.src = source;
    });
  }

  async function downloadPng() {
    if (!chart) return;
    const blob = await pngBlob();
    if (blob) downloadBlob(blob, `${safeFilename(chart.title)}.png`);
    else showNotice("PNG 產生失敗，請改下載 SVG", "error");
  }

  function downloadJson() {
    if (!chart) return;
    downloadBlob(new Blob([JSON.stringify(chart, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFilename(chart.title)}.json`);
  }

  async function copyPng() {
    const blob = await pngBlob();
    if (!blob) { showNotice("PNG 產生失敗，請改用下載", "error"); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      showNotice("無法複製到剪貼簿，請改用下載 PNG", "error");
    }
  }

  async function importFile(file: File) {
    try {
      const text = await file.text();
      const normalized = normalizeChart(JSON.parse(text));
      if (!normalized) { showNotice("無法解析這個檔案 — 請使用本工具匯出的 JSON", "error"); return; }
      setChart(normalized.chart);
      setSelectedId(null);
      showNotice(normalized.repairs.length > 0 ? `已匯入，並自動整理 ${normalized.repairs.length} 個問題` : "已匯入股權架構");
    } catch {
      showNotice("讀取檔案失敗，請確認內容是本工具匯出的 JSON", "error");
    }
  }

  const layout = chart ? computeEquityLayout(chart) : null;
  const warnings = chart ? chartWarnings(chart) : [];

  if (!chart || !layout) return <section className="workspace equity-workspace page-shell" aria-label="股權架構圖工具"><div className="gantt-loading">正在載入這台裝置上的資料…</div></section>;

  return (
    <section className="workspace equity-workspace page-shell" aria-label="股權架構圖工具">
      <div className="panel">
        <div className="panel-header"><h2>股權資料</h2><span className="panel-meta">{chart.entities.length} 個實體・{chart.holdings.length} 筆持股</span></div>
        <label className="field-label" htmlFor="equity-title">圖表標題
          <input id="equity-title" className="key-input" value={chart.title} maxLength={80} onChange={(event) => update((previous) => ({ ...previous, title: event.target.value }))} onBlur={() => update((previous) => ({ ...previous, title: previous.title.trim() || "未命名股權架構" }))} />
        </label>
        {notice && <p className={`gantt-notice gantt-notice-${notice.tone}`} role="status">{notice.message}</p>}
        {warnings.length > 0 && (
          <ul className="equity-warnings" role="list">
            {warnings.map((warning) => <li key={warning.entityId + warning.message}>{warning.message}</li>)}
          </ul>
        )}
        <div className="csv-actions">
          <button className="button button-small button-blue" type="button" onClick={addEntity}>＋ 實體</button>
          <button className="button button-small button-secondary" type="button" disabled={chart.entities.length < 2} onClick={addHolding}>＋ 持股關係</button>
          <button className="button button-small button-secondary" type="button" onClick={() => setQuickPasteOpen((value) => !value)}>{quickPasteOpen ? "取消快速貼上" : "快速貼上"}</button>
        </div>
        {quickPasteOpen && (
          <div className="equity-quickpaste">
            <label className="sr-only" htmlFor="equity-quick-text">快速貼上股權資料</label>
            <textarea
              id="equity-quick-text"
              className="participant-input participant-input-compact"
              value={quickText}
              onChange={(event) => setQuickText(event.target.value)}
              placeholder={"一行一筆「股東 > 被投資公司 百分比」，例如：\n王大明 > 宏昌實業 45\n林美惠 > 宏昌實業 35\n*宏昌實業 > 宏昌貿易 100\n\n行首加 * 可指定該行的股東為受查公司。"}
              rows={6}
              spellCheck={false}
            />
            <div className="result-actions">
              <button className="button button-small button-blue" type="button" onClick={applyQuickPaste}>套用（取代目前資料）</button>
            </div>
          </div>
        )}
        <h3 className="equity-subheading">實體（股東與公司）</h3>
        <div className="csv-table-scroll">
          <table className="csv-table">
            <thead>
              <tr><th className="csv-corner" aria-hidden="true" /><th>名稱</th><th>類型</th><th>狀態</th><th>地區／備註</th><th>受查公司</th></tr>
            </thead>
            <tbody>
              {chart.entities.map((entity) => (
                <tr key={entity.id} className={entity.id === selectedId ? "gantt-row-selected" : undefined}>
                  <td className="csv-row-tools"><button className="gantt-row-delete" type="button" aria-label={`刪除實體 ${entity.name}`} onClick={() => deleteEntity(entity.id)}>✕</button></td>
                  <td><input className="csv-cell" aria-label="名稱" value={entity.name} maxLength={60} onFocus={() => setSelectedId(entity.id)} onChange={(event) => updateEntity(entity.id, { name: event.target.value })} /></td>
                  <td>
                    <select className="csv-cell" aria-label="類型" value={entity.kind} onChange={(event) => updateEntity(entity.id, { kind: event.target.value as EntityKind, region: event.target.value === "offshore" ? entity.region : undefined })}>
                      {ENTITY_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="csv-cell" aria-label="狀態" value={entity.status} onChange={(event) => updateEntity(entity.id, { status: event.target.value as EntityStatus })}>
                      {ENTITY_STATUSES.map((status) => <option key={status} value={status}>{ENTITY_STATUS_LABELS[status]}</option>)}
                    </select>
                  </td>
                  <td>
                    {entity.kind === "offshore" ? (
                      <input className="csv-cell" aria-label="登記地區" placeholder="例：BVI、開曼" value={entity.region ?? ""} maxLength={30} onChange={(event) => updateEntity(entity.id, { region: event.target.value })} />
                    ) : (
                      <input className="csv-cell" aria-label="備註" placeholder="選填，如職稱、統編" value={entity.note ?? ""} maxLength={120} onChange={(event) => updateEntity(entity.id, { note: event.target.value })} />
                    )}
                  </td>
                  <td className="csv-row-tools">
                    <label className="check-row"><input type="radio" name="equity-subject" checked={entity.isSubject} onChange={() => setSubject(entity.id)} aria-label={`將 ${entity.name} 設為受查公司`} /></label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chart.entities.length > 0 && (
          <>
            <h3 className="equity-subheading">持股關係</h3>
            <div className="csv-table-scroll">
              <table className="csv-table">
                <thead><tr><th className="csv-corner" aria-hidden="true" /><th>股東</th><th>被投資公司</th><th>持股 %</th><th>備註</th></tr></thead>
                <tbody>
                  {chart.holdings.map((holding) => (
                    <tr key={holding.id}>
                      <td className="csv-row-tools"><button className="gantt-row-delete" type="button" aria-label="刪除這筆持股關係" onClick={() => deleteHolding(holding.id)}>✕</button></td>
                      <td>
                        <select className="csv-cell" aria-label="股東" value={holding.holderId} onChange={(event) => updateHolding(holding.id, { holderId: event.target.value })}>
                          {chart.entities.map((entity) => <option key={entity.id} value={entity.id} disabled={entity.id === holding.ownedId}>{entity.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="csv-cell" aria-label="被投資公司" value={holding.ownedId} onChange={(event) => updateHolding(holding.id, { ownedId: event.target.value })}>
                          {chart.entities.map((entity) => <option key={entity.id} value={entity.id} disabled={entity.id === holding.holderId}>{entity.name}</option>)}
                        </select>
                      </td>
                      <td><input className="csv-cell" aria-label="持股百分比" type="number" min={0} max={100} value={holding.percentage} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateHolding(holding.id, { percentage: Math.min(Math.max(value, 0), 100) }); }} /></td>
                      <td><input className="csv-cell" aria-label="備註" placeholder="選填" value={holding.note ?? ""} maxLength={60} onChange={(event) => updateHolding(holding.id, { note: event.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {chart.entities.length === 0 && <p className="gantt-empty">還沒有資料，按「＋ 實體」開始，或用「快速貼上」貼上整份股權清單。</p>}
      </div>
      <div className="panel panel-tinted">
        <div className="panel-header"><h2>預覽</h2><span className="panel-meta">白底輸出，適合貼進報告</span></div>
        <div className="gantt-canvas equity-canvas">
          <EquityChartSvg ref={svgRef} chart={chart} layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <ul className="equity-legend" aria-label="圖例">
          <li><span className="equity-swatch equity-swatch-person" />自然人</li>
          <li><span className="equity-swatch equity-swatch-domestic" />國內法人</li>
          <li><span className="equity-swatch equity-swatch-offshore" />境外法人</li>
          <li><span className="equity-swatch equity-swatch-subject" />受查公司</li>
        </ul>
        <div className="export-toolbar">
          <button className="button button-small button-secondary" type="button" onClick={downloadPng}>下載 PNG</button>
          <button className="button button-small button-secondary" type="button" onClick={downloadSvg}>下載 SVG</button>
          <button className="button button-small button-secondary" type="button" onClick={downloadJson}>下載備份 JSON</button>
          <button className="button button-small button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>匯入 JSON</button>
          <button className="button button-small button-coral" type="button" onClick={copyPng}>{copied ? "已複製 ✓" : "複製 PNG 到剪貼簿"}</button>
          <input ref={fileInputRef} className="file-input" type="file" accept="application/json,.json" aria-label="匯入 JSON 檔" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
        </div>
      </div>
    </section>
  );
}
