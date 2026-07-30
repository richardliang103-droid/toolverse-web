"use client";

import confetti from "canvas-confetti";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { candidatePool, createEmptyEventState, pendingRevealCompleteAt, remainingSlots, resolveStageAdvance, resolveStageDisplay, visibleWinnerCount, type LotteryEventState, type PendingReveal } from "@/lib/event-lottery";
import {
  buildHostStatus,
  commitAcceptedCommand,
  createRemoteCommandLog,
  EVENT_LOTTERY_REMOTE_STORAGE_KEY,
  HOST_STATUS_HEARTBEAT_MS,
  acquireRemoteHostLock,
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

/** 參考前台不把 CSV 的「抽獎順序」前綴帶到投影畫面；後台仍保留原始獎項名稱。 */
function cleanPrizeName(name: string) {
  return name.replace(/^\d+[\.、\s]+/, "");
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

/** 參考前台在轉盤期間播放 roll.mp3；這裡用短促的低音 tick 取代外部音檔，
 *  保留持續滾動的聽覺回饋，同時不把未確認授權的素材打包進 Toolverse。 */
function playRollingTick(context: AudioContextLike) {
  try {
    if (context.state === "suspended") void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(180, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(120, context.currentTime + 0.06);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.1);
  } catch {
    /* 音效是裝飾效果，播放失敗不得中斷抽獎。 */
  }
}

export function EventLotteryStage() {
  const [state, setState] = useState<LotteryEventState>(() => createEmptyEventState());
  const [hydrated, setHydrated] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [transientError, setTransientError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageFocused, setStageFocused] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const winnerListRef = useRef<HTMLDivElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const winnerAutoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const winnerAutoScrollDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollingSoundRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  // 舞台不再讓「點擊畫面任何地方」都觸發抽獎，避免主持人或觀眾不小心點到背景
  // 就誤觸下一輪；改成一個明確的按鈕，這裡算出按鈕當下該顯示什麼、能不能按。
  const advanceAction = resolveStageAdvance(state, new Date(nowTick));
  const previewRolling = display.phase === "preview" && display.rolling;
  const sequentialRevealMode = display.phase === "revealed" ? display.pendingReveal.revealMode : null;
  const sequentialRevealTotal = display.phase === "revealed" ? display.pendingReveal.winnerIds.length : 0;
  const visibleCount = display.phase === "revealed" ? visibleWinnerCount(display.pendingReveal, new Date(nowTick)) : 0;
  const displayedWinnerIds = display.phase === "revealed"
    ? display.pendingReveal.winnerIds.slice(0, visibleCount)
    : display.phase === "preview" && !previewRolling ? display.winnerIds : [];

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
      if (winnerAutoScrollRef.current) clearInterval(winnerAutoScrollRef.current);
      if (winnerAutoScrollDelayRef.current) clearTimeout(winnerAutoScrollDelayRef.current);
      if (rollingSoundRef.current) clearInterval(rollingSoundRef.current);
      // audioContextRef 是延遲建立的單例（見 getSharedAudioContext），卸載當下的
      // .current 才是要收掉的那個，不是 mount 當時的快照，故意在 cleanup 裡才讀取。
      // cleanup 可能因 React StrictMode／HMR 被重入，先清掉 ref 並確認狀態，避免對
      // 已關閉的 AudioContext 再呼叫 close() 造成未處理的 InvalidStateError。
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== "closed") void audioContext.close().catch(() => undefined);
    };
  }, []);

  function sendRemote(message: RemoteMessage) {
    const channel = remoteChannelRef.current;
    if (!channel) return;
    void channel.send(message).catch(() => {
      // Reconnect polling will recreate the private channel; a lost status/ACK must
      // never become an unhandled promise rejection or affect the local draw.
    });
  }

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
    const currentState = loadEventState();
    sendRemote(buildHostStatus(currentState, currentState.stateRevision, new Date()));
  }

  async function handleRemoteMessage(sessionId: string, expiresAt: string, message: RemoteMessage) {
    if (message.type === "REMOTE_HELLO") {
      sendHostStatus();
      return;
    }
    if (message.type !== "ADVANCE_COMMAND") return;

    const currentState = loadEventState();
    // revision 以活動狀態為準，包含控制台／鍵盤／滑鼠等本機操作，不只計算手機命令。
    const commandLog = { ...remoteCommandLogRef.current, revision: currentState.stateRevision };
    const session = { expiresAt, revokedAt: remoteRevokedRef.current ? new Date().toISOString() : null };
    const decision = resolveIncomingCommand(commandLog, session, message.commandId, message.expectedRevision, new Date());

    if (decision.kind === "session-invalid") {
      sendRemote({ type: "COMMAND_ACK", commandId: message.commandId, accepted: false, revision: decision.revision, reason: "session-invalid" });
      return;
    }
    if (decision.kind === "duplicate") {
      // ACK 遺失後的重送：不再執行第二次抽選，只重新回報這個 commandId 當初的結果。
      remoteCommandLogRef.current = commandLog;
      sendRemote({ type: "COMMAND_ACK", commandId: message.commandId, accepted: true, revision: decision.revision });
      sendHostStatus();
      return;
    }
    if (decision.kind === "stale-revision") {
      sendRemote({ type: "COMMAND_ACK", commandId: message.commandId, accepted: false, revision: decision.revision, reason: "stale-revision" });
      sendHostStatus();
      return;
    }

    // accepted：跟簡報筆／鍵盤／滑鼠共用同一套 resolveStageAdvance／prepareStage／
    // startDraw，不另寫第二套抽獎邏輯，也不信任手機端宣稱要做什麼動作。
    const action = resolveStageAdvance(currentState, new Date());
    if (action.action === "none") {
      // 狀態可能在手機送出後先被本機操作改變；這不是成功的 no-op，也不能
      // 消耗 commandId，否則手機會收到 accepted 卻永遠無法重試。
      sendRemote({ type: "COMMAND_ACK", commandId: message.commandId, accepted: false, revision: currentState.stateRevision, reason: "locked" });
      sendHostStatus();
      return;
    }
    const result = action.action === "clear"
      ? clearStageAction(currentState, post)
      : action.action === "prepare"
        ? prepareStage(currentState, action.prizeId, post)
        : startDraw(currentState, action.prizeId, action.count, post);

    if (!result.ok) {
      sendRemote({ type: "COMMAND_ACK", commandId: message.commandId, accepted: false, revision: remoteCommandLogRef.current.revision, reason: result.reason });
      return;
    }

    setState(result.state);
    remoteCommandLogRef.current = commitAcceptedCommand(commandLog, message.commandId, result.state.stateRevision);
    try {
      window.localStorage.setItem(remoteCommandLogStorageKey(sessionId), JSON.stringify(remoteCommandLogRef.current));
    } catch {
      /* 儲存失敗不影響這次指令已經執行成功，只是下次重新整理後去重清單會重來 */
    }
    sendRemote({ type: "COMMAND_ACK", commandId: message.commandId, accepted: true, revision: remoteCommandLogRef.current.revision });
    sendHostStatus();
  }

  useEffect(() => {
    if (!remotePointer || !isSupabaseConfigured() || typeof window === "undefined") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const connectedSupabase = supabase;
    let cancelled = false;
    const sessionId = remotePointer.sessionId;
    const expiresAt = remotePointer.expiresAt;
    let releaseHostLock: (() => void) | null = null;
    let connectionInFlight = false;
    let connectionGeneration = 0;
    let reconnectTimer: ReturnType<typeof setInterval> | null = null;
    remoteRevokedRef.current = false;

    let storedLog: unknown = null;
    try {
      const raw = window.localStorage.getItem(remoteCommandLogStorageKey(sessionId));
      storedLog = raw ? JSON.parse(raw) : null;
    } catch {
      storedLog = null;
    }
    remoteCommandLogRef.current = sanitizeRemoteCommandLog(storedLog);

    void (async () => {
      const hostLock = await acquireRemoteHostLock(sessionId);
      if (!hostLock.acquired) return;
      if (cancelled) { hostLock.release(); return; }
      releaseHostLock = hostLock.release;

      async function connectHost() {
        if (cancelled || remoteRevokedRef.current || connectionInFlight || remoteChannelRef.current) return;
        connectionInFlight = true;
        const generation = ++connectionGeneration;
        const handle = await connectRemoteChannel(connectedSupabase, sessionId, (message) => {
          if (message.type === "SESSION_REVOKED") {
            remoteRevokedRef.current = true;
            remoteChannelRef.current?.close();
            remoteChannelRef.current = null;
            if (remoteHeartbeatRef.current) { clearInterval(remoteHeartbeatRef.current); remoteHeartbeatRef.current = null; }
            return;
          }
          void handleRemoteMessage(sessionId, expiresAt, message);
        }, (status) => {
          if (status !== "disconnected" || generation !== connectionGeneration) return;
          remoteChannelRef.current = null;
          if (remoteHeartbeatRef.current) { clearInterval(remoteHeartbeatRef.current); remoteHeartbeatRef.current = null; }
        });
        connectionInFlight = false;
        if (!handle) return;
        if (cancelled || remoteRevokedRef.current || generation !== connectionGeneration) {
          handle.close();
          return;
        }
        remoteChannelRef.current = handle;
        sendHostStatus();
        remoteHeartbeatRef.current = setInterval(() => sendHostStatus(), HOST_STATUS_HEARTBEAT_MS);
      }

      await connectHost();
      // A Realtime channel can disappear without a page-level error (background tab,
      // mobile network handoff, or a temporary service timeout). Re-establish the same
      // private channel while retaining the same command log and session pointer.
      reconnectTimer = setInterval(() => { void connectHost(); }, 5000);
    })();

    return () => {
      cancelled = true;
      connectionGeneration += 1;
      if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
      if (remoteHeartbeatRef.current) { clearInterval(remoteHeartbeatRef.current); remoteHeartbeatRef.current = null; }
      remoteChannelRef.current?.close();
      remoteChannelRef.current = null;
      releaseHostLock?.();
      releaseHostLock = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotePointer?.sessionId]);

  // 倒數、逐一揭曉與歷史名單預覽期間都要每隔一小段時間重新計算目前畫面；
  // 這一輪完全播完之後就自動停止，不會無限跑下去。不是用一長串 setTimeout 各自
  // 負責一位得獎者，而是每次都用「經過了多久」現算目前該顯示幾位——分頁被瀏覽器
  // 背景節流、暫停個幾十秒也沒關係，恢復後下一次重新計算會直接跳到正確進度。
  useEffect(() => {
    const pending = state.pendingReveal;
    const noticeUntil = state.stageNotice ? Date.parse(state.stageNotice.until) : 0;
    const previewRevealAt = state.stagePreview ? Date.parse(state.stagePreview.revealAt) : 0;
    if (!pending && !noticeUntil && !previewRevealAt) return;
    const completeAt = pending ? pendingRevealCompleteAt(pending) : noticeUntil || previewRevealAt;
    if (Date.now() >= completeAt) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (now >= completeAt) clearInterval(interval);
    }, 200);
    return () => clearInterval(interval);
    // 刻意只依賴 drawId／revealAt／noticeUntil 這些原始值，不用整個 state 物件：其他跟
    // 這一輪無關的狀態變更（例如收到 STATE_UPDATED 重新讀取）不該讓計時器重開。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingReveal?.drawId, state.pendingReveal?.revealAt, state.stageNotice?.until]);

  useEffect(() => {
    if (display.phase === "drawing") liveDrawIdsRef.current.add(display.pendingReveal.drawId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.phase, state.pendingReveal?.drawId]);

  // 參考前台在抽選期間會持續播放 roll 音效；以固定節奏合成短 tick，避免
  // 每一個得獎者建立一個獨立音效物件，也讓背景分頁恢復時不必補播歷史音檔。
  useEffect(() => {
    if (rollingSoundRef.current) clearInterval(rollingSoundRef.current);
    rollingSoundRef.current = null;
    if (display.phase !== "drawing" && !previewRolling) return;
    const soundEnabled = display.phase === "drawing" ? display.pendingReveal.soundEnabled : state.soundEnabled;
    if (!soundEnabled) return;
    rollingSoundRef.current = setInterval(() => {
      const context = getSharedAudioContext(audioContextRef);
      if (context) playRollingTick(context);
    }, 150);
    return () => {
      if (rollingSoundRef.current) clearInterval(rollingSoundRef.current);
      rollingSoundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.phase, previewRolling, state.pendingReveal?.drawId, state.pendingReveal?.soundEnabled, state.stagePreview?.revealAt, state.soundEnabled]);

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

  // 原始前台只在展示視窗取得焦點時讓標題 pulse；切到後台時停下，避免投影畫面
  // 在主持人操作其他視窗時仍持續閃爍。
  useEffect(() => {
    function updateFocus() { setStageFocused(document.hasFocus()); }
    updateFocus();
    window.addEventListener("focus", updateFocus);
    window.addEventListener("blur", updateFocus);
    return () => {
      window.removeEventListener("focus", updateFocus);
      window.removeEventListener("blur", updateFocus);
    };
  }, []);

  useEffect(() => {
    if (visibleCount === 0 || !winnerListRef.current) return;
    const last = winnerListRef.current.lastElementChild;
    if (last && !reducedMotion()) {
      gsap.fromTo(last, { opacity: 0, y: 26, scale: 0.75, rotate: -4 }, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 0.65, ease: "back.out(2.1)" });
    }
  }, [visibleCount]);

  useEffect(() => {
    if (winnerAutoScrollRef.current) clearInterval(winnerAutoScrollRef.current);
    if (winnerAutoScrollDelayRef.current) clearTimeout(winnerAutoScrollDelayRef.current);
    winnerAutoScrollRef.current = null;
    winnerAutoScrollDelayRef.current = null;
    const list = winnerListRef.current;
    const sequentialStillRolling = display.phase === "revealed"
      && sequentialRevealMode === "sequential"
      && visibleCount < sequentialRevealTotal;
    if (!list || previewRolling || sequentialStillRolling || reducedMotion()) return;
    list.scrollTop = 0;

    // 原版前台在得獎卡片出現後先停一下，再開始往返捲動；這也避免大量卡片
    // 在剛掛載、尚未完成高度計算時就啟動捲軸。
    winnerAutoScrollDelayRef.current = setTimeout(() => {
      const currentList = winnerListRef.current;
      if (!currentList || currentList.scrollHeight <= currentList.clientHeight) return;
      let position = 0;
      let direction = 1;
      let pause = 100;
      winnerAutoScrollRef.current = setInterval(() => {
        if (pause > 0) { pause -= 1; return; }
        const maxScroll = currentList.scrollHeight - currentList.clientHeight;
        position += direction;
        if (position >= maxScroll) { position = maxScroll; direction = -1; pause = 100; }
        if (position <= 0) { position = 0; direction = 1; pause = 100; }
        currentList.scrollTop = position;
      }, 30);
    }, sequentialRevealMode === "sequential" ? 500 : 1_000);
    return () => {
      if (winnerAutoScrollRef.current) clearInterval(winnerAutoScrollRef.current);
      if (winnerAutoScrollDelayRef.current) clearTimeout(winnerAutoScrollDelayRef.current);
      winnerAutoScrollRef.current = null;
      winnerAutoScrollDelayRef.current = null;
    };
  }, [displayedWinnerIds.length, display.phase, previewRolling, sequentialRevealMode, sequentialRevealTotal, visibleCount]);

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
   * 舞台可以直接用簡報筆／鍵盤／畫面上明確的按鈕控制「抽下一個獎項」，不需要
   * 回頭操作控制台——刻意不讓點擊畫面任何地方都觸發，避免主持人或觀眾靠近
   * 螢幕、誤觸背景就不小心開下一輪。每次都重新讀一次 localStorage（不是用
   * React state），確保簡報筆連續按兩下時，第二下看到的一定是第一下剛寫進去
   * 的最新狀態，不會因為畫面還沒重新渲染就對同一份舊資料重複動作。實際的
   * 準備／抽選邏輯跟控制台按鈕共用同一套（見 ../actions.ts），兩邊操作完全
   * 一致。
   */
  function handleAdvance() {
    const currentState = loadEventState();
    const action = resolveStageAdvance(currentState, new Date());
    if (action.action === "none") {
      const allPrizesDone = currentState.prizes.length > 0 && currentState.prizes.every((prize) => remainingSlots(prize) === 0);
      if (allPrizesDone && !currentState.activePrizeId) showTransientError("目前所有獎項皆已抽完！");
      return;
    }
    const result = action.action === "clear"
      ? clearStageAction(currentState, post)
      : action.action === "prepare"
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
  const activePrizeDisplayName = activePrize ? cleanPrizeName(activePrize.name) : "";
  const revealedWinners = displayedWinnerIds
    .map((id) => state.winners.find((winner) => winner.id === id))
    .filter((winner): winner is NonNullable<typeof winner> => Boolean(winner));
  const hasBackground = Boolean(state.backgroundImageDataUrl);
  const rollingPool = activePrize ? candidatePool(state, activePrize.id) : [];
  const rollingNames = rollingPool.length > 0 ? rollingPool.map((participant) => participant.name) : ["? ? ?", "- - -"];
  const rollingName = rollingNames[Math.floor(nowTick / 50) % rollingNames.length] ?? "? ? ?";
  const stageDrawCount = activePrize ? Math.min(state.stageDrawCount, remainingSlots(activePrize), rollingPool.length) : 0;
  // 原版會在抽獎開始時就依「本輪總人數」決定版型；逐一揭曉時不能因為
  // 目前只出現第一張卡片，就先套用單人超大版型，否則第二張出現時畫面會跳動。
  const winnerLayoutCount = display.phase === "revealed"
    ? display.pendingReveal.winnerIds.length
    : display.phase === "drawing"
      ? display.pendingReveal.winnerIds.length
    : display.phase === "preview" ? display.winnerIds.length : revealedWinners.length;
  const winnerScale = winnerLayoutCount === 1 ? "count-1" : winnerLayoutCount <= 4 ? "count-few" : winnerLayoutCount <= 10 ? "count-medium" : winnerLayoutCount <= 20 ? "count-many" : winnerLayoutCount <= 40 ? "count-huge" : "count-massive";
  const sequentialStillRolling = display.phase === "revealed" && display.pendingReveal.revealMode === "sequential" && visibleCount < display.pendingReveal.winnerIds.length;
  const presentationStillRolling = previewRolling || display.phase === "drawing" || sequentialStillRolling;

  const allPrizesDone = state.prizes.length > 0 && state.prizes.every((prize) => remainingSlots(prize) === 0);
  const advanceLabel = advanceAction.action === "draw"
    ? "🎲 開始抽獎"
    : advanceAction.action === "prepare"
      ? "▶ 準備下一個獎項"
      : advanceAction.action === "clear"
        ? "➡️ 下一輪"
        : presentationStillRolling || display.phase === "notice"
          ? "請稍候…"
          : allPrizesDone
            ? "🎉 抽獎已全部完成"
            : "▶ 開始抽獎";

  return (
    <div
      ref={stageRef}
      className={`event-lottery-stage${hasBackground ? " event-lottery-stage-has-image" : ""}`}
      style={hasBackground ? { backgroundImage: `url(${state.backgroundImageDataUrl})` } : undefined}
      aria-label="活動抽獎舞台展示"
    >
      <StageParticles />
      <div className="event-lottery-stage-scrim" aria-hidden="true" />

      <button
        className="event-lottery-stage-fullscreen"
        type="button"
        onClick={(event) => { event.stopPropagation(); void toggleFullscreen(); }}
        aria-label={isFullscreen ? "離開全螢幕" : "全螢幕顯示"}
      >
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 3v4a2 2 0 0 1-2 2H3M15 3v4a2 2 0 0 0 2 2h4M9 21v-4a2 2 0 0 0-2-2H3M15 21v-4a2 2 0 0 1 2-2h4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />
          </svg>
        )}
      </button>

      <header className="event-lottery-stage-header">
        <h1 className={stageFocused ? "event-lottery-stage-title-pulsing" : undefined}>{state.eventTitle}</h1>
        {!transientError && display.phase === "idle" && <h2>準備迎接下一個幸運兒！</h2>}
        {!transientError && display.phase === "notice" && <h2>{display.message}</h2>}
        {!transientError && display.phase !== "idle" && display.phase !== "notice" && activePrize && (
          <>
            {activePrize.imageDataUrl && <img key={activePrize.id} className="event-lottery-stage-prize-image" src={activePrize.imageDataUrl} alt="" />}
            <h2>
              {display.phase === "prepared"
                ? `即將抽出：${activePrizeDisplayName} 共 ${stageDrawCount} 名`
                : presentationStillRolling
                  ? `【${activePrizeDisplayName}】 抽獎進行中...`
                  : `🎉 恭喜【${activePrizeDisplayName}】得獎者 🎉`}
            </h2>
          </>
        )}
      </header>

      <main className="event-lottery-stage-main">
        {transientError && <p className="event-lottery-stage-error">{transientError}</p>}

        {!transientError && display.phase === "drawing" && activePrize && (
          display.pendingReveal.revealMode === "sequential"
            ? <div className={`event-lottery-stage-winner-list ${winnerScale}`} aria-live="polite"><div className="event-lottery-stage-winner-card event-lottery-stage-rolling-card"><span>{rollingName}</span></div></div>
            : <div className="event-lottery-stage-slot-machine" aria-live="polite"><div className="event-lottery-stage-slot-window"><span>{rollingName}</span></div></div>
        )}

        {!transientError && previewRolling && activePrize && (
          <div className="event-lottery-stage-slot-machine" aria-live="polite"><div className="event-lottery-stage-slot-window"><span>{rollingName}</span></div></div>
        )}

        {!transientError && (display.phase === "revealed" || (display.phase === "preview" && !display.rolling)) && activePrize && (
          <div className={`event-lottery-stage-reveal${display.phase === "preview" ? " event-lottery-stage-preview" : ""}`}>
            <div ref={winnerListRef} className={`event-lottery-stage-winner-list ${winnerScale}`}>
              {revealedWinners.map((winner, index) => (
                <div className={`event-lottery-stage-winner-card${winner.disqualified ? " event-lottery-stage-winner-disqualified" : ""}`} style={{ animationDelay: `${Math.min(index * 0.08, 3)}s` }} key={winner.id}>
                  <span className="event-lottery-stage-winner-dept">{winner.department || "---"}</span>
                  <span className="event-lottery-stage-winner-name">{winner.participantName}</span>
                  <span className="event-lottery-stage-winner-emp">{winner.employeeId || "---"}</span>
                  {winner.disqualified && <span className="event-lottery-stage-winner-tag">已取消重抽</span>}
                </div>
              ))}
              {sequentialStillRolling && <div className="event-lottery-stage-winner-card event-lottery-stage-rolling-card"><span>{rollingName}</span></div>}
            </div>
          </div>
        )}
      </main>

      {state.stageButtonVisible && (
        <button
          type="button"
          className={`event-lottery-stage-advance-button${advanceAction.action === "none" ? " event-lottery-stage-advance-button-disabled" : ""}`}
          onClick={handleAdvance}
          disabled={advanceAction.action === "none"}
        >
          {advanceLabel}
        </button>
      )}
    </div>
  );
}
