"use client";

import confetti from "canvas-confetti";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { createEmptyEventState, resolveStageDisplay, type LotteryEventState, type PendingReveal } from "@/lib/event-lottery";
import { loadEventState, useEventLotterySync } from "../sync";
import { StageParticles } from "./stage-particles";

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

function celebrate(soundEnabled: boolean, finale: boolean) {
  fireConfetti(finale);
  if (soundEnabled) playChime();
}

export function EventLotteryStage() {
  const [state, setState] = useState<LotteryEventState>(() => createEmptyEventState());
  const [hydrated, setHydrated] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [displayedWinnerIds, setDisplayedWinnerIds] = useState<string[]>([]);
  const [transientError, setTransientError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const winnerListRef = useRef<HTMLDivElement>(null);
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 這一輪抽選（用 drawId 識別）如果曾經被觀察到處於「抽選中」倒數階段，代表這個
  // 分頁是全程在場的——揭曉那一刻要播動畫、放彩帶、出聲音。如果分頁是在 revealAt
  // 已經過了之後才打開或重新整理（例如舞台分頁被關掉又重開），就直接靜靜顯示最終
  // 結果，不會突然把已經播過的動畫或音效再放一次。
  const seenDrawingRef = useRef(new Set<string>());
  const animatedDrawIdsRef = useRef(new Set<string>());

  function clearStaggerTimers() {
    staggerTimersRef.current.forEach(clearTimeout);
    staggerTimersRef.current = [];
  }

  // 舞台這一刻該顯示什麼，純粹是「目前狀態 + 現在幾點」的函式；不管是剛收到
  // 廣播、重新整理，還是很久以後才打開分頁，算出來的結果都一樣。
  const display = resolveStageDisplay(state, new Date(nowTick));

  useEventLotterySync((message) => {
    if (message.type === "DRAW_ERROR") {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      setTransientError(message.message);
      errorTimerRef.current = setTimeout(() => setTransientError(""), 4000);
      return;
    }
    setTransientError("");
    setState(loadEventState());
  });

  useEffect(() => {
    // 還原舞台目前狀態需要一次性的 client hydration。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadEventState());
    setHydrated(true);
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); };
  }, []);

  // 倒數期間才需要每隔一小段時間重新計算一次「揭曉時間到了沒」；其餘時候完全不跑計時器。
  useEffect(() => {
    if (display.phase !== "drawing") return;
    const interval = setInterval(() => setNowTick(Date.now()), 200);
    return () => clearInterval(interval);
  }, [display.phase, state.pendingReveal?.drawId, state.pendingReveal?.revealAt]);

  useEffect(() => {
    if (display.phase === "drawing") seenDrawingRef.current.add(display.pendingReveal.drawId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.phase, state.pendingReveal?.drawId]);

  // 揭曉那一刻要不要播動畫、要顯示哪些得獎者，每個 drawId 只處理一次；離開「已揭曉」
  // 狀態（準備下一輪、清除舞台）時要把上一輪顯示的得獎者清空，這是跟外部狀態同步、
  // 不是可以挪到 render 階段算的衍生值，所以刻意在 effect 裡呼叫 setState。
  useEffect(() => {
    if (display.phase !== "revealed") {
      clearStaggerTimers();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayedWinnerIds([]);
      return undefined;
    }
    const pending: PendingReveal = display.pendingReveal;
    if (animatedDrawIdsRef.current.has(pending.drawId)) return undefined;
    animatedDrawIdsRef.current.add(pending.drawId);
    clearStaggerTimers();

    const playAnimation = seenDrawingRef.current.has(pending.drawId);
    if (!playAnimation || pending.revealMode === "simultaneous" || pending.winnerIds.length <= 1) {
      setDisplayedWinnerIds(pending.winnerIds);
      if (playAnimation) celebrate(pending.soundEnabled, true);
      return undefined;
    }
    pending.winnerIds.forEach((id, index) => {
      const timer = setTimeout(() => {
        setDisplayedWinnerIds((current) => [...current, id]);
        celebrate(pending.soundEnabled, index === pending.winnerIds.length - 1);
      }, index * pending.stepMs);
      staggerTimersRef.current.push(timer);
    });
    return clearStaggerTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.phase, state.pendingReveal?.drawId]);

  useEffect(() => {
    function onFullscreenChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (displayedWinnerIds.length === 0 || !winnerListRef.current) return;
    const last = winnerListRef.current.lastElementChild;
    if (last && !reducedMotion()) {
      gsap.fromTo(last, { opacity: 0, y: 26, scale: 0.75, rotate: -4 }, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 0.65, ease: "back.out(2.1)" });
    }
  }, [displayedWinnerIds]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      /* 不支援全螢幕就維持原樣 */
    }
  }

  if (!hydrated) return <div className="event-lottery-stage-loading" aria-hidden="true" />;

  const activePrize = display.phase === "idle" ? null : state.prizes.find((prize) => prize.id === display.prizeId) ?? null;
  const revealedWinners = displayedWinnerIds
    .map((id) => state.winners.find((winner) => winner.id === id))
    .filter((winner): winner is NonNullable<typeof winner> => Boolean(winner));
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
        {transientError && <p className="event-lottery-stage-error">{transientError}</p>}

        {!transientError && display.phase === "idle" && <p className="event-lottery-stage-idle">等待控制台準備抽獎…</p>}

        {!transientError && (display.phase === "prepared" || display.phase === "drawing") && activePrize && (
          <div className="event-lottery-stage-prize">
            {activePrize.imageDataUrl && <img className="event-lottery-stage-prize-image" src={activePrize.imageDataUrl} alt="" />}
            <h2>{activePrize.name}</h2>
            {display.phase === "drawing"
              ? <p className="event-lottery-stage-spin">抽選中…{display.pendingReveal.winnerIds.length > 1 ? `（${display.pendingReveal.winnerIds.length} 位）` : ""}<span className="event-lottery-stage-spin-ring" aria-hidden="true" /></p>
              : <p className="event-lottery-stage-waiting">即將開始抽選</p>}
          </div>
        )}

        {!transientError && display.phase === "revealed" && activePrize && (
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
