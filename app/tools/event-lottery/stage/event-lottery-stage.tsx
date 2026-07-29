"use client";

import confetti from "canvas-confetti";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { createEmptyEventState, type LotteryEventState, type WinnerRecord } from "@/lib/event-lottery";
import { loadEventState, useEventLotterySync } from "../sync";
import { StageParticles } from "./stage-particles";

type StagePhase = "idle" | "prepared" | "drawing" | "revealing" | "error";

const SEQUENTIAL_STEP_MS = 1400;

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fireConfetti(finale: boolean) {
  if (reducedMotion()) return;
  confetti({ particleCount: finale ? 90 : 55, spread: finale ? 100 : 72, startVelocity: 34, ticks: 140, scalar: finale ? 1 : 0.8, origin: { y: 0.55 } });
}

/** 用 Web Audio 合成一聲短鈴聲；不內建任何外部音檔，避免授權問題。部分瀏覽器
 * 需要使用者手勢才能播放聲音，播放失敗就靜默略過，不影響畫面流程。 */
function playChime() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1318.5, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.55);
    oscillator.onended = () => { void context.close(); };
  } catch {
    /* 播放失敗（例如尚未有使用者互動）就靜默略過 */
  }
}

export function EventLotteryStage() {
  const [state, setState] = useState<LotteryEventState>(() => createEmptyEventState());
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<StagePhase>("idle");
  const [revealedIds, setRevealedIds] = useState<string[]>([]);
  const [drawingCount, setDrawingCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const winnerListRef = useRef<HTMLDivElement>(null);
  const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // START_DRAW 到揭曉動畫播完這段期間，storage 事件 fallback（其他分頁改了
  // localStorage 就會觸發）不該打斷正在播放的逐一／一次揭曉動畫。
  const isAnimatingRef = useRef(false);

  function clearRevealTimers() {
    revealTimersRef.current.forEach(clearTimeout);
    revealTimersRef.current = [];
  }

  /** 靜態還原（重新整理／收到 STATE_UPDATED）：直接依資料呈現目前畫面，不重播動畫。 */
  function applySnapshot(next: LotteryEventState) {
    isAnimatingRef.current = false;
    clearRevealTimers();
    setState(next);
    setErrorMessage("");
    if (next.activePrizeId && next.stageWinnerIds.length > 0) {
      setPhase("revealing");
      setRevealedIds(next.stageWinnerIds);
    } else if (next.activePrizeId) {
      setPhase("prepared");
      setRevealedIds([]);
    } else {
      setPhase("idle");
      setRevealedIds([]);
    }
  }

  function celebrate(soundEnabled: boolean, finale: boolean) {
    fireConfetti(finale);
    if (soundEnabled) playChime();
  }

  useEventLotterySync((message) => {
    switch (message.type) {
      case "STATE_UPDATED":
        // 動畫播放期間收到的 STATE_UPDATED 多半是 storage 事件 fallback 對同一次
        // 抽選的重複通知；先更新底層資料，畫面留給正在播放的動畫決定何時揭曉。
        if (isAnimatingRef.current) { setState(loadEventState()); break; }
        applySnapshot(loadEventState());
        break;
      case "RESET_EVENT":
      case "CLEAR_STAGE":
        applySnapshot(loadEventState());
        break;
      case "PREPARE_PRIZE":
        isAnimatingRef.current = false;
        setState(loadEventState());
        clearRevealTimers();
        setErrorMessage("");
        setPhase("prepared");
        setRevealedIds([]);
        break;
      case "START_DRAW":
        isAnimatingRef.current = true;
        setState(loadEventState());
        clearRevealTimers();
        setErrorMessage("");
        setDrawingCount(message.count);
        setPhase("drawing");
        setRevealedIds([]);
        break;
      case "DRAW_RESULT": {
        const next = loadEventState();
        setState(next);
        clearRevealTimers();
        setPhase("revealing");
        const winners = message.winners;
        if (message.revealMode === "simultaneous" || winners.length <= 1) {
          setRevealedIds(winners.map((winner) => winner.id));
          celebrate(message.soundEnabled, true);
          isAnimatingRef.current = false;
        } else {
          winners.forEach((winner, index) => {
            const timer = setTimeout(() => {
              setRevealedIds((current) => [...current, winner.id]);
              celebrate(message.soundEnabled, index === winners.length - 1);
              if (index === winners.length - 1) isAnimatingRef.current = false;
            }, index * SEQUENTIAL_STEP_MS);
            revealTimersRef.current.push(timer);
          });
        }
        break;
      }
      case "DISQUALIFY_WINNER":
        setState(loadEventState());
        break;
      case "DRAW_ERROR":
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        setErrorMessage(message.message);
        setPhase("error");
        errorTimerRef.current = setTimeout(() => setPhase("prepared"), 4000);
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    // 還原舞台目前狀態需要一次性的 client hydration。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applySnapshot(loadEventState());
    setHydrated(true);
    return () => {
      clearRevealTimers();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onFullscreenChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (revealedIds.length === 0 || !winnerListRef.current) return;
    const last = winnerListRef.current.lastElementChild;
    if (last && !reducedMotion()) {
      gsap.fromTo(last, { opacity: 0, y: 26, scale: 0.75, rotate: -4 }, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 0.65, ease: "back.out(2.1)" });
    }
  }, [revealedIds]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      /* 不支援全螢幕就維持原樣 */
    }
  }

  if (!hydrated) return <div className="event-lottery-stage-loading" aria-hidden="true" />;

  const activePrize = state.prizes.find((prize) => prize.id === state.activePrizeId) ?? null;
  const revealedWinners: WinnerRecord[] = revealedIds
    .map((id) => state.winners.find((winner) => winner.id === id))
    .filter((winner): winner is WinnerRecord => Boolean(winner));
  const hasBackground = Boolean(state.backgroundImageDataUrl);

  return (
    <div
      ref={stageRef}
      className={`event-lottery-stage${hasBackground ? " event-lottery-stage-has-image" : ""}`}
      style={hasBackground ? { backgroundImage: `url(${state.backgroundImageDataUrl})` } : undefined}
      aria-label="活動抽獎舞台展示"
    >
      {!hasBackground && <StageParticles />}
      <div className="event-lottery-stage-scrim" aria-hidden="true" />

      <button className="event-lottery-stage-fullscreen" type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "離開全螢幕" : "全螢幕顯示"}>
        {isFullscreen ? "⤡" : "⤢"}
      </button>

      <header className="event-lottery-stage-header">
        <h1>{state.eventTitle}</h1>
      </header>

      <main className="event-lottery-stage-main">
        {phase === "idle" && <p className="event-lottery-stage-idle">等待控制台準備抽獎…</p>}

        {phase === "error" && <p className="event-lottery-stage-error">{errorMessage}</p>}

        {(phase === "prepared" || phase === "drawing") && activePrize && (
          <div className="event-lottery-stage-prize">
            {activePrize.imageDataUrl && <img className="event-lottery-stage-prize-image" src={activePrize.imageDataUrl} alt="" />}
            <h2>{activePrize.name}</h2>
            {phase === "drawing"
              ? <p className="event-lottery-stage-spin">抽選中…{drawingCount > 1 ? `（${drawingCount} 位）` : ""}<span className="event-lottery-stage-spin-ring" aria-hidden="true" /></p>
              : <p className="event-lottery-stage-waiting">即將開始抽選</p>}
          </div>
        )}

        {phase === "revealing" && activePrize && (
          <div className="event-lottery-stage-reveal">
            {activePrize.imageDataUrl && <img className="event-lottery-stage-prize-image" src={activePrize.imageDataUrl} alt="" />}
            <h2>{activePrize.name}</h2>
            <div ref={winnerListRef} className="event-lottery-stage-winner-list">
              {revealedWinners.map((winner) => (
                <div className={`event-lottery-stage-winner-card${winner.disqualified ? " event-lottery-stage-winner-disqualified" : ""}`} key={winner.id}>
                  <span className="event-lottery-stage-winner-name">{winner.participantName}</span>
                  {(winner.employeeId || winner.department) && (
                    <span className="event-lottery-stage-winner-meta">{[winner.employeeId, winner.department].filter(Boolean).join(" · ")}</span>
                  )}
                  {winner.disqualified && <span className="event-lottery-stage-winner-tag">已失格</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
