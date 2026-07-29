"use client";

import confetti from "canvas-confetti";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { createEmptyEventState, pendingRevealCompleteAt, resolveStageAdvance, resolveStageDisplay, visibleWinnerCount, type LotteryEventState, type PendingReveal } from "@/lib/event-lottery";
import {
  buildHostStatus,
  commitAcceptedCommand,
  createRemoteCommandLog,
  EVENT_LOTTERY_REMOTE_STORAGE_KEY,
  HOST_STATUS_HEARTBEAT_MS,
  remoteCommandLogStorageKey,
  resolveIncomingCommand,
  sanitizeRemoteCommandLog,
  sanitizeStoredRemoteSessionPointer,
  type RemoteCommandLog,
  type StoredRemoteSessionPointer,
} from "@/lib/event-lottery-remote";
import { connectRemoteChannel, type RemoteChannelHandle } from "@/lib/event-lottery-remote-channel";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";
import type { RemoteMessage } from "@/lib/event-lottery-remote-types";
import { clearStageAction, prepareStage, startDraw } from "../actions";
import { loadEventState, useEventLotterySync } from "../sync";
import { StageParticles } from "./stage-particles";

/** 單輪超過這個人數時，只在第一位與最後一位放彩帶／出聲音，避免上百人逐一揭曉時
 *  變成連續轟炸的彩帶與音效。 */
const CELEBRATE_ALL_THRESHOLD = 30;

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fireConfetti(finale: boolean) {
  if (reducedMotion()) return;
  confetti({ particleCount: finale ? 90 : 55, spread: finale ? 100 : 72, startVelocity: 34, ticks: 140, scalar: finale ? 1 : 0.8, origin: { y: 0.55 } });
}

type AudioContextLike = AudioContext;

/** 整個舞台分頁共用同一個 AudioContext，不要每位得獎者都新建一個——單輪抽出
 *  上百人時，重複建立／關閉 AudioContext 本身就會造成明顯的音訊卡頓。 */
function getSharedAudioContext(ref: React.MutableRefObject<AudioContextLike | null>): AudioContextLike | null {
  if (ref.current) return ref.current;
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    ref.current = new AudioContextClass();
    return ref.current;
  } catch {
    return null;
  }
}

/** 用 Web Audio 合成一聲短鈴聲；不內建任何外部音檔，避免授權問題。部分瀏覽器
 * 需要使用者手勢才能播放聲音，播放失敗就靜默略過，不影響畫面流程。 */
function playChime(context: AudioContextLike) {
  try {
    if (context.state === "suspended") void context.resume();
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
  } catch {
    /* 播放失敗（例如尚未有使用者互動）就靜默略過 */
  }
}

export function EventLotteryStage() {
  const [state, setState] = useState<LotteryEventState>(() => createEmptyEventState());
  const [hydrated, setHydrated] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [transientError, setTransientError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const winnerListRef = useRef<HTMLDivElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContextLike | null>(null);
  // 這一輪抽選（用 drawId 識別）如果曾經被觀察到處於「抽選中」倒數階段，代表這個
  // 分頁是全程在場的——揭曉過程要播動畫、放彩帶、出聲音。如果分頁是在揭曉開始後
  // 才打開或重新整理（例如舞台分頁被關掉又重開），就直接靜靜顯示目前該有的進度，
  // 不會把已經錯過的慶祝動畫或音效在這一刻全部補放。
  const liveDrawIdsRef = useRef(new Set<string>());
  const celebratedCountsRef = useRef(new Map<string, number>());
  const finishedAckedRef = useRef(new Set<string>());

  // 舞台這一刻該顯示什麼，純粹是「目前狀態 + 現在幾點」的函式；不管是剛收到
  // 廣播、重新整理，還是很久以後才打開分頁，算出來的結果都一樣。
  const display = resolveStageDisplay(state, new Date(nowTick));
  const visibleCount = display.phase === "revealed" ? visibleWinnerCount(display.pendingReveal, new Date(nowTick)) : 0;

  const post = useEventLotterySync((message) => {
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
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      // audioContextRef 是延遲建立的單例（見 getSharedAudioContext），卸載當下的
      // .current 才是要收掉的那個，不是 mount 當時的快照，故意在 cleanup 裡才讀取。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (audioContextRef.current) void audioContextRef.current.close();
    };
  }, []);

  // ---- 手機遙控：舞台是唯一的 Remote Command Host ----
  // 手機遙控是 optional enhancement；Supabase 沒設定、連不上、session 過期或被
  // 撤銷，都只會讓這個區塊悄悄不生效，不影響上面鍵盤／滑鼠／簡報筆的本機操作。
  const [remotePointer, setRemotePointer] = useState<StoredRemoteSessionPointer | null>(null);
  const remoteChannelRef = useRef<RemoteChannelHandle | null>(null);
  const remoteCommandLogRef = useRef<RemoteCommandLog>(createRemoteCommandLog());
  const remoteRevokedRef = useRef(false);
  const remoteHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 舞台讀取控制台寫進同源 localStorage 的 session 指標；控制台撤銷或重新啟用
  // 時會改到同一把 key，跨分頁的 storage 事件讓舞台即時跟上，不需要輪詢。
  useEffect(() => {
    if (typeof window === "undefined") return;
    function readPointer() {
      try {
        const raw = window.localStorage.getItem(EVENT_LOTTERY_REMOTE_STORAGE_KEY);
        return raw ? sanitizeStoredRemoteSessionPointer(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemotePointer(readPointer());
    function onStorage(event: StorageEvent) {
      if (event.key === EVENT_LOTTERY_REMOTE_STORAGE_KEY) setRemotePointer(readPointer());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function sendHostStatus() {
    const channel = remoteChannelRef.current;
    if (!channel) return;
    void channel.send(buildHostStatus(loadEventState(), remoteCommandLogRef.current.revision, new Date()));
  }

  async function handleRemoteMessage(sessionId: string, expiresAt: string, message: RemoteMessage) {
    const channel = remoteChannelRef.current;
    if (message.type === "REMOTE_HELLO") {
      sendHostStatus();
      return;
    }
    if (message.type !== "ADVANCE_COMMAND") return;

    const session = { expiresAt, revokedAt: remoteRevokedRef.current ? new Date().toISOString() : null };
    const decision = resolveIncomingCommand(remoteCommandLogRef.current, session, message.commandId, message.expectedRevision, new Date());

    if (decision.kind === "session-invalid") {
      void channel?.send({ type: "COMMAND_ACK", commandId: message.commandId, accepted: false, revision: decision.revision, reason: "session-invalid" });
      return;
    }
    if (decision.kind === "duplicate") {
      // ACK 遺失後的重送：不再執行第二次抽選，只重新回報這個 commandId 當初的結果。
      void channel?.send({ type: "COMMAND_ACK", commandId: message.commandId, accepted: true, revision: decision.revision });
      sendHostStatus();
      return;
    }
    if (decision.kind === "stale-revision") {
      void channel?.send({ type: "COMMAND_ACK", commandId: message.commandId, accepted: false, revision: decision.revision, reason: "stale-revision" });
      sendHostStatus();
      return;
    }

    // accepted：跟簡報筆／鍵盤／滑鼠共用同一套 resolveStageAdvance／prepareStage／
    // startDraw，不另寫第二套抽獎邏輯，也不信任手機端宣稱要做什麼動作。
    const currentState = loadEventState();
    const action = resolveStageAdvance(currentState, new Date());
    const result = action.action === "none"
      ? { ok: true as const, state: currentState }
      : action.action === "prepare"
        ? prepareStage(currentState, action.prizeId, post)
        : startDraw(currentState, action.prizeId, action.count, post);

    if (!result.ok) {
      void channel?.send({ type: "COMMAND_ACK", commandId: message.commandId, accepted: false, revision: remoteCommandLogRef.current.revision, reason: result.reason });
      return;
    }

    setState(result.state);
    remoteCommandLogRef.current = commitAcceptedCommand(remoteCommandLogRef.current, message.commandId);
    try {
      window.localStorage.setItem(remoteCommandLogStorageKey(sessionId), JSON.stringify(remoteCommandLogRef.current));
    } catch {
      /* 儲存失敗不影響這次指令已經執行成功，只是下次重新整理後去重清單會重來 */
    }
    void channel?.send({ type: "COMMAND_ACK", commandId: message.commandId, accepted: true, revision: remoteCommandLogRef.current.revision });
    sendHostStatus();
  }

  useEffect(() => {
    if (!remotePointer || !isSupabaseConfigured() || typeof window === "undefined") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    const sessionId = remotePointer.sessionId;
    const expiresAt = remotePointer.expiresAt;
    remoteRevokedRef.current = false;

    let storedLog: unknown = null;
    try {
      const raw = window.localStorage.getItem(remoteCommandLogStorageKey(sessionId));
      storedLog = raw ? JSON.parse(raw) : null;
    } catch {
      storedLog = null;
    }
    remoteCommandLogRef.current = sanitizeRemoteCommandLog(storedLog);

    void connectRemoteChannel(supabase, sessionId, (message) => {
      if (message.type === "SESSION_REVOKED") {
        remoteRevokedRef.current = true;
        remoteChannelRef.current?.close();
        remoteChannelRef.current = null;
        if (remoteHeartbeatRef.current) { clearInterval(remoteHeartbeatRef.current); remoteHeartbeatRef.current = null; }
        return;
      }
      void handleRemoteMessage(sessionId, expiresAt, message);
    }).then((handle) => {
      if (!handle) return;
      if (cancelled) { handle.close(); return; }
      remoteChannelRef.current = handle;
      sendHostStatus();
      remoteHeartbeatRef.current = setInterval(() => sendHostStatus(), HOST_STATUS_HEARTBEAT_MS);
    });

    return () => {
      cancelled = true;
      if (remoteHeartbeatRef.current) { clearInterval(remoteHeartbeatRef.current); remoteHeartbeatRef.current = null; }
      remoteChannelRef.current?.close();
      remoteChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotePointer?.sessionId]);

  // 倒數與逐一揭曉期間都要每隔一小段時間重新計算一次「現在該顯示到第幾位了」；
  // 這一輪完全播完之後就自動停止，不會無限跑下去。不是用一長串 setTimeout 各自
  // 負責一位得獎者，而是每次都用「經過了多久」現算目前該顯示幾位——分頁被瀏覽器
  // 背景節流、暫停個幾十秒也沒關係，恢復後下一次重新計算會直接跳到正確進度。
  useEffect(() => {
    const pending = state.pendingReveal;
    if (!pending) return;
    const completeAt = pendingRevealCompleteAt(pending);
    if (Date.now() >= completeAt) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (now >= completeAt) clearInterval(interval);
    }, 200);
    return () => clearInterval(interval);
    // 刻意只依賴 drawId／revealAt 兩個原始值，不用整個 pendingReveal 物件：其他跟
    // 這一輪無關的狀態變更（例如收到 STATE_UPDATED 重新讀取）不該讓計時器重開。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingReveal?.drawId, state.pendingReveal?.revealAt]);

  useEffect(() => {
    if (display.phase === "drawing") liveDrawIdsRef.current.add(display.pendingReveal.drawId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.phase, state.pendingReveal?.drawId]);

  // 慶祝效果（彩帶／音效）：只有全程在場的分頁才播放，且用「目前該顯示到第幾位」
  // 跟「上次已經慶祝到第幾位」的差距來補放，就算某一次 tick 一口氣跳過好幾位
  // （分頁剛從背景節流恢復）也只會各自判斷是不是第一位／最後一位，不會補放
  // 中間那些原本就不打算逐一慶祝的名次。
  useEffect(() => {
    if (display.phase !== "revealed") return;
    const pending: PendingReveal = display.pendingReveal;
    if (!liveDrawIdsRef.current.has(pending.drawId)) return;
    const already = celebratedCountsRef.current.get(pending.drawId) ?? 0;
    if (visibleCount <= already) return;
    const total = pending.winnerIds.length;
    const celebrateEvery = total <= CELEBRATE_ALL_THRESHOLD;
    for (let index = already; index < visibleCount; index += 1) {
      const isFirst = index === 0;
      const isLast = index === total - 1;
      if (celebrateEvery || isFirst || isLast) {
        fireConfetti(isLast);
        if (pending.soundEnabled) {
          const context = getSharedAudioContext(audioContextRef);
          if (context) playChime(context);
        }
      }
    }
    celebratedCountsRef.current.set(pending.drawId, visibleCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.phase, state.pendingReveal?.drawId, visibleCount]);

  // 這一輪全部揭曉完畢後回報控制台，讓控制台可以確定「舞台真的播完了」再解鎖
  // 下一輪，而不是單純猜測動畫應該播完的時間到了。
  useEffect(() => {
    if (display.phase !== "revealed") return;
    const pending = display.pendingReveal;
    if (finishedAckedRef.current.has(pending.drawId)) return;
    if (nowTick < pendingRevealCompleteAt(pending)) return;
    finishedAckedRef.current.add(pending.drawId);
    post({ type: "DRAW_FINISHED", drawId: pending.drawId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.phase, state.pendingReveal?.drawId, nowTick]);

  useEffect(() => {
    function onFullscreenChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (visibleCount === 0 || !winnerListRef.current) return;
    const last = winnerListRef.current.lastElementChild;
    if (last && !reducedMotion()) {
      gsap.fromTo(last, { opacity: 0, y: 26, scale: 0.75, rotate: -4 }, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 0.65, ease: "back.out(2.1)" });
    }
  }, [visibleCount]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      /* 不支援全螢幕就維持原樣 */
    }
  }

  function showTransientError(message: string) {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setTransientError(message);
    errorTimerRef.current = setTimeout(() => setTransientError(""), 4000);
  }

  /**
   * 舞台可以直接用簡報筆／鍵盤／點擊畫面控制「抽下一個獎項」，不需要回頭操作
   * 控制台——每次都重新讀一次 localStorage（不是用 React state），確保簡報筆連續
   * 按兩下時，第二下看到的一定是第一下剛寫進去的最新狀態，不會因為畫面還沒重新
   * 渲染就對同一份舊資料重複動作。實際的準備／抽選邏輯跟控制台按鈕共用同一套
   * （見 ../actions.ts），兩邊操作完全一致。
   */
  function handleAdvance() {
    const currentState = loadEventState();
    const action = resolveStageAdvance(currentState, new Date());
    if (action.action === "none") return;
    const result = action.action === "prepare"
      ? prepareStage(currentState, action.prizeId, post)
      : startDraw(currentState, action.prizeId, action.count, post);
    if (result.ok) setState(result.state);
    else showTransientError(result.reason);
  }

  function handleBack() {
    const currentState = loadEventState();
    const result = clearStageAction(currentState, post);
    if (result.ok) setState(result.state);
    else showTransientError(result.reason);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;
      if (event.key === " " || event.key === "Enter" || event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        handleAdvance();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp" || event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        handleBack();
      } else if (event.key.toLowerCase() === "f") {
        void toggleFullscreen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!hydrated) return <div className="event-lottery-stage-loading" aria-hidden="true" />;

  const activePrize = display.phase === "idle" ? null : state.prizes.find((prize) => prize.id === display.prizeId) ?? null;
  const revealedWinners = (display.phase === "revealed" ? display.pendingReveal.winnerIds.slice(0, visibleCount) : [])
    .map((id) => state.winners.find((winner) => winner.id === id))
    .filter((winner): winner is NonNullable<typeof winner> => Boolean(winner));
  const hasBackground = Boolean(state.backgroundImageDataUrl);

  return (
    <div
      ref={stageRef}
      className={`event-lottery-stage${hasBackground ? " event-lottery-stage-has-image" : ""}`}
      style={hasBackground ? { backgroundImage: `url(${state.backgroundImageDataUrl})` } : undefined}
      aria-label="活動抽獎舞台展示"
      onClick={handleAdvance}
    >
      {!hasBackground && <StageParticles />}
      <div className="event-lottery-stage-scrim" aria-hidden="true" />

      <button
        className="event-lottery-stage-fullscreen"
        type="button"
        onClick={(event) => { event.stopPropagation(); void toggleFullscreen(); }}
        aria-label={isFullscreen ? "離開全螢幕" : "全螢幕顯示"}
      >
        {isFullscreen ? "⤡" : "⤢"}
      </button>

      <header className="event-lottery-stage-header">
        <h1>{state.eventTitle}</h1>
      </header>

      <main className="event-lottery-stage-main">
        {transientError && <p className="event-lottery-stage-error">{transientError}</p>}

        {!transientError && display.phase === "idle" && (
          <>
            <p className="event-lottery-stage-idle">等待控制台準備抽獎…</p>
            <p className="event-lottery-stage-hint">按空白鍵、→ 或點擊畫面／用簡報筆開始抽獎</p>
          </>
        )}

        {!transientError && (display.phase === "prepared" || display.phase === "drawing") && activePrize && (
          <div className="event-lottery-stage-prize">
            {activePrize.imageDataUrl && <img className="event-lottery-stage-prize-image" src={activePrize.imageDataUrl} alt="" />}
            <h2>{activePrize.name}</h2>
            {display.phase === "drawing"
              ? <p className="event-lottery-stage-spin">抽選中…{display.pendingReveal.winnerIds.length > 1 ? `（${display.pendingReveal.winnerIds.length} 位）` : ""}<span className="event-lottery-stage-spin-ring" aria-hidden="true" /></p>
              : <><p className="event-lottery-stage-waiting">即將開始抽選</p><p className="event-lottery-stage-hint">再按一次開始抽選</p></>}
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
