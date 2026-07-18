"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TIMER_MS, clampTimerMs, formatClock, isWarningZone } from "@/lib/timer";

const STORAGE_KEY = "toolverse:countdown-timer:v1";
const PRESETS = [
  { label: "1 分鐘", ms: 60_000 },
  { label: "3 分鐘", ms: 180_000 },
  { label: "5 分鐘", ms: 300_000 },
  { label: "10 分鐘", ms: 600_000 },
] as const;

type Phase = "idle" | "running" | "paused" | "finished";

function sanitizeDuration(value: unknown) {
  const parsed = clampTimerMs(Number(value));
  return parsed >= 1000 ? parsed : 300_000;
}

/** 用 WebAudio 發兩短一長的提示音；失敗（未互動、無權限）就靜默略過。 */
function playFinishSound() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    [0, 0.25, 0.5].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.value = index === 2 ? 660 : 880;
      const start = context.currentTime + offset;
      const length = index === 2 ? 0.45 : 0.15;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      oscillator.start(start);
      oscillator.stop(start + length + 0.05);
    });
    window.setTimeout(() => { void context.close(); }, 1600);
  } catch { /* 提示音失敗不影響計時 */ }
}

export function CountdownTimerTool() {
  const [totalMs, setTotalMs] = useState(300_000);
  const [remainingMs, setRemainingMs] = useState(300_000);
  const [phase, setPhase] = useState<Phase>("idle");
  const [soundOn, setSoundOn] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const endAtRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as Record<string, unknown>;
        // 還原上次使用的時長需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTotalMs(sanitizeDuration(data.totalMs)); setRemainingMs(sanitizeDuration(data.totalMs)); setSoundOn(data.soundOn !== false);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ totalMs, soundOn }));
  }, [hydrated, totalMs, soundOn]);

  // 以結束時間戳計算剩餘，interval 只負責重繪 — 背景分頁或節流也不會不準。
  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const left = Math.max(0, endAtRef.current - Date.now());
      setRemainingMs(left);
      if (left <= 0) {
        setPhase("finished");
        if (soundOn) playFinishSound();
      }
    };
    tick();
    const interval = window.setInterval(tick, 200);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [phase, soundOn]);

  useEffect(() => {
    const original = document.title;
    if (phase === "running" || phase === "paused") document.title = `${formatClock(remainingMs)}｜倒數計時`;
    else if (phase === "finished") document.title = "時間到！｜倒數計時";
    return () => { document.title = original; };
  }, [phase, remainingMs]);

  function applyDuration(ms: number) {
    const clamped = sanitizeDuration(ms);
    setTotalMs(clamped);
    setRemainingMs(clamped);
    setPhase("idle");
  }

  function start() {
    const base = phase === "paused" ? remainingMs : totalMs;
    if (base <= 0) return;
    endAtRef.current = Date.now() + base;
    setPhase("running");
  }

  function pause() {
    setRemainingMs(Math.max(0, endAtRef.current - Date.now()));
    setPhase("paused");
  }

  function reset() {
    setPhase("idle");
    setRemainingMs(totalMs);
  }

  function adjustMinutes(delta: number) {
    applyDuration(clampTimerMs(totalMs + delta * 60_000));
  }

  async function toggleFullscreen() {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch { /* 不支援全螢幕就維持原樣 */ }
  }

  const warning = phase === "running" && isWarningZone(remainingMs, totalMs);
  const display = formatClock(phase === "idle" ? totalMs : remainingMs);
  const minutesTotal = Math.round(totalMs / 60_000);

  return <section className="workspace timer-workspace page-shell" aria-label="倒數計時器">
    <div className="panel timer-controls">
      <div className="panel-header"><h2>設定時間</h2><span className="panel-meta">最長 99:59</span></div>
      <div className="timer-presets">
        {PRESETS.map((preset) => (
          <button key={preset.ms} type="button" className={`button button-small ${totalMs === preset.ms ? "button-blue" : "button-secondary"}`} onClick={() => applyDuration(preset.ms)} disabled={phase === "running"}>{preset.label}</button>
        ))}
      </div>
      <div className="timer-custom">
        <button className="button button-small button-secondary" type="button" onClick={() => adjustMinutes(-1)} disabled={phase === "running" || totalMs <= 60_000} aria-label="減少一分鐘">−1 分</button>
        <span className="timer-custom-value">{minutesTotal} 分鐘</span>
        <button className="button button-small button-secondary" type="button" onClick={() => adjustMinutes(1)} disabled={phase === "running" || totalMs >= MAX_TIMER_MS - 59_000} aria-label="增加一分鐘">＋1 分</button>
      </div>
      <label className="check-row timer-sound"><input type="checkbox" checked={soundOn} onChange={(event) => setSoundOn(event.target.checked)} />結束時播放提示音</label>
      <p className="key-note">計時以系統時間為準，切到其他分頁或螢幕休眠也不會漏秒；分頁標題會同步顯示剩餘時間。</p>
    </div>
    <div className="panel panel-tinted timer-stage-panel">
      <div ref={stageRef} className={`timer-stage${warning ? " timer-warning" : ""}${phase === "finished" ? " timer-finished" : ""}`}>
        <output className="timer-display" aria-live="polite">{phase === "finished" ? "時間到" : display}</output>
        <div className="timer-actions">
          {phase === "running"
            ? <button className="button button-coral" type="button" onClick={pause}>暫停</button>
            : <button className="button button-blue" type="button" onClick={start} disabled={phase === "finished" && totalMs <= 0}>{phase === "paused" ? "繼續" : phase === "finished" ? "再來一次" : "開始"}</button>}
          {phase === "finished"
            ? <button className="button button-secondary" type="button" onClick={reset}>重設</button>
            : (phase !== "idle" && <button className="button button-secondary" type="button" onClick={reset}>重設</button>)}
          <button className="button button-secondary" type="button" onClick={toggleFullscreen}>全螢幕</button>
        </div>
      </div>
    </div>
  </section>;
}
