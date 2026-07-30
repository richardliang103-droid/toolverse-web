"use client";

import { useEffect, useRef, useState, type WheelEvent } from "react";
import { MAX_TIMER_MS, clampTimerMs, computeLaps, formatClock, formatStopwatch, isWarningZone } from "@/lib/timer";

const STORAGE_KEY = "toolverse:countdown-timer:v1";
const PRESETS = [
  { label: "1 分鐘", ms: 60_000 },
  { label: "3 分鐘", ms: 180_000 },
  { label: "5 分鐘", ms: 300_000 },
  { label: "10 分鐘", ms: 600_000 },
] as const;

type Phase = "idle" | "running" | "paused" | "finished";

type TimerMode = "countdown" | "stopwatch" | "clock";

const MODES: Array<{ id: TimerMode; label: string }> = [
  { id: "countdown", label: "倒數" },
  { id: "stopwatch", label: "碼表" },
  { id: "clock", label: "時鐘" },
];

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
  const [mode, setMode] = useState<TimerMode>("countdown");
  const [stopwatchMs, setStopwatchMs] = useState(0);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const [clockNow, setClockNow] = useState({ time: "", date: "" });
  const [minutesDraft, setMinutesDraft] = useState(() => String(Math.round(totalMs / 60_000)));
  // 記錄「草稿字串上一次同步時對應的 totalMs」，好在 render 期間比對是否要
  // 重新同步——這是 React 官方建議「依外部狀態調整某個 state」的寫法：
  // 直接在 render body 呼叫 setState（React 會在提交前重新渲染，不會閃爍），
  // 不需要 useEffect（也因此不會觸發 react-hooks/set-state-in-effect）。
  const [syncedTotalMs, setSyncedTotalMs] = useState(totalMs);
  if (totalMs !== syncedTotalMs) {
    setSyncedTotalMs(totalMs);
    setMinutesDraft(String(Math.round(totalMs / 60_000)));
  }
  const stageRef = useRef<HTMLDivElement>(null);
  const endAtRef = useRef(0);
  const stopwatchBaseRef = useRef(0);
  const stopwatchStartedRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as Record<string, unknown>;
        // 還原上次使用的時長需要一次性的 client hydration。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTotalMs(sanitizeDuration(data.totalMs)); setRemainingMs(sanitizeDuration(data.totalMs)); setSoundOn(data.soundOn !== false); setSegments(sanitizeSegments(data.segments)); setMode(data.mode === "stopwatch" || data.mode === "clock" ? data.mode : "countdown");
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
     
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify({ totalMs, soundOn, segments, mode }));
  }, [hydrated, totalMs, soundOn, segments, mode]);

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

  // 碼表同樣以絕對時間戳累計，interval 只負責重繪，分頁節流不影響準確度。
  // 顯示到百分之一秒，重繪間隔比倒數計時短，數字才不會卡格跳動。
  useEffect(() => {
    if (mode !== "stopwatch" || !stopwatchRunning) return;
    const tick = () => setStopwatchMs(stopwatchBaseRef.current + Date.now() - stopwatchStartedRef.current);
    tick();
    const interval = window.setInterval(tick, 30);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [mode, stopwatchRunning]);

  useEffect(() => {
    if (mode !== "clock") return;
    const tick = () => {
      const now = new Date();
      setClockNow({
        time: now.toLocaleTimeString("zh-TW", { hour12: false }),
        date: now.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" }),
      });
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [mode]);

  // 倒數／碼表進行中與大字時鐘都是「擺著給人看」的情境，使用者不會碰裝置，
  // 沒有 wake lock 螢幕就會自己睡著。分頁切走時瀏覽器一定會釋放，
  // 回到前景要重新取得，所以同時聽 visibilitychange。
  useEffect(() => {
    const keepAwake = mode === "clock" || (mode === "stopwatch" && stopwatchRunning) || (mode === "countdown" && phase === "running");
    if (!keepAwake || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== "visible") return;
      try {
        const granted = await navigator.wakeLock.request("screen");
        if (cancelled) { void granted.release(); return; }
        sentinel = granted;
        // 瀏覽器自動釋放（切分頁、低電量）時把參照清掉，回前景才會重新取得。
        granted.addEventListener("release", () => { sentinel = null; });
      } catch { /* 使用者拒絕或裝置不允許：照常計時，只是螢幕可能會暗 */ }
    };

    void acquire();
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
    };
  }, [mode, phase, stopwatchRunning]);

  useEffect(() => {
    const original = document.title;
    if (mode !== "countdown") { document.title = original; return () => { document.title = original; }; }
    if (phase === "running" || phase === "paused") document.title = `${formatClock(remainingMs)}｜倒數計時`;
    else if (phase === "finished") document.title = "時間到！｜倒數計時";
    return () => { document.title = original; };
  }, [mode, phase, remainingMs]);

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

  /** 分鐘輸入框的 blur／Enter 提交：把草稿字串解析成分鐘數，無效輸入就還原顯示。 */
  function commitMinutesDraft() {
    const parsed = Math.round(Number(minutesDraft));
    if (Number.isFinite(parsed) && parsed > 0) applyDuration(parsed * 60_000);
    else setMinutesDraft(String(Math.round(totalMs / 60_000)));
  }

  /** 滑鼠滾輪調整分鐘數；停用時放行讓頁面照常捲動。 */
  function onMinutesWheel(event: WheelEvent<HTMLInputElement>) {
    if (countdownActive) return;
    event.preventDefault();
    adjustMinutes(event.deltaY < 0 ? 1 : -1);
  }

  function stopwatchStart() {
    stopwatchStartedRef.current = Date.now();
    setStopwatchRunning(true);
  }

  function stopwatchPause() {
    stopwatchBaseRef.current = stopwatchBaseRef.current + Date.now() - stopwatchStartedRef.current;
    setStopwatchRunning(false);
  }

  function stopwatchReset() {
    stopwatchBaseRef.current = 0;
    setStopwatchRunning(false);
    setStopwatchMs(0);
    setLaps([]);
  }

  /** 記一圈：存當下的累計時間，單圈耗時與最快／最慢由 computeLaps 從這份累計清單算出。 */
  function recordLap() {
    setLaps((previous) => [...previous, stopwatchMs]);
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
  const countdownActive = phase === "running" || phase === "paused";
  const { laps: lapRows, fastestIndex, slowestIndex } = computeLaps(laps);

  return <section className="workspace timer-workspace page-shell" aria-label="倒數計時器">
    <div className="panel timer-controls">
      <div className="panel-header"><h2>設定時間</h2><span className="panel-meta">{mode === "countdown" ? "最長 99:59" : mode === "stopwatch" ? "正計時" : "現在時刻"}</span></div>
      <div className="flow-mode-toggle" role="group" aria-label="計時模式">
        {MODES.map((item) => (
          <button key={item.id} type="button" className={`button button-small ${mode === item.id ? "button-blue" : "button-secondary"}`} aria-pressed={mode === item.id} onClick={() => setMode(item.id)} disabled={countdownActive || stopwatchRunning}>{item.label}</button>
        ))}
      </div>
      {mode === "stopwatch" && <>
        <p className="key-note">碼表從 00:00.00 開始正計時，精確到百分之一秒，適合演講、比賽或紀錄工作時間；超過一小時自動顯示小時位。進行中可以按「分圈」多圈累計計時，切分頁或螢幕休眠都不影響準確度。</p>
        {lapRows.length > 0 && (
          <ul className="timer-lap-list" aria-label="分圈紀錄">
            {[...lapRows].reverse().map((lap) => (
              <li
                key={lap.index}
                className={`timer-lap-row${lap.index - 1 === fastestIndex ? " timer-lap-fastest" : ""}${lap.index - 1 === slowestIndex ? " timer-lap-slowest" : ""}`}
              >
                <span className="timer-lap-index">第 {lap.index} 圈</span>
                <span className="timer-lap-split">{formatStopwatch(lap.lapMs)}</span>
                <span className="timer-lap-total">累計 {formatStopwatch(lap.totalMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </>}
      {mode === "clock" && <p className="key-note">全螢幕大字時鐘，適合活動現場或講台上看時間；跟隨你裝置的系統時間，顯示期間螢幕不會自動休眠。</p>}
      {mode === "countdown" && <><div className="timer-presets">
        {PRESETS.map((preset) => (
          <button key={preset.ms} type="button" className={`button button-small ${totalMs === preset.ms ? "button-blue" : "button-secondary"}`} onClick={() => applyDuration(preset.ms)} disabled={countdownActive}>{preset.label}</button>
        ))}
      </div>
      <div className="timer-custom">
        <button className="button button-small button-secondary" type="button" onClick={() => adjustMinutes(-1)} disabled={countdownActive || totalMs <= 60_000} aria-label="減少一分鐘">−1 分</button>
        <input
          className="number-input timer-custom-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          value={minutesDraft}
          disabled={countdownActive}
          aria-label="分鐘數，可直接輸入或用滾輪調整"
          onChange={(event) => setMinutesDraft(event.target.value)}
          onBlur={commitMinutesDraft}
          onKeyDown={(event) => { if (event.key === "Enter") { commitMinutesDraft(); event.currentTarget.blur(); } }}
          onWheel={onMinutesWheel}
        />
        <span className="timer-custom-unit">分鐘</span>
        <button className="button button-small button-secondary" type="button" onClick={() => adjustMinutes(1)} disabled={countdownActive || totalMs >= MAX_TIMER_MS - 59_000} aria-label="增加一分鐘">＋1 分</button>
      </div>
      <p className="key-note timer-input-hint">也可以直接輸入分鐘數，或把滑鼠移到數字上用滾輪調整。</p>
      <details className="timer-segments" open={segments.length > 0}>
        <summary>多段模式{segments.length > 0 ? `（${segments.length} 段）` : "（選用）"}</summary>
        {segments.map((segment, index) => (
          <div className="timer-segment-row" key={index}>
            <input className="key-input" aria-label={`第 ${index + 1} 段名稱`} placeholder={`第 ${index + 1} 段`} maxLength={20} value={segment.label} disabled={countdownActive} onChange={(event) => setSegments((previous) => previous.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)))} />
            <input
              className="number-input"
              aria-label={`第 ${index + 1} 段分鐘數，可直接輸入或用滾輪調整`}
              type="number"
              min={1}
              max={99}
              value={segment.minutes}
              disabled={countdownActive}
              onChange={(event) => setSegments((previous) => previous.map((item, at) => (at === index ? { ...item, minutes: Math.min(Math.max(Math.round(Number(event.target.value)) || 1, 1), 99) } : item)))}
              onWheel={(event) => {
                if (countdownActive) return;
                event.preventDefault();
                const delta = event.deltaY < 0 ? 1 : -1;
                setSegments((previous) => previous.map((item, at) => (at === index ? { ...item, minutes: Math.min(Math.max(item.minutes + delta, 1), 99) } : item)));
              }}
            />
            <span className="timer-segment-unit">分</span>
            <button className="gantt-row-delete" type="button" aria-label={`刪除第 ${index + 1} 段`} disabled={countdownActive} onClick={() => setSegments((previous) => previous.filter((_, at) => at !== index))}>✕</button>
          </div>
        ))}
        <button className="button button-small button-secondary" type="button" disabled={countdownActive || segments.length >= 8} onClick={() => setSegments((previous) => [...previous, { label: "", minutes: 3 }])}>＋ 加一段</button>
        {segments.length > 0 && <p className="key-note">每段結束會響提示音並自動接續下一段；單段的快速預設此時不生效。</p>}
      </details>
      <label className="check-row timer-sound"><input type="checkbox" checked={soundOn} onChange={(event) => setSoundOn(event.target.checked)} />結束時播放提示音</label>
      <p className="key-note">倒數進行中會請瀏覽器不要讓螢幕自動休眠。計時以系統時間為準，切到其他分頁也不會漏秒；分頁標題會同步顯示剩餘時間。</p></>}
    </div>
    <div className="panel panel-tinted timer-stage-panel">
      <div ref={stageRef} className={`timer-stage${mode === "countdown" && warning ? " timer-warning" : ""}${mode === "countdown" && phase === "finished" ? " timer-finished" : ""}`}>
        {mode === "countdown" && segments.length > 0 && phase !== "idle" && phase !== "finished" && (
          <div className="timer-segment-indicator">{segments[segmentIndex].label || `第 ${segmentIndex + 1} 段`}（{segmentIndex + 1}/{segments.length}）</div>
        )}
        {mode === "clock" && clockNow.date && <div className="timer-segment-indicator">{clockNow.date}</div>}
        {(() => {
          const stageText = mode === "stopwatch" ? formatStopwatch(stopwatchMs) : mode === "clock" ? (clockNow.time || "--:--:--") : phase === "finished" ? "時間到" : display;
          // 時鐘（HH:MM:SS）與碼表（含百分之一秒，MM:SS.cc 起跳）都是 7 字以上，
          // 用較小的字級避免爆出舞台；倒數的 MM:SS 只有 5 字，維持原本大字級。
          return <output className={`timer-display${stageText.length > 5 ? " timer-display-long" : ""}`} aria-live="polite">{stageText}</output>;
        })()}
        <div className="timer-actions">
          {mode === "countdown" && (phase === "running"
            ? <button className="button button-coral" type="button" onClick={pause}>暫停</button>
            : <button className="button button-blue" type="button" onClick={start} disabled={phase === "finished" && totalMs <= 0}>{phase === "paused" ? "繼續" : phase === "finished" ? "再來一次" : "開始"}</button>)}
          {mode === "countdown" && phase !== "idle" && <button className="button button-secondary" type="button" onClick={reset}>重設</button>}
          {mode === "stopwatch" && (stopwatchRunning
            ? <button className="button button-coral" type="button" onClick={stopwatchPause}>暫停</button>
            : <button className="button button-blue" type="button" onClick={stopwatchStart}>{stopwatchMs > 0 ? "繼續" : "開始"}</button>)}
          {mode === "stopwatch" && stopwatchRunning && <button className="button button-secondary" type="button" onClick={recordLap}>分圈</button>}
          {mode === "stopwatch" && stopwatchMs > 0 && !stopwatchRunning && <button className="button button-secondary" type="button" onClick={stopwatchReset}>歸零</button>}
          <button className="button button-secondary" type="button" onClick={toggleFullscreen}>全螢幕</button>
        </div>
      </div>
    </div>
  </section>;
}
