"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import gsap from "gsap";
import { drawWinners, normalizeParticipants } from "@/lib/lottery";
import { LotteryWheel, type LotteryWheelHandle, type WheelTheme } from "./lottery-wheel";
import { RosterPicker } from "@/components/roster-picker";
import { StarBorder } from "@/components/star-border";

const STORAGE_KEY = "toolverse:lottery:v1";
const LEGACY_STORAGE_KEY = "hermes-tools:lottery:v1";
type StoredState = { raw: string; count: number; dedupe: boolean; exclude: boolean; previousWinners: string[]; history: string[][]; theme: WheelTheme };

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** localStorage 可能被寫壞；逐欄驗證，救得回多少是多少，避免整頁 render 掛掉。 */
function sanitizeStoredState(value: unknown): StoredState {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    raw: typeof data.raw === "string" ? data.raw : "",
    count: Number.isFinite(Number(data.count)) ? Math.max(1, Math.round(Number(data.count))) : 1,
    dedupe: data.dedupe !== false,
    exclude: data.exclude !== false,
    previousWinners: stringList(data.previousWinners),
    history: Array.isArray(data.history) ? data.history.map(stringList).filter((round) => round.length > 0) : [],
    theme: data.theme === "neon" ? "neon" : "wa",
  };
}

function fireConfetti(finale: boolean) {
  const shared = { spread: 68, ticks: 130, startVelocity: 34, scalar: finale ? 0.95 : 0.75 };
  if (!finale) {
    confetti({ ...shared, particleCount: 46, angle: 90, origin: { x: 0.5, y: 0.4 }, spread: 95 });
    return;
  }
  confetti({ ...shared, particleCount: 70, angle: 60, origin: { x: 0.15, y: 0.7 } });
  confetti({ ...shared, particleCount: 70, angle: 120, origin: { x: 0.85, y: 0.7 } });
  confetti({ ...shared, particleCount: 50, angle: 90, origin: { x: 0.5, y: 0.55 }, spread: 100 });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
}

export function LotteryTool() {
  const [raw, setRaw] = useState("");
  const [count, setCount] = useState(1);
  const [dedupe, setDedupe] = useState(true);
  const [exclude, setExclude] = useState(true);
  const [previousWinners, setPreviousWinners] = useState<string[]>([]);
  const [history, setHistory] = useState<string[][]>([]);
  const [winners, setWinners] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [wheelSegments, setWheelSegments] = useState<string[]>([]);
  const [justRevealed, setJustRevealed] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<WheelTheme>("wa");

  const wheelRef = useRef<LotteryWheelHandle>(null);
  const winnerListRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!saved) return;
      const data = sanitizeStoredState(JSON.parse(saved));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      // Restoring device-local preferences requires a one-time client hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRaw(data.raw); setCount(data.count); setDedupe(data.dedupe); setExclude(data.exclude); setPreviousWinners(data.previousWinners); setHistory(data.history); setTheme(data.theme);
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ raw, count, dedupe, exclude, previousWinners, history, theme }));
  }, [raw, count, dedupe, exclude, previousWinners, history, theme]);

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const participants = useMemo(() => normalizeParticipants(raw, dedupe), [raw, dedupe]);
  const eligible = useMemo(() => exclude ? participants.filter((name) => !previousWinners.includes(name)) : participants, [participants, exclude, previousWinners]);

  // While idle, the wheel just mirrors the current eligible pool (updates live
  // as the list is edited). Mid-spin, `wheelSegments` takes over — it's what
  // handleDraw() actively shrinks between sequential winner spins.
  const displaySegments = drawing ? wheelSegments : eligible;

  useEffect(() => {
    if (revealed.length && winnerListRef.current) {
      const last = winnerListRef.current.lastElementChild;
      if (last) gsap.fromTo(last, { opacity: 0, y: 20, scale: 0.7, rotate: -6 }, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 0.6, ease: "back.out(2.2)" });
    }
  }, [revealed]);

  async function handleDraw() {
    if (drawing) return;
    setError(""); setCopied(false);
    try {
      if (!participants.length) throw new Error("請先貼上至少一位參加者");
      const result = drawWinners(eligible, count);
      setDrawing(true); setWinners([]); setRevealed([]); setJustRevealed("");
      let pool = eligible.length ? [...eligible] : [...result];
      setWheelSegments(pool);
      await wait(80); // let the wheel render this round's segments before the first spin starts

      for (let index = 0; index < result.length; index += 1) {
        const winnerName = result[index];
        const targetIndex = Math.max(0, pool.indexOf(winnerName));
        const duration = Math.max(1.3, 3.3 - index * 0.3);
        await wheelRef.current?.spinTo(targetIndex, duration);

        setRevealed((value) => [...value, winnerName]);
        setJustRevealed(winnerName);
        fireConfetti(index === result.length - 1);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setJustRevealed(""), 1800);

        pool = pool.filter((name) => name !== winnerName);
        setWheelSegments(pool);
        if (index < result.length - 1) await wait(500);
      }

      setWinners(result);
      setHistory((value) => [result, ...value].slice(0, 5));
      if (exclude) setPreviousWinners((value) => [...new Set([...value, ...result])]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "抽選時發生錯誤");
    } finally {
      setDrawing(false);
    }
  }

  async function copyResults() {
    try {
      await navigator.clipboard.writeText(winners.join("\n"));
      setCopied(true);
    } catch {
      setError("無法複製到剪貼簿，請手動選取名單複製");
    }
  }

  function resetWinners() { setPreviousWinners([]); setWinners([]); setRevealed([]); setHistory([]); setError(""); }

  return <section className={`workspace ${theme === "neon" ? "lottery-neon" : "lottery-wa"} page-shell`} aria-label="隨機抽名單工具">
    <div className="panel lottery-controls-panel"><div className="panel-header"><h2>參加名單</h2><span className="panel-meta">共 {participants.length} 人 · 可抽 {eligible.length} 人</span></div><p className="lottery-panel-note">每行一位，名單會留在你的裝置中。</p><label className="sr-only" htmlFor="participants">參加者名單，一行一位</label><textarea id="participants" className="participant-input participant-input-compact" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'輸入或貼上名單，每行一位\n例如：\n小明\n小美\nAlex'} /><RosterPicker currentText={raw} onLoad={setRaw} /><div className="form-controls"><label className="check-row"><input type="checkbox" checked={dedupe} onChange={(event) => setDedupe(event.target.checked)} />移除重複名字</label><label className="check-row"><input type="checkbox" checked={exclude} onChange={(event) => setExclude(event.target.checked)} />排除已抽出者</label><label className="number-field" htmlFor="winner-count">抽出人數<input id="winner-count" className="number-input" type="number" min="1" max={Math.max(1, eligible.length)} value={count} onChange={(event) => setCount(Math.max(1, Math.round(Number(event.target.value)) || 1))} /></label></div><StarBorder className="draw-button-frame"><button className="button button-blue draw-button" type="button" onClick={handleDraw} disabled={drawing}>{drawing ? "正在抽選…" : "開始抽選"}</button></StarBorder>{error && <p className="error-message" role="alert">{error}</p>}</div>
    <div className="panel panel-tinted lottery-stage-panel"><div className="panel-header"><h2>抽選轉盤</h2><span className="lottery-header-tools"><button className="lottery-theme-toggle" type="button" onClick={() => setTheme((current) => current === "wa" ? "neon" : "wa")} aria-label="切換介面主題">{theme === "wa" ? "🌙 霓虹深色" : "☀️ 淺色和風"}</button><span className="lottery-fairness">公平隨機抽選</span></span></div>
      <div className="lottery-wheel-area">
        {justRevealed && <div className="lottery-flash-winner">🎉 {justRevealed}</div>}
        <LotteryWheel ref={wheelRef} segments={displaySegments} theme={theme} />
      </div>
      {drawing && <p className="lottery-spin-hint">正在從名單中隨機抽選…</p>}
      {revealed.length > 0
        ? <div ref={winnerListRef} className="winner-list">{revealed.map((winner, index) => <div className="winner-item" key={`${winner}-${index}`}>{winner}</div>)}</div>
        : !drawing && <div className="result-empty"><strong>轉盤等待名單</strong>在左側輸入成員後，即可開始公平隨機抽選。</div>}
      {winners.length > 0 && !drawing && <div className="result-actions"><button className="button button-small button-secondary" type="button" onClick={copyResults}>{copied ? "已複製 ✓" : "複製結果"}</button><button className="button button-small button-secondary" type="button" onClick={handleDraw}>再次抽選</button></div>}
      {(previousWinners.length > 0 || history.length > 0) && <div className="history"><div className="panel-header"><h3>抽出紀錄</h3><button className="button button-small button-secondary" type="button" onClick={resetWinners}>全部重設</button></div><ol>{history.map((item, index) => <li className="animated-list-item" key={`${item.join("-")}-${index}`}>{item.join("、")}</li>)}</ol></div>}
    </div>
  </section>;
}
