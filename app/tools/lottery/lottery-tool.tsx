"use client";

import { useEffect, useMemo, useState } from "react";
import { drawWinners, normalizeParticipants } from "@/lib/lottery";

const STORAGE_KEY = "hermes-tools:lottery:v1";
type StoredState = { raw: string; count: number; dedupe: boolean; exclude: boolean; previousWinners: string[]; history: string[][] };

export function LotteryTool() {
  const [raw, setRaw] = useState("");
  const [count, setCount] = useState(1);
  const [dedupe, setDedupe] = useState(true);
  const [exclude, setExclude] = useState(true);
  const [previousWinners, setPreviousWinners] = useState<string[]>([]);
  const [history, setHistory] = useState<string[][]>([]);
  const [winners, setWinners] = useState<string[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved) as StoredState;
      // Restoring device-local preferences requires a one-time client hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRaw(data.raw ?? ""); setCount(data.count ?? 1); setDedupe(data.dedupe ?? true); setExclude(data.exclude ?? true); setPreviousWinners(data.previousWinners ?? []); setHistory(data.history ?? []);
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ raw, count, dedupe, exclude, previousWinners, history }));
  }, [raw, count, dedupe, exclude, previousWinners, history]);

  const participants = useMemo(() => normalizeParticipants(raw, dedupe), [raw, dedupe]);
  const eligible = useMemo(() => exclude ? participants.filter((name) => !previousWinners.includes(name)) : participants, [participants, exclude, previousWinners]);

  function handleDraw() {
    setError(""); setCopied(false);
    try {
      if (!participants.length) throw new Error("請先貼上至少一位參加者");
      const result = drawWinners(eligible, count);
      setDrawing(true); setWinners([]);
      window.setTimeout(() => {
        setWinners(result); setDrawing(false); setHistory((value) => [result, ...value].slice(0, 5));
        if (exclude) setPreviousWinners((value) => [...new Set([...value, ...result])]);
      }, 900);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "抽獎時發生錯誤"); }
  }

  async function copyResults() {
    await navigator.clipboard.writeText(winners.map((name, index) => `${index + 1}. ${name}`).join("\n"));
    setCopied(true);
  }

  function resetWinners() { setPreviousWinners([]); setWinners([]); setHistory([]); setError(""); }

  return <section className="workspace page-shell" aria-label="抽獎工具">
    <div className="panel"><div className="panel-header"><h2>參加者名單</h2><span className="panel-meta">{participants.length} 人 · {eligible.length} 人可抽</span></div><label className="sr-only" htmlFor="participants">參加者名單，一行一位</label><textarea id="participants" className="participant-input" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'一行輸入一位參加者\n例如：\n小明\n小美\nAlex'} /><div className="form-controls"><label className="check-row"><input type="checkbox" checked={dedupe} onChange={(event) => setDedupe(event.target.checked)} />移除重複名字</label><label className="check-row"><input type="checkbox" checked={exclude} onChange={(event) => setExclude(event.target.checked)} />排除已中獎者</label><label className="number-field" htmlFor="winner-count">中獎人數<input id="winner-count" className="number-input" type="number" min="1" max={Math.max(1, eligible.length)} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label></div><button className="button button-blue draw-button" type="button" onClick={handleDraw} disabled={drawing}>{drawing ? "正在抽選…" : "開始公平抽獎 ✦"}</button>{error && <p className="error-message" role="alert">{error}</p>}</div>
    <div className="panel panel-tinted"><div className="panel-header"><h2>抽獎結果</h2><span className="panel-meta">Crypto random</span></div><div className="result-stage" aria-live="polite">{drawing ? <div className="drawing-word">抽選中…</div> : winners.length ? <div className="winner-list">{winners.map((winner, index) => <div className="winner-item" key={`${winner}-${index}`}>{index + 1}. {winner}</div>)}</div> : <div className="result-empty"><strong>好運正在待命</strong>輸入名單並按下抽獎，得獎者會出現在這裡。</div>}</div>{winners.length > 0 && <div className="result-actions"><button className="button button-small button-secondary" type="button" onClick={copyResults}>{copied ? "已複製 ✓" : "複製結果"}</button><button className="button button-small button-secondary" type="button" onClick={handleDraw}>再抽一次</button></div>}{(previousWinners.length > 0 || history.length > 0) && <div className="history"><div className="panel-header"><h3>最近結果</h3><button className="button button-small button-secondary" type="button" onClick={resetWinners}>全部重設</button></div><ol>{history.map((item, index) => <li key={`${item.join("-")}-${index}`}>{item.join("、")}</li>)}</ol></div>}</div>
  </section>;
}
