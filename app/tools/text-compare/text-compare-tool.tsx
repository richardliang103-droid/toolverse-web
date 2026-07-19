"use client";

import { useMemo, useState } from "react";
import { diffRows, diffTokens, type DiffGranularity, type DiffOptions } from "@/lib/diff";

const GRANULARITIES: Array<{ id: DiffGranularity; label: string; hint: string }> = [
  { id: "line", label: "逐行", hint: "適合程式碼與名單" },
  { id: "word", label: "逐詞", hint: "適合文章" },
  { id: "char", label: "逐字", hint: "最細" },
];

/** 修改列的行內差異：以詞為單位標記，呈現在並排視圖。 */
function InlineDiff({ left, right, side, options }: { left: string; right: string; side: "left" | "right"; options: DiffOptions }) {
  const ops = diffTokens(left, right, { ...options, granularity: "word" });
  return (
    <>
      {ops.map((op, index) => {
        if (op.type === "equal") return <span key={index}>{op.text}</span>;
        if (op.type === "remove" && side === "left") return <mark className="diff-mark diff-mark-remove" key={index}>{op.text}</mark>;
        if (op.type === "add" && side === "right") return <mark className="diff-mark diff-mark-add" key={index}>{op.text}</mark>;
        return null;
      })}
    </>
  );
}

export function TextCompareTool() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [granularity, setGranularity] = useState<DiffGranularity>("line");
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [view, setView] = useState<"split" | "unified">("split");

  const options = useMemo<DiffOptions>(() => ({ granularity, ignoreCase, ignoreWhitespace }), [granularity, ignoreCase, ignoreWhitespace]);
  const hasInput = left.trim() !== "" || right.trim() !== "";

  const lineResult = useMemo(() => (hasInput && granularity === "line" ? diffRows(left, right, options) : null), [hasInput, granularity, left, right, options]);
  const tokenOps = useMemo(() => (hasInput && granularity !== "line" ? diffTokens(left, right, options) : null), [hasInput, granularity, left, right, options]);

  return <section className="workspace compare-workspace page-shell" aria-label="文字比較工具">
    <div className="panel compare-inputs-panel">
      <div className="panel-header"><h2>兩段文字</h2><span className="panel-meta">全程本機比較</span></div>
      <div className="compare-inputs">
        <label className="field-label" htmlFor="compare-left">原始版本
          <textarea id="compare-left" className="participant-input compare-input" value={left} onChange={(event) => setLeft(event.target.value)} placeholder="貼上舊版文字…" spellCheck={false} />
        </label>
        <label className="field-label" htmlFor="compare-right">新版本
          <textarea id="compare-right" className="participant-input compare-input" value={right} onChange={(event) => setRight(event.target.value)} placeholder="貼上新版文字…" spellCheck={false} />
        </label>
      </div>
      <div className="compare-options">
        <div className="flow-mode-toggle" role="radiogroup" aria-label="比較單位">
          {GRANULARITIES.map((item) => (
            <button key={item.id} type="button" title={item.hint} className={`button button-small ${granularity === item.id ? "button-blue" : "button-secondary"}`} aria-pressed={granularity === item.id} onClick={() => setGranularity(item.id)}>{item.label}</button>
          ))}
        </div>
        {granularity === "line" && (
          <div className="flow-mode-toggle" role="radiogroup" aria-label="顯示方式">
            <button type="button" className={`button button-small ${view === "split" ? "button-blue" : "button-secondary"}`} aria-pressed={view === "split"} onClick={() => setView("split")}>並排</button>
            <button type="button" className={`button button-small ${view === "unified" ? "button-blue" : "button-secondary"}`} aria-pressed={view === "unified"} onClick={() => setView("unified")}>統一</button>
          </div>
        )}
        <label className="check-row"><input type="checkbox" checked={ignoreWhitespace} onChange={(event) => setIgnoreWhitespace(event.target.checked)} />忽略空白差異</label>
        <label className="check-row"><input type="checkbox" checked={ignoreCase} onChange={(event) => setIgnoreCase(event.target.checked)} />忽略大小寫</label>
      </div>
    </div>
    <div className="panel panel-tinted compare-result-panel">
      <div className="panel-header"><h2>比較結果</h2>
        {lineResult && <span className="compare-stats"><span className="compare-stat compare-stat-add">＋{lineResult.stats.added}</span><span className="compare-stat compare-stat-remove">−{lineResult.stats.removed}</span><span className="compare-stat compare-stat-modify">±{lineResult.stats.modified}</span></span>}
      </div>
      {!hasInput && <div className="result-stage"><div className="result-empty"><strong>貼上兩段文字開始比較</strong>新增、刪除與修改會用顏色標示，統計即時更新。</div></div>}
      {lineResult && view === "split" && (
        <div className="diff-split" role="table" aria-label="並排差異">
          {lineResult.rows.map((row, index) => (
            <div className={`diff-split-row diff-row-${row.kind}`} role="row" key={index}>
              <div className="diff-cell diff-cell-left" role="cell">{row.kind === "add" ? "" : row.kind === "modify" ? <InlineDiff left={row.left} right={row.right} side="left" options={options} /> : row.left}</div>
              <div className="diff-cell diff-cell-right" role="cell">{row.kind === "remove" ? "" : row.kind === "modify" ? <InlineDiff left={row.left} right={row.right} side="right" options={options} /> : row.right}</div>
            </div>
          ))}
        </div>
      )}
      {lineResult && view === "unified" && (
        <pre className="diff-unified" aria-label="統一差異">
          {lineResult.rows.map((row, index) => {
            if (row.kind === "equal") return <div className="diff-row-equal" key={index}>  {row.left}</div>;
            if (row.kind === "remove") return <div className="diff-row-remove" key={index}>− {row.left}</div>;
            if (row.kind === "add") return <div className="diff-row-add" key={index}>＋ {row.right}</div>;
            return <div key={index}><div className="diff-row-remove">− {row.left}</div><div className="diff-row-add">＋ {row.right}</div></div>;
          })}
        </pre>
      )}
      {tokenOps && (
        <p className="diff-inline-flow" aria-label="細粒度差異">
          {tokenOps.map((op, index) =>
            op.type === "equal"
              ? <span key={index}>{op.text}</span>
              : <mark className={`diff-mark ${op.type === "add" ? "diff-mark-add" : "diff-mark-remove"}`} key={index}>{op.text}</mark>,
          )}
        </p>
      )}
    </div>
  </section>;
}
