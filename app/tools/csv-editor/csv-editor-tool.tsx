"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { detectDelimiter, parseDelimited, sortRows, toDelimitedText, toJsonText, type CsvDelimiter } from "@/lib/csv";

const MAX_DISPLAY_ROWS = 300;
const MAX_SIZE = 10 * 1024 * 1024;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CsvEditorTool() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(true);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(",");
  const [sortState, setSortState] = useState<{ column: number; direction: "asc" | "desc" } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  function loadText(text: string) {
    setError("");
    const detected = detectDelimiter(text);
    const parsed = parseDelimited(text, detected);
    if (parsed.length === 0) { setError("內容是空的，或無法解析成表格"); return; }
    setDelimiter(detected);
    setRows(parsed);
    setSortState(null);
  }

  function onPaste(text: string) {
    setRaw(text);
    if (text.trim() !== "") loadText(text);
    else setRows([]);
  }

  function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_SIZE) { setError("檔案超過 10 MB 上限"); return; }
    void file.text().then((text) => { setRaw(""); loadText(text); });
  }

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    setRows((previous) => previous.map((row, at) => (at === rowIndex ? row.map((cell, col) => (col === colIndex ? value : cell)) : row)));
  }

  function addRow() {
    setRows((previous) => [...previous, previous[0]?.map(() => "") ?? [""]]);
  }

  function addColumn() {
    setRows((previous) => (previous.length === 0 ? [[""]] : previous.map((row) => [...row, ""])));
  }

  function deleteRow(index: number) {
    setRows((previous) => previous.filter((_, at) => at !== index));
  }

  function deleteColumn(index: number) {
    setRows((previous) => previous.map((row) => row.filter((_, at) => at !== index)).filter((row) => row.length > 0));
  }

  function applySort(column: number) {
    const direction = sortState?.column === column && sortState.direction === "asc" ? "desc" : "asc";
    setSortState({ column, direction });
    setRows((previous) => sortRows(previous, column, direction, headerRow));
  }

  async function copyCsv() {
    try {
      await navigator.clipboard.writeText(toDelimitedText(rows, delimiter));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch { setError("無法複製到剪貼簿，請改用下載"); }
  }

  const columnCount = rows[0]?.length ?? 0;
  const visibleRows = rows.slice(0, MAX_DISPLAY_ROWS);

  return <section className="workspace csv-workspace page-shell" aria-label="CSV 編輯器">
    <div className="panel csv-panel">
      <div className="panel-header"><h2>CSV／TSV 表格</h2><span className="panel-meta">{rows.length > 0 ? `${rows.length} 列 × ${columnCount} 欄 · 分隔符 ${delimiter === "\t" ? "Tab" : delimiter}` : "不上傳、本機處理"}</span></div>
      {rows.length === 0 && (
        <>
          <label className="sr-only" htmlFor="csv-input">貼上 CSV 內容</label>
          <textarea id="csv-input" className="participant-input csv-paste" value={raw} onChange={(event) => onPaste(event.target.value)} placeholder={"貼上 CSV 或 TSV 內容（會自動偵測逗號、分號、Tab）…\n\n姓名,部門,分機\n小明,行銷,120\n小美,工程,241"} spellCheck={false} />
          <div className="result-actions">
            <button className="button button-small button-blue" type="button" onClick={() => fileRef.current?.click()}>開啟 CSV 檔案</button>
          </div>
          <input ref={fileRef} className="file-input" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={onPickFile} aria-label="選擇 CSV 檔案" />
        </>
      )}
      {rows.length > 0 && (
        <>
          <div className="csv-actions">
            <label className="check-row"><input type="checkbox" checked={headerRow} onChange={(event) => setHeaderRow(event.target.checked)} />首列是欄位名稱</label>
            <button className="button button-small button-secondary" type="button" onClick={addRow}>＋ 列</button>
            <button className="button button-small button-secondary" type="button" onClick={addColumn}>＋ 欄</button>
            <button className="button button-small button-blue" type="button" onClick={() => downloadBlob(new Blob([toDelimitedText(rows, delimiter)], { type: "text/csv;charset=utf-8" }), "toolverse-表格.csv")}>下載 CSV</button>
            <button className="button button-small button-secondary" type="button" onClick={() => downloadBlob(new Blob([toJsonText(rows, headerRow)], { type: "application/json;charset=utf-8" }), "toolverse-表格.json")}>下載 JSON</button>
            <button className="button button-small button-secondary" type="button" onClick={copyCsv}>{copied ? "已複製 ✓" : "複製 CSV"}</button>
            <button className="button button-small button-secondary" type="button" onClick={() => { setRows([]); setRaw(""); setSortState(null); }}>關閉表格</button>
          </div>
          <div className="csv-table-scroll">
            <table className="csv-table">
              <thead>
                <tr>
                  <th className="csv-corner" aria-hidden="true" />
                  {rows[0].map((_, colIndex) => (
                    <th key={colIndex}>
                      <span className="csv-col-tools">
                        <button className="csv-sort" type="button" title="排序" aria-label={`依第 ${colIndex + 1} 欄排序`} onClick={() => applySort(colIndex)}>
                          {sortState?.column === colIndex ? (sortState.direction === "asc" ? "▲" : "▼") : "⇅"}
                        </button>
                        <button className="gantt-row-delete" type="button" title="刪除整欄" aria-label={`刪除第 ${colIndex + 1} 欄`} onClick={() => deleteColumn(colIndex)}>✕</button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={headerRow && rowIndex === 0 ? "csv-header-row" : undefined}>
                    <td className="csv-row-tools">
                      <button className="gantt-row-delete" type="button" title="刪除整列" aria-label={`刪除第 ${rowIndex + 1} 列`} onClick={() => deleteRow(rowIndex)}>✕</button>
                    </td>
                    {row.map((cell, colIndex) => (
                      <td key={colIndex}>
                        <input className="csv-cell" aria-label={`第 ${rowIndex + 1} 列第 ${colIndex + 1} 欄`} value={cell} onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > MAX_DISPLAY_ROWS && <p className="key-note">為維持流暢僅顯示前 {MAX_DISPLAY_ROWS} 列，編輯與匯出仍包含全部 {rows.length} 列。</p>}
        </>
      )}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
  </section>;
}
