import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyEventState, createParticipant, createPrize, createRoster, drawEventWinners, prepareStagePrize, previewPrizeWinners, stagePreviewCompleteAt } from "../lib/event-lottery.ts";
import {
  buildHostStatus,
  commitAcceptedCommand,
  createPendingCommand,
  createRemoteCommandLog,
  acquireRemoteHostLock,
  generatePairingToken,
  hasExhaustedRetries,
  isHostStatusStale,
  isRemoteSessionUsable,
  markCommandResent,
  parsePairingParams,
  buildPairingUrl,
  resolveIncomingCommand,
  resolveRemoteButtonState,
  sanitizeRemoteCommandLog,
  sanitizeStoredRemoteSessionPointer,
  shouldResendCommand,
} from "../lib/event-lottery-remote.ts";

function buildSession(overrides = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    topic: "lottery:11111111-1111-1111-1111-111111111111",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    claimed: true,
    ...overrides,
  };
}

test("generatePairingToken：使用 Web Crypto 產生至少 256 bits（32 bytes → 64 hex 字元）", () => {
  const token = generatePairingToken();
  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]{64}$/);
  const other = generatePairingToken();
  assert.notEqual(token, other, "兩次產生的 token 不應該相同");
});

test("buildPairingUrl／parsePairingParams：往返後 session 與 token 一致", () => {
  const token = generatePairingToken();
  const url = buildPairingUrl("https://toolverse-web.vercel.app", "11111111-1111-1111-1111-111111111111", token);
  const parsed = parsePairingParams(new URL(url).searchParams);
  assert.deepEqual(parsed, { sessionId: "11111111-1111-1111-1111-111111111111", token });
});

test("parsePairingParams：缺少 session 或 token 回傳 null", () => {
  assert.equal(parsePairingParams(new URLSearchParams("token=abc")), null);
  assert.equal(parsePairingParams(new URLSearchParams("session=11111111-1111-1111-1111-111111111111")), null);
  assert.equal(parsePairingParams(new URLSearchParams("")), null);
});

test("sanitizeStoredRemoteSessionPointer：損壞或缺欄位一律回傳 null", () => {
  assert.equal(sanitizeStoredRemoteSessionPointer(null), null);
  assert.equal(sanitizeStoredRemoteSessionPointer({ sessionId: "s1" }), null);
  assert.equal(sanitizeStoredRemoteSessionPointer({ sessionId: "s1", topic: "lottery:s1", expiresAt: "not-a-date" }), null);
  const valid = { sessionId: "s1", topic: "lottery:s1", expiresAt: new Date().toISOString() };
  assert.deepEqual(sanitizeStoredRemoteSessionPointer(valid), valid);
});

test("isRemoteSessionUsable：撤銷或過期都視為不可用", () => {
  assert.equal(isRemoteSessionUsable(buildSession()), true);
  assert.equal(isRemoteSessionUsable(buildSession({ revokedAt: new Date().toISOString() })), false);
  assert.equal(isRemoteSessionUsable(buildSession({ expiresAt: new Date(Date.now() - 1000).toISOString() })), false);
});

test("sanitizeRemoteCommandLog：損壞或缺漏的資料安全回退為空 log", () => {
  assert.deepEqual(sanitizeRemoteCommandLog(null), { revision: 0, processedCommandIds: [] });
  assert.deepEqual(sanitizeRemoteCommandLog({ revision: "abc", processedCommandIds: "nope" }), { revision: 0, processedCommandIds: [] });
  assert.deepEqual(sanitizeRemoteCommandLog({ revision: 3.9, processedCommandIds: ["a", "b", 5] }), { revision: 3, processedCommandIds: ["a", "b"] });
});

test("sanitizeRemoteCommandLog：processedCommandIds 只保留最近 MAX_PROCESSED_COMMAND_IDS 筆", () => {
  const many = Array.from({ length: 150 }, (_, index) => `cmd-${index}`);
  const sanitized = sanitizeRemoteCommandLog({ revision: 1, processedCommandIds: many });
  assert.equal(sanitized.processedCommandIds.length, 100);
  assert.equal(sanitized.processedCommandIds[0], "cmd-50");
  assert.equal(sanitized.processedCommandIds[99], "cmd-149");
});

test("resolveIncomingCommand：重複 commandId 不會判定為 accepted（不會再抽第二次）", () => {
  const session = buildSession();
  let log = createRemoteCommandLog();
  const first = resolveIncomingCommand(log, session, "cmd-1", 0);
  assert.equal(first.kind, "accepted");
  log = commitAcceptedCommand(log, "cmd-1");
  assert.equal(log.revision, 1);

  const second = resolveIncomingCommand(log, session, "cmd-1", 0);
  assert.equal(second.kind, "duplicate");
  assert.equal(second.revision, 1);
});

test("resolveIncomingCommand：ACK 遺失後用同一個 commandId 重送，仍然只判定一次 accepted", () => {
  const session = buildSession();
  let log = createRemoteCommandLog();
  const attempt1 = resolveIncomingCommand(log, session, "cmd-retry", 0);
  assert.equal(attempt1.kind, "accepted");
  log = commitAcceptedCommand(log, "cmd-retry");

  // 手機端沒收到 ACK，用同一個 commandId 重送三次，舞台都不該再執行一次抽選。
  for (let i = 0; i < 3; i += 1) {
    const retry = resolveIncomingCommand(log, session, "cmd-retry", 0);
    assert.equal(retry.kind, "duplicate");
  }
  assert.equal(log.revision, 1, "重送不會讓 revision 繼續往上加");
});

test("resolveIncomingCommand：expectedRevision 與目前 revision 不一致時拒絕（stale-revision）", () => {
  const session = buildSession();
  let log = createRemoteCommandLog();
  log = commitAcceptedCommand(log, "cmd-a"); // revision -> 1
  const stale = resolveIncomingCommand(log, session, "cmd-b", 0);
  assert.equal(stale.kind, "stale-revision");
  assert.equal(stale.revision, 1);

  const fresh = resolveIncomingCommand(log, session, "cmd-b", 1);
  assert.equal(fresh.kind, "accepted");
});

test("resolveIncomingCommand：session 已撤銷時一律拒絕指令", () => {
  const session = buildSession({ revokedAt: new Date().toISOString() });
  const log = createRemoteCommandLog();
  const decision = resolveIncomingCommand(log, session, "cmd-1", 0);
  assert.equal(decision.kind, "session-invalid");
});

test("resolveIncomingCommand：session 已過期時一律拒絕指令", () => {
  const session = buildSession({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  const log = createRemoteCommandLog();
  const decision = resolveIncomingCommand(log, session, "cmd-1", 0);
  assert.equal(decision.kind, "session-invalid");
});

test("commitAcceptedCommand：revision 遞增，commandId 記錄進最近清單", () => {
  let log = createRemoteCommandLog();
  log = commitAcceptedCommand(log, "cmd-1");
  log = commitAcceptedCommand(log, "cmd-2");
  assert.equal(log.revision, 2);
  assert.deepEqual(log.processedCommandIds, ["cmd-1", "cmd-2"]);
});

test("commitAcceptedCommand：可把活動 stateRevision 寫入 command log", () => {
  const log = commitAcceptedCommand(createRemoteCommandLog(), "cmd-1", 17);
  assert.equal(log.revision, 17);
  assert.deepEqual(log.processedCommandIds, ["cmd-1"]);
});

test("acquireRemoteHostLock：不支援 Web Locks 的環境安全停用遠端 host", async () => {
  const lock = await acquireRemoteHostLock("session-1");
  assert.equal(lock.acquired, false);
  lock.release();
});

test("buildHostStatus：idle 狀態摘要不含任何參加者或得獎者個資，只有非敏感欄位", () => {
  const state = createEmptyEventState();
  const status = buildHostStatus(state, 0, new Date());
  assert.equal(status.type, "HOST_STATUS");
  assert.equal(status.phase, "idle");
  assert.equal(status.prizeName, null);
  assert.equal(status.nextAction, "none");
  assert.equal(status.locked, true);
  assert.equal(status.blockedReason, null);
  assert.deepEqual(Object.keys(status).sort(), ["blockedReason", "drawCount", "eventTitle", "locked", "nextAction", "phase", "prizeName", "revision", "sentAt", "type"]);
});

test("buildHostStatus：沒有符合資格的人員時，手機遙控顯示原因並保持鎖定", () => {
  const roster = createRoster("內場");
  const prize = createPrize({ name: "限定獎", totalCount: 1, order: 0, eligibleRosterIds: ["roster-with-no-members"] });
  const participant = createParticipant({ name: "小明", rosterId: roster.id });
  const state = { ...createEmptyEventState(), rosters: [roster], participants: [participant], prizes: [prize], activePrizeId: prize.id, stageDrawCount: 1 };
  const status = buildHostStatus(state, 1, new Date());
  assert.equal(status.blockedReason, "no-eligible-participants");
  assert.equal(status.drawCount, 0);
  assert.deepEqual(resolveRemoteButtonState(status, false), { kind: "disabled", reason: "no-eligible-participants" });
});

test("buildHostStatus：prepared 狀態下 nextAction 為 draw，drawCount 等於 stageDrawCount", () => {
  const roster = createRoster("內場");
  const prize = createPrize({ name: "特獎", totalCount: 5, order: 0 });
  const participants = [
    createParticipant({ name: "小明", rosterId: roster.id }),
    createParticipant({ name: "小美", rosterId: roster.id }),
  ];
  let state = { ...createEmptyEventState(), rosters: [roster], participants, prizes: [prize], stageDrawCount: 2 };
  state = prepareStagePrize(state, prize.id);
  const status = buildHostStatus(state, 3, new Date());
  assert.equal(status.phase, "prepared");
  assert.equal(status.nextAction, "draw");
  assert.equal(status.drawCount, 2);
  assert.equal(status.prizeName, "特獎");
  assert.equal(status.locked, false);
  assert.equal(status.revision, 3);
});

test("buildHostStatus：歷史名單預覽動畫未完成前，手機遙控保持鎖定；完成後才可清除或前進", () => {
  const roster = createRoster("內場");
  const prize = createPrize({ name: "特獎", totalCount: 1, order: 0 });
  const participant = createParticipant({ name: "小明", rosterId: roster.id });
  const drawnAt = new Date("2026-01-01T00:00:00.000Z");
  const shownAt = new Date("2026-01-01T00:01:00.000Z");
  const initial = { ...createEmptyEventState(), rosters: [roster], participants: [participant], prizes: [prize], animationDurationMs: 3_000 };
  const { nextState } = drawEventWinners(initial, prize.id, 1, drawnAt);
  const preview = previewPrizeWinners(nextState, prize.id, shownAt);
  const rolling = buildHostStatus(preview, 4, shownAt);
  assert.equal(rolling.phase, "drawing");
  assert.equal(rolling.nextAction, "none");
  assert.equal(rolling.locked, true);

  const atReveal = buildHostStatus(preview, 4, new Date(Date.parse(preview.stagePreview.revealAt)));
  assert.equal(atReveal.phase, "revealing");
  assert.equal(atReveal.nextAction, "none");
  assert.equal(atReveal.locked, true);

  const finished = buildHostStatus(preview, 4, new Date(stagePreviewCompleteAt(preview.stagePreview)));
  assert.equal(finished.phase, "finished");
  assert.equal(finished.nextAction, "clear");
  assert.equal(finished.locked, false);
});

test("isHostStatusStale：從未收過或超過 8 秒沒收到都視為逾時", () => {
  assert.equal(isHostStatusStale(null), true);
  const now = 1_000_000;
  assert.equal(isHostStatusStale(now - 8001, now), true);
  assert.equal(isHostStatusStale(now - 7999, now), false);
});

test("resolveRemoteButtonState：offline／locked／prepare／draw／clear 五種狀態", () => {
  assert.deepEqual(resolveRemoteButtonState(null, true), { kind: "disabled", reason: "offline" });
  const lockedStatus = { type: "HOST_STATUS", revision: 0, phase: "drawing", nextAction: "none", eventTitle: "x", prizeName: "特獎", drawCount: 1, locked: true, blockedReason: null, sentAt: new Date().toISOString() };
  assert.deepEqual(resolveRemoteButtonState(lockedStatus, false), { kind: "disabled", reason: "locked" });
  const prepareStatus = { ...lockedStatus, nextAction: "prepare", locked: false };
  assert.deepEqual(resolveRemoteButtonState(prepareStatus, false), { kind: "prepare" });
  const drawStatus = { ...lockedStatus, nextAction: "draw", locked: false };
  assert.deepEqual(resolveRemoteButtonState(drawStatus, false), { kind: "draw" });
  const clearStatus = { ...lockedStatus, nextAction: "clear", locked: false };
  assert.deepEqual(resolveRemoteButtonState(clearStatus, false), { kind: "clear" });
  const blockedStatus = { ...lockedStatus, blockedReason: "no-eligible-participants" };
  assert.deepEqual(resolveRemoteButtonState(blockedStatus, false), { kind: "disabled", reason: "no-eligible-participants" });
});

test("PendingRemoteCommand：2 秒未 ACK 且未達重送上限時應重送，達上限後視為失敗", () => {
  const pending = createPendingCommand("cmd-1", 0, 0);
  assert.equal(shouldResendCommand(pending, 1999), false);
  assert.equal(shouldResendCommand(pending, 2000), true);

  let current = pending;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(shouldResendCommand(current, current.sentAt + 2000), true);
    current = markCommandResent(current, current.sentAt + 2000);
  }
  assert.equal(current.resendCount, 3);
  assert.equal(shouldResendCommand(current, current.sentAt + 2000), false, "已達最多重送 3 次，不應再重送");
  assert.equal(hasExhaustedRetries(current, current.sentAt + 2000), true);
});
