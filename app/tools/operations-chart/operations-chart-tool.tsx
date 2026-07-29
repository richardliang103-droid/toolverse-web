"use client";

import { useEffect, useRef, useState } from "react";
import {
  PAYMENT_TERMS,
  PAYMENT_TERM_LABELS,
  chartWarnings,
  computeOperationsLayout,
  createParty,
  createSampleChart,
  normalizeChart,
} from "@/lib/operations-chart";
import type { OperationsChart, OperationsParty, PartySide, PaymentTerm } from "@/lib/operations-chart";
import { OperationsChartSvg } from "./operations-chart-svg";
import type { OperationsChartSvgHandle } from "./operations-chart-svg";

const STORAGE_KEY = "toolverse:operations-chart:v1";

function safeFilename(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "toolverse-operations-chart";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PartyTable({ title, side, parties, onAdd, onUpdate, onDelete }: {
  title: string;
  side: PartySide;
  parties: OperationsParty[];
  onAdd: (side: PartySide) => void;
  onUpdate: (id: string, patch: Partial<OperationsParty>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <h3 className="operations-subheading">{title}</h3>
      <div className="csv-table-scroll">
        <table className="csv-table">
          <thead><tr><th className="csv-corner" aria-hidden="true" /><th>名稱</th><th>佔比 %</th><th>條件</th><th>關係人</th><th>備註</th></tr></thead>
          <tbody>
            {parties.map((party) => (
              <tr key={party.id}>
                <td className="csv-row-tools"><button className="gantt-row-delete" type="button" aria-label={`刪除 ${party.name}`} onClick={() => onDelete(party.id)}>✕</button></td>
                <td><input className="csv-cell" aria-label="名稱" value={party.name} maxLength={60} onChange={(event) => onUpdate(party.id, { name: event.target.value })} /></td>
                <td><input className="csv-cell" aria-label="佔比百分比" type="number" min={0} max={100} value={party.percentage} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) onUpdate(party.id, { percentage: Math.min(Math.max(value, 0), 100) }); }} /></td>
                <td>
                  <select className="csv-cell" aria-label="付款／收款條件" value={party.term} onChange={(event) => onUpdate(party.id, { term: event.target.value as PaymentTerm })}>
                    {PAYMENT_TERMS.map((term) => <option key={term} value={term}>{PAYMENT_TERM_LABELS[term]}</option>)}
                  </select>
                </td>
                <td className="csv-row-tools"><label className="check-row"><input type="checkbox" checked={party.relatedParty} onChange={(event) => onUpdate(party.id, { relatedParty: event.target.checked })} aria-label={`${party.name} 是否為關係人`} /></label></td>
                <td><input className="csv-cell" aria-label="備註" placeholder="選填" value={party.note ?? ""} maxLength={120} onChange={(event) => onUpdate(party.id, { note: event.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="result-actions"><button className="button button-small button-secondary" type="button" onClick={() => onAdd(side)}>＋ {title}</button></div>
    </>
  );
}

export function OperationsChartTool() {
  const [chart, setChart] = useState<OperationsChart | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const [copied, setCopied] = useState(false);

  const svgRef = useRef<OperationsChartSvgHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let restored: OperationsChart | null = null;
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

  function update(updater: (previous: OperationsChart) => OperationsChart) {
    setChart((previous) => (previous ? updater(previous) : previous));
  }

  function addParty(side: PartySide) {
    update((previous) => ({ ...previous, parties: [...previous.parties, createParty({ name: side === "upstream" ? "新供應商" : "新客戶", side })] }));
  }

  function updateParty(id: string, patch: Partial<OperationsParty>) {
    update((previous) => ({ ...previous, parties: previous.parties.map((party) => (party.id === id ? { ...party, ...patch } : party)) }));
  }

  function deleteParty(id: string) {
    update((previous) => ({ ...previous, parties: previous.parties.filter((party) => party.id !== id) }));
  }

  function exportSvgMarkup() {
    const markup = svgRef.current?.exportSvg();
    if (!markup) { showNotice("圖表尚未就緒，請再試一次", "error"); return null; }
    return markup;
  }

  function downloadSvg() {
    if (!chart) return;
    const markup = exportSvgMarkup();
    if (markup) downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${safeFilename(chart.title)}.svg`);
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
      showNotice(normalized.repairs.length > 0 ? `已匯入，並自動整理 ${normalized.repairs.length} 個問題` : "已匯入營運架構");
    } catch {
      showNotice("讀取檔案失敗，請確認內容是本工具匯出的 JSON", "error");
    }
  }

  const layout = chart ? computeOperationsLayout(chart) : null;
  const warnings = chart ? chartWarnings(chart) : [];

  if (!chart || !layout) return <section className="workspace operations-workspace page-shell" aria-label="營運架構圖工具"><div className="gantt-loading">正在載入這台裝置上的資料…</div></section>;

  const upstream = chart.parties.filter((party) => party.side === "upstream");
  const downstream = chart.parties.filter((party) => party.side === "downstream");

  return (
    <section className="workspace operations-workspace page-shell" aria-label="營運架構圖工具">
      <div className="panel">
        <div className="panel-header"><h2>營運資料</h2><span className="panel-meta">{upstream.length} 個上游・{downstream.length} 個下游</span></div>
        <label className="field-label" htmlFor="operations-title">圖表標題
          <input id="operations-title" className="key-input" value={chart.title} maxLength={80} onChange={(event) => update((previous) => ({ ...previous, title: event.target.value }))} onBlur={() => update((previous) => ({ ...previous, title: previous.title.trim() || "未命名營運架構" }))} />
        </label>
        <label className="field-label" htmlFor="operations-subject">受查公司名稱
          <input id="operations-subject" className="key-input" value={chart.subjectName} maxLength={60} onChange={(event) => update((previous) => ({ ...previous, subjectName: event.target.value }))} />
        </label>
        <label className="field-label" htmlFor="operations-model">營運模式
          <input id="operations-model" className="key-input" placeholder="例：製造・買賣（內銷 70%・外銷 30%）" value={chart.businessModel} maxLength={80} onChange={(event) => update((previous) => ({ ...previous, businessModel: event.target.value }))} />
        </label>
        {notice && <p className={`gantt-notice gantt-notice-${notice.tone}`} role="status">{notice.message}</p>}
        {warnings.length > 0 && (
          <ul className="operations-warnings" role="list">
            {warnings.map((warning) => <li key={warning.side + warning.message}>{warning.message}</li>)}
          </ul>
        )}
        <PartyTable title="上游供應商" side="upstream" parties={upstream} onAdd={addParty} onUpdate={updateParty} onDelete={deleteParty} />
        <PartyTable title="下游客戶" side="downstream" parties={downstream} onAdd={addParty} onUpdate={updateParty} onDelete={deleteParty} />
      </div>
      <div className="panel panel-tinted">
        <div className="panel-header"><h2>預覽</h2><span className="panel-meta">白底輸出，適合貼進報告</span></div>
        <div className="gantt-canvas operations-canvas">
          <OperationsChartSvg ref={svgRef} chart={chart} layout={layout} />
        </div>
        <ul className="operations-legend" aria-label="圖例">
          <li><span className="operations-swatch" style={{ background: "#ebf1e2" }} />上游供應商</li>
          <li><span className="operations-swatch" style={{ background: "#f9e9ec" }} />下游客戶</li>
          <li><span className="operations-swatch" style={{ background: "#ece7f5" }} />受查公司</li>
          <li><span className="operations-swatch" style={{ background: "#faeeda" }} />關係人交易</li>
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
