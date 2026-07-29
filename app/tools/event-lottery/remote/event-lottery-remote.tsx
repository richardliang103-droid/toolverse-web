"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  createPendingCommand,
  EVENT_LOTTERY_REMOTE_CLIENT_STORAGE_KEY,
  hasExhaustedRetries,
  isHostStatusStale,
  isRemoteSessionUsable,
  markCommandResent,
  parsePairingParams,
  REMOTE_LONG_PRESS_MS,
  resolveRemoteButtonState,
  sanitizeStoredRemoteSessionPointer,
  shouldResendCommand,
  type PendingRemoteCommand,
  type StoredRemoteSessionPointer,
} from "@/lib/event-lottery-remote";
import { connectRemoteChannel, ensureAnonymousSession, type RemoteChannelHandle } from "@/lib/event-lottery-remote-channel";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";
import type { RemoteMessage } from "@/lib/event-lottery-remote-types";

type HostStatusMessage = RemoteMessage & { type: "HOST_STATUS" };

/**
 * 手機遙控頁：畫面只保留活動名稱、目前獎項名稱、本輪抽出人數、連線狀態、一個
 * 大按鈕與中斷配對——不接收完整參加者名單、員工編號、部門或得獎紀錄，也不會
 * 自己呼叫抽獎邏輯。實際抽選永遠由掃到的那台電腦的舞台頁（Remote Command
 * Host）執行，這裡只送出「下一步」指令並等待 ACK。
 */

function loadStoredPointer(): StoredRemoteSessionPointer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EVENT_LOTTERY_REMOTE_CLIENT_STORAGE_KEY);
    return raw ? sanitizeStoredRemoteSessionPointer(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function persistPointer(pointer: StoredRemoteSessionPointer) {
  try {
    window.localStorage.setItem(EVENT_LOTTERY_REMOTE_CLIENT_STORAGE_KEY, JSON.stringify(pointer));
  } catch {
    /* 存不進去頂多下次重新整理要重新掃碼，不影響這次配對已經成功 */
  }
}

function clearStoredPointer() {
  try { window.localStorage.removeItem(EVENT_LOTTERY_REMOTE_CLIENT_STORAGE_KEY); } catch { /* noop */ }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "發生未知錯誤";
}

function friendlyPairingError(raw: string): string {
  if (raw.includes("expired")) return "這組配對連結已經過期，請電腦操作人員重新產生 QR Code";
  if (raw.includes("revoked")) return "這組配對已被撤銷，請重新掃描新的 QR Code";
  if (raw.includes("already claimed")) return "這組 QR Code 已經被另一支手機使用，請電腦操作人員重新產生";
  return "配對失敗，請重新掃描 QR Code";
}

export function EventLotteryRemote() {
  const supabaseConfigured = isSupabaseConfigured();

  const [hydrated, setHydrated] = useState(false);
  const [pointer, setPointer] = useState<StoredRemoteSessionPointer | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [revoked, setRevoked] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [hostStatus, setHostStatus] = useState<HostStatusMessage | null>(null);
  const [lastHostStatusAt, setLastHostStatusAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [commandInFlight, setCommandInFlight] = useState(false);
  const [commandError, setCommandError] = useState("");
  const [pressing, setPressing] = useState(false);

  const channelRef = useRef<RemoteChannelHandle | null>(null);
  const connectInFlightRef = useRef(false);
  const pendingCommandRef = useRef<PendingRemoteCommand | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());

  // 純粹驅動「host 心跳是否逾時」的畫面更新，每秒重算一次即可。
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  function handleMessage(message: RemoteMessage) {
    if (message.type === "HOST_STATUS") {
      setHostStatus(message);
      setLastHostStatusAt(Date.now());
      return;
    }
    if (message.type === "COMMAND_ACK") {
      const pending = pendingCommandRef.current;
      if (!pending || pending.commandId !== message.commandId) return;
      pendingCommandRef.current = null;
      setCommandInFlight(false);
      setCommandError(message.accepted ? "" : "指令沒有被接受，畫面會依電腦舞台目前的狀態更新，請確認後再試一次");
      return;
    }
    if (message.type === "SESSION_REVOKED") {
      setRevoked(true);
      channelRef.current?.close();
      channelRef.current = null;
      clearStoredPointer();
    }
  }

  async function connect(nextPointer: StoredRemoteSessionPointer) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    if (connectInFlightRef.current) return;
    connectInFlightRef.current = true;
    channelRef.current?.close();
    channelRef.current = null;
    setHostStatus(null);
    setLastHostStatusAt(null);
    try {
      const handle = await connectRemoteChannel(supabase, nextPointer.sessionId, handleMessage, (status) => {
        if (status === "disconnected") {
          channelRef.current = null;
          setLastHostStatusAt(null);
          setCommandError("連線中斷，正在重新連線…");
        } else if (status === "connected") {
          setCommandError("");
        }
      });
      if (!handle) {
        setPairingError("暫時連不上電腦舞台，正在等待重新連線");
        return;
      }
      channelRef.current = handle;
      setPairingError("");
      // 重新連線後先送 REMOTE_HELLO，等待 HOST_STATUS 之後才開放按鈕。
      try {
        await handle.send({ type: "REMOTE_HELLO", clientId });
      } catch {
        handle.close();
        channelRef.current = null;
        setLastHostStatusAt(null);
        setCommandError("連線中斷，正在重新連線…");
      }
    } finally {
      connectInFlightRef.current = false;
    }
  }

  // Realtime 連線本身不是可靠訊息佇列；手機切到背景、行動網路切換或短暫斷網
  // 後，舊 channel 可能仍留在 CLOSED 狀態。只要心跳逾時，就重新建立同一個
  // channel，並保留 pending command 讓原本的 commandId 繼續重送，不能要求使用者
  // 重新掃 QR 或產生新的命令。
  useEffect(() => {
    if (!pointer || revoked || disconnected || !supabaseConfigured) return;
    const interval = setInterval(() => {
      if (isHostStatusStale(lastHostStatusAt, Date.now()) && !connectInFlightRef.current) void connect(pointer);
    }, 5000);
    return () => clearInterval(interval);
    // connect intentionally uses refs for the current channel; pointer/status are the
    // only values that determine whether the retry loop should exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointer, revoked, disconnected, supabaseConfigured, lastHostStatusAt]);

  // 手機端唯一允許呼叫 signInAnonymously() 的地方：網址列帶著有效的 session id
  // 與 pairing token（掃 QR Code 進來）時才會執行。重新整理時若本機已經有先前
  // 配對成功留下的 session 指標，就直接用既有的匿名身分重新訂閱，不必再簽署
  // 一次、也不需要 pairing token（token 早在第一次配對成功後就從網址列移除了）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    async function run() {
      const params = parsePairingParams(new URL(window.location.href).searchParams);

      if (params) {
        if (!supabaseConfigured) { setHydrated(true); return; }
        setPairing(true);
        try {
          const supabase = getSupabaseBrowserClient();
          if (!supabase) throw new Error("尚未設定手機遙控服務");
          await ensureAnonymousSession(supabase);
          const { data, error } = await supabase.rpc("claim_lottery_remote_session", {
            session_id: params.sessionId,
            pairing_token: params.token,
          });
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          if (!row) throw new Error("配對失敗");
          const nextPointer: StoredRemoteSessionPointer = { sessionId: row.id, topic: row.topic, expiresAt: row.expires_at };
          persistPointer(nextPointer);
          // 配對成功立刻清掉網址列裡的 pairing token，避免長期留在網址列或瀏覽歷史。
          window.history.replaceState(null, "", window.location.pathname);
          if (cancelled) return;
          setPointer(nextPointer);
          await connect(nextPointer);
        } catch (error) {
          if (!cancelled) setPairingError(friendlyPairingError(errorMessage(error)));
        } finally {
          if (!cancelled) { setPairing(false); setHydrated(true); }
        }
        return;
      }

      const restored = loadStoredPointer();
      if (restored && supabaseConfigured) {
        if (!isRemoteSessionUsable({ expiresAt: restored.expiresAt, revokedAt: null })) {
          clearStoredPointer();
          setPairingError("這組手機遙控已經過期，請電腦操作人員重新產生 QR Code");
        } else {
          setPointer(restored);
          await connect(restored);
        }
      }
      if (!cancelled) setHydrated(true);
    }

    void run();
    return () => {
      cancelled = true;
      channelRef.current?.close();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    connectInFlightRef.current = false;
  }, []);

  // 指令逾時重送：2 秒未收到 ACK 且未達 3 次重送上限就用同一個 commandId 重送，
  // 不會為了重試同一次按下而產生新的 commandId；用完重送次數仍沒有 ACK 就顯示
  // 明確的失敗訊息，不再自動重試。
  useEffect(() => {
    const interval = setInterval(() => {
      const pending = pendingCommandRef.current;
      if (!pending) return;
      const now = Date.now();
      if (hasExhaustedRetries(pending, now)) {
        pendingCommandRef.current = null;
        setCommandInFlight(false);
        setCommandError("指令沒有收到回應，請確認電腦舞台是否已連線，再試一次");
        return;
      }
      if (shouldResendCommand(pending, now)) {
        pendingCommandRef.current = markCommandResent(pending, now);
        void channelRef.current?.send({ type: "ADVANCE_COMMAND", commandId: pending.commandId, expectedRevision: pending.expectedRevision, sentAt: new Date(now).toISOString() }).catch(() => {
          setCommandError("連線中斷，正在重新連線…");
        });
      }
    }, 300);
    return () => clearInterval(interval);
  }, []);

  const isStale = isHostStatusStale(lastHostStatusAt, nowTick);
  const buttonState = resolveRemoteButtonState(hostStatus, isStale);
  const effectiveDisabled = revoked || disconnected || commandInFlight || buttonState.kind === "disabled";

  function sendAdvanceCommand() {
    if (!hostStatus || !channelRef.current || pendingCommandRef.current) return;
    const commandId = crypto.randomUUID();
    const expectedRevision = hostStatus.revision;
    const now = Date.now();
    pendingCommandRef.current = createPendingCommand(commandId, expectedRevision, now);
    setCommandInFlight(true);
    setCommandError("");
    void channelRef.current.send({ type: "ADVANCE_COMMAND", commandId, expectedRevision, sentAt: new Date(now).toISOString() }).catch(() => {
      setCommandError("連線中斷，正在重新連線…");
    });
    try { navigator.vibrate?.(40); } catch { /* 震動失敗不影響流程 */ }
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    setPressing(false);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (effectiveDisabled) return;
    event.preventDefault();
    if (buttonState.kind === "prepare" || buttonState.kind === "clear") { sendAdvanceCommand(); return; }
    if (buttonState.kind !== "draw") return;
    setPressing(true);
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setPressing(false);
      sendAdvanceCommand();
    }, REMOTE_LONG_PRESS_MS);
  }

  function handleDisconnect() {
    clearLongPressTimer();
    channelRef.current?.close();
    channelRef.current = null;
    clearStoredPointer();
    pendingCommandRef.current = null;
    setPointer(null);
    setHostStatus(null);
    setLastHostStatusAt(null);
    setCommandInFlight(false);
    setCommandError("");
    setDisconnected(true);
  }

  if (!hydrated) return <main className="event-lottery-remote-page" aria-busy="true" />;

  if (!supabaseConfigured) {
    return (
      <main className="event-lottery-remote-page">
        <div className="event-lottery-remote-card">
          <p className="event-lottery-remote-title">尚未設定手機遙控服務</p>
        </div>
      </main>
    );
  }

  if (revoked) {
    return (
      <main className="event-lottery-remote-page">
        <div className="event-lottery-remote-card">
          <p className="event-lottery-remote-title">手機遙控已被撤銷</p>
          <p className="event-lottery-remote-count">請洽電腦操作人員重新掃描 QR Code</p>
        </div>
      </main>
    );
  }

  if (disconnected) {
    return (
      <main className="event-lottery-remote-page">
        <div className="event-lottery-remote-card">
          <p className="event-lottery-remote-title">已中斷配對</p>
          <p className="event-lottery-remote-count">請重新掃描 QR Code 才能再次遙控</p>
        </div>
      </main>
    );
  }

  if (!pointer) {
    return (
      <main className="event-lottery-remote-page">
        <div className="event-lottery-remote-card">
          {pairingError
            ? <p className="event-lottery-remote-message event-lottery-remote-message-error">{pairingError}</p>
            : <p className="event-lottery-remote-title">{pairing ? "配對中…" : "請用相機掃描活動抽獎控制台顯示的 QR Code"}</p>}
        </div>
      </main>
    );
  }

  const buttonLabel = buttonState.kind === "prepare"
    ? "顯示下一個獎項"
    : buttonState.kind === "clear"
      ? "回到首頁"
    : buttonState.kind === "draw"
      ? "長按開始抽獎"
      : buttonState.reason === "offline" ? "電腦舞台未連線" : "請稍候…";

  return (
    <main className="event-lottery-remote-page">
      <div className="event-lottery-remote-card">
        <p className="event-lottery-remote-title">{hostStatus?.eventTitle ?? "活動抽獎"}</p>
        <p className="event-lottery-remote-prize">{hostStatus?.prizeName ?? "尚未準備獎項"}</p>
        <p className="event-lottery-remote-count">本輪抽出人數：{hostStatus ? hostStatus.drawCount : "—"}</p>
        <span className={`event-lottery-remote-connection ${isStale ? "event-lottery-remote-connection-offline" : "event-lottery-remote-connection-online"}`}>
          {isStale ? "電腦舞台未連線" : "已連線"}
        </span>

        <button
          type="button"
          className={`event-lottery-remote-button${pressing ? " event-lottery-remote-button-pressing" : ""}`}
          disabled={effectiveDisabled}
          onPointerDown={handlePointerDown}
          onPointerUp={clearLongPressTimer}
          onPointerCancel={clearLongPressTimer}
          onPointerLeave={clearLongPressTimer}
        >
          {buttonLabel}
        </button>

        {commandError && <p className="event-lottery-remote-message event-lottery-remote-message-error">{commandError}</p>}

        <button className="event-lottery-remote-disconnect button button-small button-secondary" type="button" onClick={handleDisconnect}>中斷配對</button>
      </div>
    </main>
  );
}
