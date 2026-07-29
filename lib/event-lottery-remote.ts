import { pendingRevealCompleteAt, resolveStageAdvance, resolveStageDisplay, type LotteryEventState } from "./event-lottery.ts";
import type { LotteryRemoteSession, RemoteHostPhase, RemoteMessage } from "./event-lottery-remote-types.ts";

export const EVENT_LOTTERY_REMOTE_STORAGE_KEY = "toolverse:event-lottery:remote-session:v1";
/** 手機遙控頁自己的 session 指標，跟電腦控制台的 EVENT_LOTTERY_REMOTE_STORAGE_KEY
 *  分開存放——手機重新整理後靠這個指標直接重新訂閱頻道，不需要 pairing token
 *  仍留在網址列（配對成功當下就會用 history.replaceState 清掉）。 */
export const EVENT_LOTTERY_REMOTE_CLIENT_STORAGE_KEY = "toolverse:event-lottery:remote-client-session:v1";
const EVENT_LOTTERY_REMOTE_COMMAND_LOG_PREFIX = "toolverse:event-lottery:remote-command-log:v1:";
export const EVENT_LOTTERY_REMOTE_TOKEN_BYTES = 32; // 256 bits
export const EVENT_LOTTERY_REMOTE_SESSION_TTL_HOURS = 6;
export const MAX_PROCESSED_COMMAND_IDS = 100;
export const COMMAND_ACK_TIMEOUT_MS = 2000;
export const COMMAND_MAX_RESENDS = 3;
export const HOST_STATUS_HEARTBEAT_MS = 3000;
export const HOST_STATUS_STALE_AFTER_MS = 8000;
export const REMOTE_LONG_PRESS_MS = 800;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Pairing：session id／token 產生與配對網址
// ---------------------------------------------------------------------------

/** 產生 256-bit pairing token；一律用 Web Crypto 的 CSPRNG，不使用 Math.random()。 */
export function generatePairingToken(): string {
  const bytes = new Uint8Array(EVENT_LOTTERY_REMOTE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function remoteChannelTopic(sessionId: string): string {
  return `lottery:${sessionId}`;
}

/** 控制台產生 QR Code 內容：手機掃描後直接帶著 session id 與 pairing token 進入
 *  遙控頁，不需要輸入帳號、密碼或房間代碼。 */
export function buildPairingUrl(origin: string, sessionId: string, token: string): string {
  const url = new URL("/tools/event-lottery/remote", origin);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("token", token);
  return url.toString();
}

export type PairingParams = { sessionId: string; token: string };

/** 手機端解析網址列的 session／token；缺一不可，格式不對就當作沒有配對資訊。 */
export function parsePairingParams(searchParams: URLSearchParams): PairingParams | null {
  const sessionId = searchParams.get("session");
  const token = searchParams.get("token");
  if (!sessionId || !token) return null;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  if (!/^[0-9a-f]{16,}$/i.test(token)) return null;
  return { sessionId, token };
}

// ---------------------------------------------------------------------------
// Session 有效性：expired／revoked 判斷，舞台、控制台、手機共用同一套規則，
// 跟 Supabase 那邊的 RLS 判斷條件（見 migration）是同一個邏輯的兩份實作。
// ---------------------------------------------------------------------------

export function isRemoteSessionUsable(session: Pick<LotteryRemoteSession, "expiresAt" | "revokedAt">, now = new Date()): boolean {
  if (session.revokedAt !== null) return false;
  return now.getTime() < Date.parse(session.expiresAt);
}

/** 控制台／舞台存進同源 localStorage 的 session 指標；刻意不含 pairing token
 *  明文——重新整理後控制台可以撤銷或顯示到期時間，但沒辦法重新畫出同一組 QR。 */
export type StoredRemoteSessionPointer = { sessionId: string; topic: string; expiresAt: string };

/** localStorage 存的 session 指標可能是舊格式或損壞資料，逐欄驗證。 */
export function sanitizeStoredRemoteSessionPointer(value: unknown): StoredRemoteSessionPointer | null {
  if (!isRecord(value)) return null;
  const sessionId = typeof value.sessionId === "string" && value.sessionId !== "" ? value.sessionId : null;
  const topic = typeof value.topic === "string" && value.topic !== "" ? value.topic : null;
  const expiresAt = typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) ? value.expiresAt : null;
  if (!sessionId || !topic || !expiresAt) return null;
  return { sessionId, topic, expiresAt };
}

// ---------------------------------------------------------------------------
// 舞台端（Remote Command Host）：commandId 去重＋revision 序號
// ---------------------------------------------------------------------------

export type RemoteCommandLog = {
  revision: number;
  /** 最近處理過的 commandId，最舊的在前面，最多保留 MAX_PROCESSED_COMMAND_IDS 筆。 */
  processedCommandIds: string[];
};

export function createRemoteCommandLog(): RemoteCommandLog {
  return { revision: 0, processedCommandIds: [] };
}

/** 舞台每個 session 各自獨立一份 command log（不同 session 的 revision／commandId
 *  不該互相干擾）。 */
export function remoteCommandLogStorageKey(sessionId: string): string {
  return `${EVENT_LOTTERY_REMOTE_COMMAND_LOG_PREFIX}${sessionId}`;
}

export function sanitizeRemoteCommandLog(value: unknown): RemoteCommandLog {
  if (!isRecord(value)) return createRemoteCommandLog();
  const revisionNumber = Number(value.revision);
  const revision = Number.isFinite(revisionNumber) && revisionNumber >= 0 ? Math.floor(revisionNumber) : 0;
  const processedCommandIds = Array.isArray(value.processedCommandIds)
    ? value.processedCommandIds.filter((id): id is string => typeof id === "string").slice(-MAX_PROCESSED_COMMAND_IDS)
    : [];
  return { revision, processedCommandIds };
}

export type IncomingCommandDecision =
  | { kind: "session-invalid"; revision: number }
  | { kind: "duplicate"; revision: number }
  | { kind: "stale-revision"; revision: number }
  | { kind: "accepted"; revision: number };

/**
 * 舞台收到 ADVANCE_COMMAND 時，先用這個純函式判斷要不要真的執行底層抽獎邏輯
 * （resolveStageAdvance／prepareStage／startDraw），呼叫端再依判斷結果決定動作：
 * - session-invalid：session 已撤銷或過期，直接拒絕，不執行、不記錄。
 * - duplicate：這個 commandId 已經處理過（同一顆按鈕的 ACK 遺失重送），不再
 *   執行第二次抽選，只需要重新回報目前狀態。
 * - stale-revision：expectedRevision 跟目前不一致（手機拿到的是舊狀態），拒絕
 *   執行，回傳最新 revision 讓手機重新取得 HOST_STATUS。
 * - accepted：呼叫端這時候才可以真的呼叫底層抽獎邏輯，成功後呼叫
 *   commitAcceptedCommand() 記錄這個 commandId 並把 revision +1。
 */
export function resolveIncomingCommand(
  log: RemoteCommandLog,
  session: Pick<LotteryRemoteSession, "expiresAt" | "revokedAt">,
  commandId: string,
  expectedRevision: number,
  now = new Date(),
): IncomingCommandDecision {
  if (!isRemoteSessionUsable(session, now)) return { kind: "session-invalid", revision: log.revision };
  if (log.processedCommandIds.includes(commandId)) return { kind: "duplicate", revision: log.revision };
  if (expectedRevision !== log.revision) return { kind: "stale-revision", revision: log.revision };
  return { kind: "accepted", revision: log.revision };
}

export function commitAcceptedCommand(log: RemoteCommandLog, commandId: string): RemoteCommandLog {
  const processedCommandIds = [...log.processedCommandIds, commandId].slice(-MAX_PROCESSED_COMMAND_IDS);
  return { revision: log.revision + 1, processedCommandIds };
}

/** 舞台每次心跳／狀態變化都送出的 HOST_STATUS；只含非敏感摘要欄位。 */
export function buildHostStatus(state: LotteryEventState, revision: number, now = new Date()): RemoteMessage & { type: "HOST_STATUS" } {
  const display = resolveStageDisplay(state, now);
  const advance = resolveStageAdvance(state, now);

  let phase: RemoteHostPhase;
  if (display.phase === "idle") phase = "idle";
  else if (display.phase === "prepared") phase = "prepared";
  else if (display.phase === "drawing") phase = "drawing";
  else phase = now.getTime() < pendingRevealCompleteAt(display.pendingReveal) ? "revealing" : "finished";

  const activePrize = state.activePrizeId ? state.prizes.find((prize) => prize.id === state.activePrizeId) ?? null : null;

  return {
    type: "HOST_STATUS",
    revision,
    phase,
    nextAction: advance.action,
    eventTitle: state.eventTitle,
    prizeName: activePrize ? activePrize.name : null,
    drawCount: state.stageDrawCount,
    locked: advance.action === "none",
    sentAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 手機端（Remote Client）：等待 ACK、逾時重送、host 心跳逾時偵測
// ---------------------------------------------------------------------------

export type PendingRemoteCommand = {
  commandId: string;
  expectedRevision: number;
  sentAt: number;
  resendCount: number;
};

export function createPendingCommand(commandId: string, expectedRevision: number, now = Date.now()): PendingRemoteCommand {
  return { commandId, expectedRevision, sentAt: now, resendCount: 0 };
}

/** 2 秒未收到 ACK 且還沒用完 3 次重送機會時，可以用同一個 commandId 重送。 */
export function shouldResendCommand(pending: PendingRemoteCommand, now = Date.now()): boolean {
  return now - pending.sentAt >= COMMAND_ACK_TIMEOUT_MS && pending.resendCount < COMMAND_MAX_RESENDS;
}

export function markCommandResent(pending: PendingRemoteCommand, now = Date.now()): PendingRemoteCommand {
  return { ...pending, sentAt: now, resendCount: pending.resendCount + 1 };
}

/** 重送次數已經用完、仍然沒有 ACK：顯示失敗訊息，不再自動重試。 */
export function hasExhaustedRetries(pending: PendingRemoteCommand, now = Date.now()): boolean {
  return now - pending.sentAt >= COMMAND_ACK_TIMEOUT_MS && pending.resendCount >= COMMAND_MAX_RESENDS;
}

/** 舞台每 3 秒發送一次心跳；手機超過 8 秒沒收到任何 HOST_STATUS 就視為離線，
 *  按鈕停用並顯示「電腦舞台未連線」。lastHostStatusAt 為 null 代表從未收到過。 */
export function isHostStatusStale(lastHostStatusAt: number | null, now = Date.now(), staleAfterMs = HOST_STATUS_STALE_AFTER_MS): boolean {
  if (lastHostStatusAt === null) return true;
  return now - lastHostStatusAt > staleAfterMs;
}

/** 手機按鈕文案／可否操作，純粹由最新一次 HOST_STATUS＋是否逾時決定。 */
export type RemoteButtonState =
  | { kind: "disabled"; reason: "offline" | "locked" }
  | { kind: "prepare" }
  | { kind: "draw" };

export function resolveRemoteButtonState(status: (RemoteMessage & { type: "HOST_STATUS" }) | null, isStale: boolean): RemoteButtonState {
  if (isStale || !status) return { kind: "disabled", reason: "offline" };
  if (status.locked || status.nextAction === "none") return { kind: "disabled", reason: "locked" };
  return status.nextAction === "prepare" ? { kind: "prepare" } : { kind: "draw" };
}
