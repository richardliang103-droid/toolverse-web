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

type Segment = { label: string; minutes: number };

function sanitizeSegments(value: unknown): Segment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      label: typeof item.label === "string" ? item.label.slice(0, 20) : "",
      minutes: Number.isFinite(Number(item.minutes)) ? Math.min(Math.max(Math.round(Number(item.minutes)), 1), 99) : 1,
    }))
    .slice(0, 8);
}

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
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segmentIndex, setSegmentIndex] = useState(0);
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
        setTotalMs(sanitizeDuration(data.totalMs)); setRemainingMs(sanitizeDuration(data.totalMs)); setSoundOn(data.soundOn !== false); setSegments(sanitizeSegments(data.segments));
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ totalMs, soundOn, segments }));
  }, [hydrated, totalMs, soundOn, segments]);

  // 以結束時間戳計算剩餘，interval 只負責重繪 — 背景分頁或節流也不會不準。
  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const left = Math.max(0, endAtRef.current - Date.now());
      setRemainingMs(left);
      if (left <= 0) {
        if (segments.length > 0 && segmentIndex < segments.length - 1) {
          // 進入下一段：以「上一段理論結束時間」為基準，多段總長不漂移。
          const next = segments[segmentIndex + 1];
          endAtRef.current += next.minutes * 60_000;
          setSegmentIndex(segmentIndex + 1);
          setRemainingMs(Math.max(0, endAtRef.current - Date.now()));
          if (soundOn) playFinishSound();
          return;
        }
        setPhase("finished");
        if (soundOn) playFinishSound();
      }
    };
    tick();
    const interval = window.setInterval(tick, 200);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [phase, soundOn, segments, segmentIndex]);

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
    if (phase === "paused") {
      endAtRef.current = Date.now() + remainingMs;
      setPhase("running");
      return;
    }
    if (segments.length > 0) {
      setSegmentIndex(0);
      endAtRef.current = Date.now() + segments[0].minutes * 60_000;
    } else {
      if (totalMs <= 0) return;
      endAtRef.current = Date.now() + totalMs;
    }
    setPhase("running");
  }

  function pause() {
    setRemainingMs(Math.max(0, endAtRef.current - Date.now()));
    setPhase("paused");
  }

  function reset() {
    setPhase("idle");
    setSegmentIndex(0);
    setRemainingMs(segments.length > 0 ? segments[0].minutes * 60_000 : totalMs);
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

  const segmentTotalMs = segments.length > 0 ? segments[Math.min(segmentIndex, segments.length - 1)].minutes * 60_000 : totalMs;
  const warning = phase === "running" && isWarningZone(remainingMs, segmentTotalMs);
  const display = formatClock(phase === "idle" ? (segments.length > 0 ? segments[0].minutes * 60_000 : totalMs) : remainingMs);
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
      <details className="timer-segments" open={segments.length > 0}>
        <summary>多段模式{segments.length > 0 ? `（${segments.length} 段）` : "（選用）"}</summary>
        {segments.map((segment, index) => (
          <div className="timer-segment-row" key={index}>
            <input className="key-input" aria-label={`第 ${index + 1} 段名稱`} placeholder={`第 ${index + 1} 段`} maxLength={20} value={segment.label} disabled={phase === "running"} onChange={(event) => setSegments((previous) => previous.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)))} />
            <input className="number-input" aria-label={`第 ${index + 1} 段分鐘數`} type="number" min={1} max={99} value={segment.minutes} disabled={phase === "running"} onChange={(event) => setSegments((previous) => previous.map((item, at) => (at === index ? { ...item, minutes: Math.min(Math.max(Math.round(Number(event.target.value)) || 1, 1), 99) } : item)))} />
            <span className="timer-segment-unit">分</span>
            <button className="gantt-row-delete" type="button" aria-label={`刪除第 ${index + 1} 段`} disabled={phase === "running"} onClick={() => setSegments((previous) => previous.filter((_, at) => at !== index))}>✕</button>
          </div>
        ))}
        <button className="button button-small button-secondary" type="button" disabled={phase === "running" || segments.length >= 8} onClick={() => setSegments((previous) => [...previous, { label: "", minutes: 3 }])}>＋ 加一段</button>
        {segments.length > 0 && <p className="key-note">每段結束會響提示音並自動接續下一段；單段的快速預設此時不生效。</p>}
      </details>
      <label className="check-row timer-sound"><input type="checkbox" checked={soundOn} onChange={(event) => setSoundOn(event.target.checked)} />結束時播放提示音</label>
      <p className="key-note">計時以系統時間為準，切到其他分頁或螢幕休眠也不會漏秒；分頁標題會同步顯示剩餘時間。</p>
    </div>
    <div className="panel panel-tinted timer-stage-panel">
      <div ref={stageRef} className={`timer-stage${warning ? " timer-warning" : ""}${phase === "finished" ? " timer-finished" : ""}`}>
        {segments.length > 0 && phase !== "idle" && phase !== "finished" && (
          <div className="timer-segment-indicator">{segments[segmentIndex].label || `第 ${segmentIndex + 1} 段`}（{segmentIndex + 1}/{segments.length}）</div>
        )}
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
