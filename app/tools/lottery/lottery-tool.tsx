"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import gsap from "gsap";
import { drawWinners, normalizeParticipants } from "@/lib/lottery";

const STORAGE_KEY = "toolverse:lottery:v1";
const LEGACY_STORAGE_KEY = "hermes-tools:lottery:v1";
type StoredState = { raw: string; count: number; dedupe: boolean; exclude: boolean; previousWinners: string[]; history: string[][] };

// Number of name-flicker "ticks" the spin animation runs through before it
// lands on the real result, and how those ticks are spaced in time — small
// gaps at first, growing gaps toward the end — so it reads as a wheel
// spinning fast and then slowing down, rather than a plain linear flicker.
const SPIN_TICKS = 16;
const SPIN_DURATION = 1.05;
const SPIN_EASE_POWER = 2.3;

function fireConfetti() {
  const shared = { spread: 68, ticks: 130, startVelocity: 34, scalar: 0.95 };
  confetti({ ...shared, particleCount: 70, angle: 60, origin: { x: 0.15, y: 0.7 } });
  confetti({ ...shared, particleCount: 70, angle: 120, origin: { x: 0.85, y: 0.7 } });
  confetti({ ...shared, particleCount: 50, angle: 90, origin: { x: 0.5, y: 0.55 }, spread: 100 });
}

export function LotteryTool() {
  const [raw, setRaw] = useState("");
  const [count, setCount] = useState(1);
  const [dedupe, setDedupe] = useState(true);
  const [exclude, setExclude] = useState(true);
  const [previousWinners, setPreviousWinners] = useState<string[]>([]);
  const [history, setHistory] = useState<string[][]>([]);
  const [winners, setWinners] = useState<string[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [spinName, setSpinName] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const spinNameRef = useRef<HTMLDivElement>(null);
  const winnerListRef = useRef<HTMLDivElement>(null);
  const spinTimelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved) as StoredState;
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      // Restoring device-local preferences requires a one-time client hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRaw(data.raw ?? ""); setCount(data.count ?? 1); setDedupe(data.dedupe ?? true); setExclude(data.exclude ?? true); setPreviousWinners(data.previousWinners ?? []); setHistory(data.history ?? []);
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ raw, count, dedupe, exclude, previousWinners, history }));
  }, [raw, count, dedupe, exclude, previousWinners, history]);

  useEffect(() => () => { spinTimelineRef.current?.kill(); }, []);

  useEffect(() => {
    if (winners.length && winnerListRef.current) {
      gsap.fromTo(
        winnerListRef.current.children,
        { opacity: 0, y: 16, scale: 0.88 },
        { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "back.out(1.8)", stagger: 0.12 },
      );
    }
  }, [winners]);

  const participants = useMemo(() => normalizeParticipants(raw, dedupe), [raw, dedupe]);
  const eligible = useMemo(() => exclude ? participants.filter((name) => !previousWinners.includes(name)) : participants, [participants, exclude, previousWinners]);

  function handleDraw() {
    setError(""); setCopied(false);
    try {
      if (!participants.length) throw new Error("請先貼上至少一位參加者");
      const result = drawWinners(eligible, count);
      spinTimelineRef.current?.kill();
      setDrawing(true); setWinners([]);
      const pool = eligible.length ? eligible : result;
      const timeline = gsap.timeline({
        onComplete: () => {
          setWinners(result); setDrawing(false); setHistory((value) => [result, ...value].slice(0, 5));
          if (exclude) setPreviousWinners((value) => [...new Set([...value, ...result])]);
          fireConfetti();
        },
      });
      for (let tick = 0; tick < SPIN_TICKS; tick += 1) {
        const at = SPIN_DURATION * ((tick + 1) / SPIN_TICKS) ** SPIN_EASE_POWER;
        timeline.call(() => {
          setSpinName(pool[Math.floor(Math.random() * pool.length)] ?? "");
          if (spinNameRef.current) {
            gsap.fromTo(spinNameRef.current, { scale: 0.86, opacity: 0.55 }, { scale: 1, opacity: 1, duration: 0.14, ease: "power1.out" });
          }
        }, undefined, at);
      }
      spinTimelineRef.current = timeline;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "抽獎時發生錯誤"); }
  }

  async function copyResults() {
    await navigator.clipboard.writeText(winners.map((name, index) => `${index + 1}. ${name}`).join("\n"));
    setCopied(true);
  }

  function resetWinners() { setPreviousWinners([]); setWinners([]); setHistory([]); setError(""); }

  return <section className="workspace page-shell" aria-label="抽獎工具">
    <div className="panel"><div className="panel-header"><h2>參加者名單</h2><span className="panel-meta">{participants.length} 人 · {eligible.length} 人可抽</span></div><label className="sr-only" htmlFor="participants">參加者名單，一行一位</label><textarea id="participants" className="participant-input participant-input-compact" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'一行輸入一位參加者\n例如：\n小明\n小美\nAlex'} /><div className="form-controls"><label className="check-row"><input type="checkbox" checked={dedupe} onChange={(event) => setDedupe(event.target.checked)} />移除重複名字</label><label className="check-row"><input type="checkbox" checked={exclude} onChange={(event) => setExclude(event.target.checked)} />排除已中獎者</label><label className="number-field" htmlFor="winner-count">中獎人數<input id="winner-count" className="number-input" type="number" min="1" max={Math.max(1, eligible.length)} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label></div><button className="button button-blue draw-button" type="button" onClick={handleDraw} disabled={drawing}>{drawing ? "正在抽選…" : "開始抽獎 ✦"}</button>{error && <p className="error-message" role="alert">{error}</p>}</div>
    <div className="panel panel-tinted"><div className="panel-header"><h2>抽獎結果</h2><span className="panel-meta">Crypto random</span></div><div className="result-stage" aria-live="polite">{drawing ? <div className="drawing-stage"><div ref={spinNameRef} className="drawing-word">{spinName || "…"}</div><div className="drawing-hint">正在抽選…</div></div> : winners.length ? <div ref={winnerListRef} className="winner-list">{winners.map((winner, index) => <div className="winner-item" key={`${winner}-${index}`}>{index + 1}. {winner}</div>)}</div> : <div className="result-empty"><strong>好運正在待命</strong>輸入名單並按下抽獎，得獎者會出現在這裡。</div>}</div>{winners.length > 0 && <div className="result-actions"><button className="button button-small button-secondary" type="button" onClick={copyResults}>{copied ? "已複製 ✓" : "複製結果"}</button><button className="button button-small button-secondary" type="button" onClick={handleDraw}>再抽一次</button></div>}{(previousWinners.length > 0 || history.length > 0) && <div className="history"><div className="panel-header"><h3>最近結果</h3><button className="button button-small button-secondary" type="button" onClick={resetWinners}>全部重設</button></div><ol>{history.map((item, index) => <li key={`${item.join("-")}-${index}`}>{item.join("、")}</li>)}</ol></div>}</div>
  </section>;
}
