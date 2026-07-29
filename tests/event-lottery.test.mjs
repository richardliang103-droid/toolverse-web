import assert from "node:assert/strict";
import test from "node:test";
import {
  candidatePool,
  canDeleteParticipant,
  canDeletePrize,
  canDeleteRoster,
  clearStage,
  createEmptyEventState,
  createParticipant,
  createPrize,
  createRoster,
  disqualifyWinner,
  drawEventWinners,
  EventLotteryError,
  eventBackupFileName,
  exportEventBackup,
  findDuplicateEmployeeId,
  advanceStateRevision,
  MAX_DRAW_COUNT_PER_ROUND,
  mergeParticipantsFromCsv,
  parseEventBackup,
  parseParticipantsCsv,
  parsePrizesCsv,
  pendingRevealCompleteAt,
  PRESENTATION_SETTLE_MS,
  prepareStagePrize,
  previewPrizeWinners,
  remainingSlots,
  resetEventDraws,
  resolveStageAdvance,
  resolveStageDisplay,
  sanitizeEventState,
  sequentialStepMs,
  stagePreviewCompleteAt,
  DEFAULT_SINGLE_SEQUENTIAL_MS,
  validateDraw,
  visibleWinnerCount,
  winnersToCsv,
} from "../lib/event-lottery.ts";

function buildBasicState() {
  let state = createEmptyEventState();
  const rosterA = createRoster("內場");
  const rosterB = createRoster("外場");
  state = { ...state, rosters: [rosterA, rosterB] };
  const participants = [
    createParticipant({ name: "小明", employeeId: "E001", department: "業務", rosterId: rosterA.id }),
    createParticipant({ name: "小美", employeeId: "E002", department: "業務", rosterId: rosterA.id }),
    createParticipant({ name: "小華", employeeId: "E003", department: "工程", rosterId: rosterB.id }),
    createParticipant({ name: "小強", employeeId: "E004", department: "工程", rosterId: rosterB.id, active: false }),
  ];
  state = { ...state, participants };
  const prize = createPrize({ name: "特獎", totalCount: 2, order: 0 });
  state = { ...state, prizes: [prize] };
  return { state, rosterA, rosterB, prize };
}

test("normalize 修復錯誤資料：損壞欄位換成安全預設值，不會整個崩潰", () => {
  const state = sanitizeEventState({
    eventTitle: 12345,
    rosters: "not-an-array",
    participants: [{ name: "小明" }],
    prizes: [{ name: "特獎", totalCount: "abc" }],
    winners: "broken",
    revealMode: "not-a-mode",
    animationDurationMs: "nope",
    soundEnabled: "yes",
  });
  assert.equal(state.eventTitle, "🎊 歡樂公司尾牙 🎊");
  assert.equal(state.rosters.length, 0);
  // 沒有任何名單群組時，參加者找不到有效 rosterId，應該被安全捨棄而不是讓整份資料壞掉。
  assert.equal(state.participants.length, 0);
  assert.equal(state.prizes.length, 1);
  assert.equal(state.prizes[0].totalCount, 1);
  assert.equal(state.winners.length, 0);
  assert.equal(state.revealMode, "sequential");
  assert.equal(state.animationDurationMs, 3000);
  assert.equal(state.soundEnabled, true);
  assert.equal(state.stageDrawCount, 1, "舊 localStorage／舊備份缺少 stageDrawCount 時安全回退為 1");
  assert.equal(state.stateRevision, 0, "舊 localStorage／舊備份缺少 stateRevision 時安全回退為 0");
});

test("advanceStateRevision：每次狀態變更都產生遞增版本與新的 updatedAt", () => {
  const before = createEmptyEventState(new Date("2026-01-01T00:00:00.000Z"));
  const after = advanceStateRevision(before, new Date("2026-01-01T00:00:01.000Z"));
  assert.equal(after.stateRevision, 1);
  assert.equal(after.updatedAt, "2026-01-01T00:00:01.000Z");
  assert.equal(before.stateRevision, 0, "版本更新不可改寫原本的 state");
});

test("sanitizeEventState：stageDrawCount 依 1 到 MAX_DRAW_COUNT_PER_ROUND 夾住", () => {
  assert.equal(sanitizeEventState({ stageDrawCount: 0 }).stageDrawCount, 1);
  assert.equal(sanitizeEventState({ stageDrawCount: -5 }).stageDrawCount, 1);
  assert.equal(sanitizeEventState({ stageDrawCount: "abc" }).stageDrawCount, 1);
  assert.equal(sanitizeEventState({ stageDrawCount: 3.6 }).stageDrawCount, 4);
  assert.equal(sanitizeEventState({ stageDrawCount: MAX_DRAW_COUNT_PER_ROUND + 100 }).stageDrawCount, MAX_DRAW_COUNT_PER_ROUND);
});

test("normalize：損壞的 pendingReveal（指向不存在的獎項或得獎者、缺 revealAt）一律捨棄", () => {
  const withMissingPrize = sanitizeEventState({
    prizes: [{ id: "prize-1", name: "特獎", totalCount: 1 }],
    activePrizeId: "prize-1",
    pendingReveal: { prizeId: "prize-missing", winnerIds: [], revealAt: new Date().toISOString() },
  });
  assert.equal(withMissingPrize.pendingReveal, null);

  const withMissingWinner = sanitizeEventState({
    prizes: [{ id: "prize-1", name: "特獎", totalCount: 1 }],
    winners: [],
    activePrizeId: "prize-1",
    pendingReveal: { prizeId: "prize-1", winnerIds: ["winner-missing"], revealAt: new Date().toISOString() },
  });
  assert.equal(withMissingWinner.pendingReveal, null);

  const withoutRevealAt = sanitizeEventState({
    prizes: [{ id: "prize-1", name: "特獎", totalCount: 1 }],
    winners: [{ id: "winner-1", prizeId: "prize-1", participantId: "p1", participantName: "小明", drawnAt: new Date().toISOString() }],
    activePrizeId: "prize-1",
    pendingReveal: { prizeId: "prize-1", winnerIds: ["winner-1"] },
  });
  assert.equal(withoutRevealAt.pendingReveal, null);
});

test("normalize：名單群組遺失時，參加者改掛第一個可用群組而不是整筆消失", () => {
  const roster = { id: "roster-1", name: "現存名單" };
  const state = sanitizeEventState({
    rosters: [roster],
    participants: [
      { id: "p1", name: "小明", rosterId: "roster-missing" },
      { id: "p2", name: "小美", rosterId: "roster-1" },
    ],
  });
  assert.equal(state.participants.length, 2);
  assert.ok(state.participants.every((participant) => participant.rosterId === "roster-1"));
});

test("normalize：重複 id 只保留第一筆", () => {
  const state = sanitizeEventState({
    rosters: [{ id: "r1", name: "名單" }],
    participants: [
      { id: "p1", name: "小明", rosterId: "r1" },
      { id: "p1", name: "小美（重複 id）", rosterId: "r1" },
    ],
  });
  assert.equal(state.participants.length, 1);
  assert.equal(state.participants[0].name, "小明");
});

test("normalize：得獎紀錄指向不存在的獎項會被捨棄", () => {
  const state = sanitizeEventState({
    prizes: [{ id: "prize-1", name: "特獎", totalCount: 5, drawnCount: 1 }],
    winners: [
      { id: "w1", prizeId: "prize-1", participantId: "p1", participantName: "小明", drawnAt: new Date().toISOString() },
      { id: "w2", prizeId: "prize-missing", participantId: "p2", participantName: "小美", drawnAt: new Date().toISOString() },
    ],
  });
  assert.equal(state.winners.length, 1);
  assert.equal(state.winners[0].id, "w1");
});

test("CSV 解析：辨識標題列與欄位順序", () => {
  const csv = "姓名,員工編號,部門\n小明,E001,業務\n小美,E002,業務\n";
  const { rows, warnings } = parseParticipantsCsv(csv);
  assert.deepEqual(rows, [
    { name: "小明", employeeId: "E001", department: "業務" },
    { name: "小美", employeeId: "E002", department: "業務" },
  ]);
  assert.equal(warnings.length, 0);
});

test("CSV 解析：沒有標題列時依固定欄位順序解讀，缺姓名的列會被略過並警告", () => {
  const csv = "小明,E001,業務\n,E999,無名\n小美,E002,業務\n";
  const { rows, warnings } = parseParticipantsCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /缺少姓名/);
});

test("CSV 解析：缺少員工編號的列不會匯入，並回報警告", () => {
  const { rows, warnings } = parseParticipantsCsv("姓名,員工編號,部門\n小明,,業務\n小美,E002,業務\n");
  assert.deepEqual(rows, [{ name: "小美", employeeId: "E002", department: "業務" }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /缺少員工編號/);
});

test("CSV 解析：相容參考專案使用的 emp_id／dept／prize／qty 欄位名稱", () => {
  const participants = parseParticipantsCsv("dept,emp_id,name\n業務,E001,小明\n");
  assert.deepEqual(participants.rows, [{ name: "小明", employeeId: "E001", department: "業務" }]);

  const { prizes } = parsePrizesCsv("order,prize,qty,allow_all\n1,頭獎,2,true\n", [], 0);
  assert.equal(prizes.length, 1);
  assert.equal(prizes[0].name, "頭獎");
  assert.equal(prizes[0].totalCount, 2);
  assert.equal(prizes[0].allowRepeatWinners, true);
});

test("mergeParticipantsFromCsv：員工編號重複時略過並回報，不會靜默重複加入", () => {
  const { state, rosterA } = buildBasicState();
  const { rows } = parseParticipantsCsv("姓名,員工編號,部門\n小新,E001,業務\n小剛,E010,業務\n");
  const result = mergeParticipantsFromCsv(state.participants, rows, rosterA.id);
  assert.equal(result.added, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /E001/);
  assert.equal(result.participants.length, state.participants.length + 1);
});

test("mergeParticipantsFromCsv：確認後同一名單的既有人員會更新資料並重新啟用", () => {
  const { state, rosterA } = buildBasicState();
  const existing = { ...state.participants[0], name: "舊姓名", department: "舊部門", active: false };
  const result = mergeParticipantsFromCsv(
    { ...state, participants: [existing] }.participants,
    [{ name: "新姓名", employeeId: existing.employeeId, department: "新部門" }],
    rosterA.id,
    { updateExistingInRoster: true },
  );
  assert.equal(result.added, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped.length, 0);
  assert.deepEqual(result.participants[0], { ...existing, name: "新姓名", department: "新部門", active: true });
});

test("mergeParticipantsFromCsv：確認後跨名單重複可依原版行為新增", () => {
  const { state, rosterB } = buildBasicState();
  const result = mergeParticipantsFromCsv(
    state.participants,
    [{ name: "跨組小明", employeeId: state.participants[0].employeeId, department: "活動組" }],
    rosterB.id,
    { updateExistingInRoster: true, allowCrossRosterDuplicates: true },
  );
  assert.equal(result.added, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.participants.filter((participant) => participant.employeeId === "E001").length, 2);
  assert.equal(result.participants.at(-1).rosterId, rosterB.id);
});

test("findDuplicateEmployeeId：忽略空字串、可排除自己", () => {
  const { state } = buildBasicState();
  assert.equal(findDuplicateEmployeeId(state.participants, ""), null);
  assert.ok(findDuplicateEmployeeId(state.participants, "E001"));
  assert.equal(findDuplicateEmployeeId(state.participants, "E001", state.participants[0].id), null);
});

test("CSV 解析：獎項 CSV 支援標題列、允許再參加與適用名單欄位", () => {
  const { rosterA, rosterB } = buildBasicState();
  const csv = `名稱,總數量,允許已得獎者再次參加,適用名單\n三獎,5,,${rosterA.name}\n特獎,1,是,${rosterA.name}、${rosterB.name}\n`;
  const { prizes, warnings } = parsePrizesCsv(csv, [rosterA, rosterB], 0);
  assert.equal(warnings.length, 0);
  assert.equal(prizes.length, 2);
  assert.equal(prizes[0].name, "三獎");
  assert.equal(prizes[0].totalCount, 5);
  assert.equal(prizes[0].allowRepeatWinners, false);
  assert.deepEqual(prizes[0].eligibleRosterIds, [rosterA.id]);
  assert.equal(prizes[1].allowRepeatWinners, true);
  assert.deepEqual(prizes[1].eligibleRosterIds, [rosterA.id, rosterB.id]);
});

test("CSV 解析：保留原版抽獎順序欄位", () => {
  const { rosterA, rosterB } = buildBasicState();
  const csv = `抽獎順序,獎項,數量\n2,二獎,1\n1,頭獎,1\n`;
  const { prizes, warnings } = parsePrizesCsv(csv, [rosterA, rosterB], 0);
  assert.equal(warnings.length, 0);
  assert.equal(prizes[0].order, 1);
  assert.equal(prizes[1].order, 0);
});

test("CSV 解析：獎項數量無效的列不會默默變成 1", () => {
  const { rosterA } = buildBasicState();
  const { prizes, warnings } = parsePrizesCsv("獎項,數量\n頭獎,\n二獎,abc\n三獎,2\n", [rosterA], 0);
  assert.equal(prizes.length, 1);
  assert.equal(prizes[0].name, "三獎");
  assert.equal(prizes[0].totalCount, 2);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /數量無效/);
});

test("candidatePool：只從指定名單群組抽取，且排除停用人員", () => {
  const { state, rosterB, prize } = buildBasicState();
  const restricted = { ...state, prizes: [{ ...prize, eligibleRosterIds: [rosterB.id] }] };
  const pool = candidatePool(restricted, prize.id);
  assert.deepEqual(pool.map((participant) => participant.name), ["小華"]);
});

test("candidatePool：eligibleRosterIds 為空代表所有群組都可參加", () => {
  const { state, prize } = buildBasicState();
  const pool = candidatePool(state, prize.id);
  assert.deepEqual(pool.map((participant) => participant.name).sort(), ["小明", "小美", "小華"]);
});

test("candidatePool：allowRepeatWinners=false 時排除已得獎者", () => {
  const { state, prize } = buildBasicState();
  const { nextState } = drawEventWinners(state, prize.id, 1);
  const pool = candidatePool(nextState, prize.id);
  const winnerId = nextState.winners[0].participantId;
  assert.ok(!pool.some((participant) => participant.id === winnerId));
});

test("candidatePool：allowRepeatWinners=true 時已得獎者可再次進入候選池", () => {
  const { state, prize } = buildBasicState();
  const repeatablePrize = { ...prize, allowRepeatWinners: true, totalCount: 3 };
  let current = { ...state, prizes: [repeatablePrize] };
  const { nextState } = drawEventWinners(current, prize.id, 1);
  const pool = candidatePool(nextState, prize.id);
  const winnerId = nextState.winners[0].participantId;
  assert.ok(pool.some((participant) => participant.id === winnerId));
});

test("drawEventWinners：安全抽選，抽出數量正確且不重複", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  const current = { ...state, prizes: [bigPrize] };
  const { winners } = drawEventWinners(current, prize.id, 3);
  assert.equal(winners.length, 3);
  assert.equal(new Set(winners.map((winner) => winner.participantId)).size, 3);
});

test("drawEventWinners：獎項剩餘數量不足時阻止抽選", () => {
  const { state, prize } = buildBasicState();
  assert.throws(() => drawEventWinners(state, prize.id, 3), /剩餘名額/);
});

test("drawEventWinners：候選人不足時拋出清楚錯誤", () => {
  const { state, prize } = buildBasicState();
  const hugePrize = { ...prize, totalCount: 100 };
  const current = { ...state, prizes: [hugePrize] };
  assert.throws(() => drawEventWinners(current, prize.id, 10), /候選人不足/);
});

test("drawEventWinners：找不到獎項會拋出清楚錯誤", () => {
  const { state } = buildBasicState();
  assert.throws(() => drawEventWinners(state, "missing-prize", 1), (error) => error instanceof EventLotteryError && /找不到指定的獎項/.test(error.message));
});

test("validateDraw：不合法的抽出人數會回報原因", () => {
  const { state, prize } = buildBasicState();
  assert.equal(validateDraw(state, prize.id, 0).ok, false);
  assert.equal(validateDraw(state, prize.id, 1.5).ok, false);
});

test("失格與名額歸還：獎項已抽數量減一，參加者恢復抽選資格，紀錄保留", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  const current = { ...state, prizes: [bigPrize] };
  const { winners, nextState } = drawEventWinners(current, prize.id, 1);
  const winnerId = winners[0].id;
  const afterDisqualify = disqualifyWinner(nextState, winnerId);

  const updatedPrize = afterDisqualify.prizes.find((item) => item.id === prize.id);
  assert.equal(updatedPrize.drawnCount, 0);

  const record = afterDisqualify.winners.find((winner) => winner.id === winnerId);
  assert.equal(record.disqualified, true);
  assert.ok(record.disqualifiedAt);
  assert.equal(afterDisqualify.winners.length, 1, "失格紀錄本身要保留，不能被刪除");

  const pool = candidatePool(afterDisqualify, prize.id);
  assert.ok(pool.some((participant) => participant.id === winners[0].participantId), "失格後應恢復抽選資格");
});

test("disqualifyWinner：重複失格是安全的 no-op，不會再扣一次名額", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  const current = { ...state, prizes: [bigPrize] };
  const { winners, nextState } = drawEventWinners(current, prize.id, 1);
  const once = disqualifyWinner(nextState, winners[0].id);
  const twice = disqualifyWinner(once, winners[0].id);
  assert.deepEqual(once, twice);
});

test("disqualifyWinner：找不到紀錄會拋出錯誤", () => {
  const { state } = buildBasicState();
  assert.throws(() => disqualifyWinner(state, "missing-winner"));
});

test("canDeletePrize：已有得獎紀錄（含失格）的獎項不能刪除", () => {
  const { state, prize } = buildBasicState();
  assert.equal(canDeletePrize(state, prize.id), true);
  const { nextState } = drawEventWinners(state, prize.id, 1);
  assert.equal(canDeletePrize(nextState, prize.id), false);
  const disqualified = disqualifyWinner(nextState, nextState.winners[0].id);
  assert.equal(canDeletePrize(disqualified, prize.id), false, "失格紀錄仍算歷史，不能刪除");
});

test("remainingSlots：不會小於 0", () => {
  const prize = createPrize({ name: "特獎", totalCount: 1, order: 0 });
  assert.equal(remainingSlots({ ...prize, drawnCount: 5 }), 0);
});

test("prepareStagePrize／clearStage／resetEventDraws：舞台與抽獎進度控制", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  let current = { ...state, prizes: [bigPrize] };
  current = prepareStagePrize(current, prize.id);
  assert.equal(current.activePrizeId, prize.id);
  assert.equal(current.pendingReveal, null);

  const { nextState } = drawEventWinners(current, prize.id, 1);
  assert.equal(nextState.pendingReveal.winnerIds.length, 1);
  assert.equal(nextState.pendingReveal.prizeId, prize.id);

  const cleared = clearStage(nextState);
  assert.equal(cleared.activePrizeId, null);
  assert.equal(cleared.pendingReveal, null);

  const resetState = resetEventDraws(nextState);
  assert.equal(resetState.winners.length, 0);
  assert.equal(resetState.prizes[0].drawnCount, 0);
  assert.equal(resetState.activePrizeId, null);
  assert.equal(resetState.pendingReveal, null);
  assert.equal(resetState.rosters.length, state.rosters.length, "重置只清空抽獎進度，名單要保留");
  assert.equal(resetState.participants.length, state.participants.length, "重置只清空抽獎進度，參加者要保留");
});

test("previewPrizeWinners：重新顯示歷史名單不會新增得獎紀錄或扣除名額", () => {
  const { state, prize } = buildBasicState();
  const { nextState } = drawEventWinners(state, prize.id, 1);
  const shownAt = new Date("2026-01-01T00:00:00.000Z");
  const preview = previewPrizeWinners(nextState, prize.id, shownAt);
  assert.equal(preview.stagePreview?.prizeId, prize.id);
  assert.equal(preview.stagePreview?.winnerIds.length, 1);
  assert.equal(preview.stagePreview?.revealAt, new Date(shownAt.getTime() + state.animationDurationMs).toISOString());
  assert.equal(preview.winners.length, nextState.winners.length);
  assert.equal(preview.prizes[0].drawnCount, nextState.prizes[0].drawnCount);
  assert.equal(resolveStageDisplay(preview, shownAt).phase, "preview");
  assert.equal(resolveStageDisplay(preview, shownAt).rolling, true);
});

test("previewPrizeWinners：歷史名單預覽會先滾動，動畫完成並停留後才允許下一步", () => {
  const { state, prize } = buildBasicState();
  const oneShotPrize = { ...prize, totalCount: 1 };
  const current = { ...state, prizes: [oneShotPrize] };
  const drawnAt = new Date("2026-01-01T00:00:00.000Z");
  const { nextState } = drawEventWinners(current, prize.id, 1, drawnAt);
  const shownAt = new Date("2026-01-01T00:01:00.000Z");
  const preview = previewPrizeWinners(nextState, prize.id, shownAt);
  const revealAt = new Date(preview.stagePreview.revealAt);

  assert.equal(resolveStageAdvance(preview, shownAt).action, "none");
  assert.equal(resolveStageDisplay(preview, new Date(revealAt.getTime() - 1)).rolling, true);
  assert.equal(resolveStageDisplay(preview, revealAt).rolling, false);
  assert.equal(resolveStageAdvance(preview, revealAt).action, "none");
  assert.deepEqual(resolveStageAdvance(preview, new Date(stagePreviewCompleteAt(preview.stagePreview))), { action: "clear" });
});

test("resolveStageDisplay：揭曉時間到之前是 drawing，到了之後是 revealed（純粹算時間，不靠計時器）", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const current = { ...state, prizes: [bigPrize] };
  const drawnAt = new Date("2026-01-01T00:00:00.000Z");
  const { nextState } = drawEventWinners(current, prize.id, 1, drawnAt);
  const revealAtMs = Date.parse(nextState.pendingReveal.revealAt);

  const beforeReveal = resolveStageDisplay(nextState, new Date(revealAtMs - 1));
  assert.equal(beforeReveal.phase, "drawing");

  const afterReveal = resolveStageDisplay(nextState, new Date(revealAtMs));
  assert.equal(afterReveal.phase, "revealed");
  assert.deepEqual(afterReveal.pendingReveal.winnerIds, nextState.pendingReveal.winnerIds);
});

test("resolveStageDisplay 回歸測試：控制台在動畫播完前重新整理或關閉分頁，舞台（或重新載入的控制台）仍能正確算出已揭曉——不會卡在準備中出不來", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const current = { ...state, prizes: [bigPrize] };
  const { nextState } = drawEventWinners(current, prize.id, 2, new Date("2026-01-01T00:00:00.000Z"));

  // 模擬：狀態已經寫進 localStorage，但負責倒數的分頁在動畫播完前就消失了
  // （重新整理或直接關閉）——不會再有任何計時器去補寫 stageWinnerIds。
  // 很久以後才重新讀取這份持久化狀態，仍然要能正確算出「已經揭曉」。
  const muchLater = new Date(Date.parse(nextState.pendingReveal.revealAt) + 5 * 60_000);
  const display = resolveStageDisplay(nextState, muchLater);
  assert.equal(display.phase, "revealed");
  assert.equal(display.pendingReveal.winnerIds.length, 2);
});

test("resolveStageDisplay：pendingReveal 跟 activePrizeId 對不上時忽略，回到 prepared", () => {
  const { state, prize } = buildBasicState();
  const otherPrize = createPrize({ name: "另一個獎項", totalCount: 1, order: 1 });
  const current = { ...state, prizes: [prize, otherPrize], activePrizeId: otherPrize.id };
  const { nextState } = drawEventWinners(current, prize.id, 1);
  // drawEventWinners 會把 activePrizeId 設成同一個獎項，這裡故意改壞來模擬損壞資料。
  const corrupted = { ...nextState, activePrizeId: otherPrize.id };
  const display = resolveStageDisplay(corrupted, new Date());
  assert.equal(display.phase, "prepared");
  assert.equal(display.prizeId, otherPrize.id);
});

test("sequentialStepMs：人數少時用預設間隔，人數多到會讓整輪超過一分鐘時自動壓縮", () => {
  assert.equal(sequentialStepMs(1), 0);
  assert.equal(sequentialStepMs(2), 1000);
  assert.equal(sequentialStepMs(10), 1000);
  const compressed = sequentialStepMs(500);
  assert.ok(compressed < 1000);
  assert.ok(compressed * 499 <= 60_000 + 1e-6, "500 人逐一揭曉的總時間不能超過一分鐘");
});

test("drawEventWinners：逐次抽出單一得獎者會保留原版 3 秒滾動時間", () => {
  const prize = createPrize({ name: "頭獎", totalCount: 1 });
  const state = { ...createEmptyEventState(), prizes: [prize], participants: [createParticipant({ name: "王小明", employeeId: "E001" })] };
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { nextState } = drawEventWinners(state, prize.id, 1, now);
  assert.equal(Date.parse(nextState.pendingReveal.revealAt), now.getTime() + DEFAULT_SINGLE_SEQUENTIAL_MS);
});

test("pendingRevealCompleteAt：逐一／一次揭曉都保留原版最後展示緩衝", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const sequentialState = { ...state, prizes: [bigPrize], revealMode: "sequential" };
  const { nextState } = drawEventWinners(sequentialState, prize.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const revealAtMs = Date.parse(nextState.pendingReveal.revealAt);
  const completeAt = pendingRevealCompleteAt(nextState.pendingReveal);
  assert.ok(completeAt > revealAtMs, "逐一揭曉三位，播完時間要晚於揭曉開始時間");
  assert.equal(completeAt, revealAtMs + 2 * nextState.pendingReveal.stepMs + PRESENTATION_SETTLE_MS);

  const simultaneousState = { ...state, prizes: [bigPrize], revealMode: "simultaneous" };
  const { nextState: simultaneousNext } = drawEventWinners(simultaneousState, prize.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(pendingRevealCompleteAt(simultaneousNext.pendingReveal), Date.parse(simultaneousNext.pendingReveal.revealAt) + PRESENTATION_SETTLE_MS);
});

test("visibleWinnerCount：逐一揭曉時純粹用經過的時間現算目前該顯示到第幾位", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const sequentialState = { ...state, prizes: [bigPrize], revealMode: "sequential" };
  const { nextState } = drawEventWinners(sequentialState, prize.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const pending = nextState.pendingReveal;
  const revealAtMs = Date.parse(pending.revealAt);

  assert.equal(visibleWinnerCount(pending, new Date(revealAtMs - 1)), 0, "揭曉時間到之前一位都還不該顯示");
  assert.equal(visibleWinnerCount(pending, new Date(revealAtMs)), 1, "揭曉時間一到，第一位立刻顯示");
  assert.equal(visibleWinnerCount(pending, new Date(revealAtMs + pending.stepMs)), 2);
  assert.equal(visibleWinnerCount(pending, new Date(revealAtMs + pending.stepMs * 2)), 3);
  assert.equal(visibleWinnerCount(pending, new Date(revealAtMs + pending.stepMs * 999)), 3, "不會超過總人數");
});

test("visibleWinnerCount 回歸測試：分頁被瀏覽器背景節流、計時器整批延遲，重新計算時直接跳到正確進度（不會因為漏掉某個 timer 就少顯示）", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const sequentialState = { ...state, prizes: [bigPrize], revealMode: "sequential" };
  const { nextState } = drawEventWinners(sequentialState, prize.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const pending = nextState.pendingReveal;
  // 模擬分頁被節流：第一次 tick 停在「還在揭曉中」，接著一大段時間完全沒有任何
  // tick 執行（例如背景分頁被暫停 30 秒），恢復後下一次 tick 距離 revealAt 已經
  // 遠遠超過三位的間隔——不管中間漏了幾次 tick，直接算出來的答案都要是滿的 3 位。
  const muchLater = new Date(Date.parse(pending.revealAt) + pending.stepMs * 50);
  assert.equal(visibleWinnerCount(pending, muchLater), 3);
});

test("visibleWinnerCount：一次揭曉或只有一位時，一律直接顯示全部，不分階段", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const simultaneousState = { ...state, prizes: [bigPrize], revealMode: "simultaneous" };
  const { nextState } = drawEventWinners(simultaneousState, prize.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const pending = nextState.pendingReveal;
  assert.equal(visibleWinnerCount(pending, new Date(Date.parse(pending.revealAt))), 3);

  const singleState = { ...state, prizes: [bigPrize], revealMode: "sequential" };
  const { nextState: singleNext } = drawEventWinners(singleState, prize.id, 1, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(visibleWinnerCount(singleNext.pendingReveal, new Date(Date.parse(singleNext.pendingReveal.revealAt))), 1);
});

test("resolveStageAdvance：空活動（沒有獎項）不做事", () => {
  const empty = createEmptyEventState();
  assert.deepEqual(resolveStageAdvance(empty), { action: "none" });
});

test("resolveStageAdvance：idle 狀態下，準備 order 最小、還有剩餘名額的獎項；已抽完的獎項會跳過", () => {
  const { state, prize } = buildBasicState();
  const soldOut = { ...prize, id: "prize-sold-out", order: 0, totalCount: 1, drawnCount: 1 };
  const nextUp = { ...prize, id: "prize-next", order: 1, totalCount: 2, drawnCount: 0 };
  const current = { ...state, prizes: [soldOut, nextUp] };
  assert.deepEqual(resolveStageAdvance(current), { action: "prepare", prizeId: "prize-next" });
});

test("resolveStageAdvance：prepared 狀態下，預設 stageDrawCount=1 時只抽 1 位，不會一次抽光剩餘名額", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const current = prepareStagePrize({ ...state, prizes: [bigPrize] }, prize.id);
  assert.equal(current.stageDrawCount, 1);
  assert.deepEqual(resolveStageAdvance(current), { action: "draw", prizeId: prize.id, count: 1 });
});

test("resolveStageAdvance：prepared 狀態下抽出人數＝min(stageDrawCount, 剩餘名額, 候選人數, MAX_DRAW_COUNT_PER_ROUND)", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  let current = prepareStagePrize({ ...state, prizes: [bigPrize], stageDrawCount: 2 }, prize.id);
  assert.deepEqual(resolveStageAdvance(current), { action: "draw", prizeId: prize.id, count: 2 }, "stageDrawCount 小於剩餘名額與候選人數時，直接用 stageDrawCount");

  // 候選人只有 3 位（buildBasicState），stageDrawCount 設得比剩餘名額還大時要被剩餘名額收斂。
  current = { ...current, stageDrawCount: 10 };
  assert.deepEqual(resolveStageAdvance(current), { action: "draw", prizeId: prize.id, count: 3 }, "不能超過獎項剩餘名額");

  // 剩餘名額給到很大，但候選人池只有 3 位，要被候選人數收斂。
  const hugePrize = { ...bigPrize, totalCount: 100 };
  current = prepareStagePrize({ ...state, prizes: [hugePrize], stageDrawCount: 50 }, prize.id);
  assert.deepEqual(resolveStageAdvance(current), { action: "draw", prizeId: prize.id, count: 3 }, "不能超過符合資格的候選人數");
});

test("resolveStageAdvance：正在揭曉中（drawing）時不做事，避免跟目前這輪疊在一起", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const current = { ...state, prizes: [bigPrize], animationDurationMs: 10_000 };
  const { nextState } = drawEventWinners(current, prize.id, 1, new Date("2026-01-01T00:00:00.000Z"));
  const midCountdown = new Date(Date.parse(nextState.pendingReveal.revealAt) - 1);
  assert.deepEqual(resolveStageAdvance(nextState, midCountdown), { action: "none" });
});

test("resolveStageAdvance：sequential 逐一揭曉時，revealAt 當下（第一位剛顯示）仍要回傳 none，不能準備下一獎項或再抽一次", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const current = { ...state, prizes: [bigPrize], revealMode: "sequential" };
  const { nextState } = drawEventWinners(current, prize.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const revealAtMs = Date.parse(nextState.pendingReveal.revealAt);
  assert.deepEqual(resolveStageAdvance(nextState, new Date(revealAtMs)), { action: "none" });
});

test("resolveStageAdvance：sequential 逐一揭曉在完整完成時間（pendingRevealCompleteAt）前 1ms 仍為 none", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3, order: 0 };
  const current = { ...state, prizes: [bigPrize], revealMode: "sequential" };
  const { nextState } = drawEventWinners(current, prize.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const completeAt = pendingRevealCompleteAt(nextState.pendingReveal);
  assert.deepEqual(resolveStageAdvance(nextState, new Date(completeAt - 1)), { action: "none" });
});

test("resolveStageAdvance：sequential 逐一揭曉到達完整完成時間後，才允許準備下一獎項", () => {
  const { state, prize } = buildBasicState();
  const prizeA = { ...prize, id: "prize-a", order: 0, totalCount: 3, drawnCount: 0 };
  const prizeB = { ...prize, id: "prize-b", order: 1, totalCount: 1, drawnCount: 0 };
  const current = { ...state, prizes: [prizeA, prizeB], revealMode: "sequential" };
  const { nextState } = drawEventWinners(current, prizeA.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const completeAt = pendingRevealCompleteAt(nextState.pendingReveal);
  assert.deepEqual(resolveStageAdvance(nextState, new Date(completeAt)), { action: "prepare", prizeId: prizeB.id });
});

test("resolveStageAdvance：simultaneous 一次揭曉會等原版展示緩衝後才前進", () => {
  const { state, prize } = buildBasicState();
  const prizeA = { ...prize, id: "prize-a", order: 0, totalCount: 3, drawnCount: 0 };
  const prizeB = { ...prize, id: "prize-b", order: 1, totalCount: 1, drawnCount: 0 };
  const current = { ...state, prizes: [prizeA, prizeB], revealMode: "simultaneous" };
  const { nextState } = drawEventWinners(current, prizeA.id, 3, new Date("2026-01-01T00:00:00.000Z"));
  const revealAtMs = Date.parse(nextState.pendingReveal.revealAt);
  const completeAt = pendingRevealCompleteAt(nextState.pendingReveal);
  assert.equal(completeAt, revealAtMs + PRESENTATION_SETTLE_MS);
  assert.deepEqual(resolveStageAdvance(nextState, new Date(revealAtMs)), { action: "none" });
  assert.deepEqual(resolveStageAdvance(nextState, new Date(completeAt)), { action: "prepare", prizeId: prizeB.id });
});

test("resolveStageAdvance：目前獎項已抽完後，準備下一個還有名額的獎項；最後一輪完成後回到首頁", () => {
  const { state, prize } = buildBasicState();
  const prizeA = { ...prize, id: "prize-a", order: 0, totalCount: 1, drawnCount: 0 };
  const prizeB = { ...prize, id: "prize-b", order: 1, totalCount: 1, drawnCount: 0 };
  const current = { ...state, prizes: [prizeA, prizeB] };
  const { nextState } = drawEventWinners(current, prizeA.id, 1, new Date("2026-01-01T00:00:00.000Z"));
  const afterReveal = new Date(pendingRevealCompleteAt(nextState.pendingReveal));
  assert.deepEqual(resolveStageAdvance(nextState, afterReveal), { action: "prepare", prizeId: prizeB.id });

  const { nextState: allDone } = drawEventWinners(nextState, prizeB.id, 1, new Date("2026-01-01T00:00:10.000Z"));
  const afterSecondReveal = new Date(pendingRevealCompleteAt(allDone.pendingReveal));
  assert.deepEqual(resolveStageAdvance(allDone, afterSecondReveal), { action: "clear" });
  assert.deepEqual(resolveStageAdvance({ ...allDone, activePrizeId: null, pendingReveal: null }, afterSecondReveal), { action: "none" });
});

test("disqualifyWinner：前台先顯示感謝訊息，再回到該獎項的重抽準備畫面", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  const current = { ...state, prizes: [bigPrize] };
  const { winners, nextState } = drawEventWinners(current, prize.id, 1);
  const disqualified = disqualifyWinner(nextState, winners[0].id);
  assert.equal(disqualified.pendingReveal, null);
  assert.equal(disqualified.stagePreview, null);
  assert.match(disqualified.stageNotice?.message ?? "", /無私奉獻/);
  assert.equal(resolveStageDisplay(disqualified).phase, "notice");
  assert.equal(resolveStageDisplay(disqualified, new Date(Date.parse(disqualified.stageNotice.until) + 1)).phase, "prepared");
  assert.equal(disqualified.winners.find((winner) => winner.id === winners[0].id).disqualified, true);
});

test("canDeleteParticipant／canDeleteRoster：已有得獎紀錄的人不可刪除，含他的名單群組也不可整組刪除", () => {
  const { state, prize, rosterA } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  const current = { ...state, prizes: [bigPrize] };
  const winnerParticipant = current.participants.find((participant) => participant.rosterId === rosterA.id);
  assert.equal(canDeleteParticipant(current, winnerParticipant.id), true);
  assert.equal(canDeleteRoster(current, rosterA.id), true);

  const { nextState } = drawEventWinners(current, prize.id, 1);
  // 找出這輪真正中獎的那個人（安全抽選是隨機的，不能假設是哪一位）。
  const wonParticipantId = nextState.winners[0].participantId;
  const wonParticipant = nextState.participants.find((participant) => participant.id === wonParticipantId);
  assert.equal(canDeleteParticipant(nextState, wonParticipantId), false);
  assert.equal(canDeleteRoster(nextState, wonParticipant.rosterId), false);

  // 失格之後歷史紀錄仍然存在（不會被刪除），所以還是不能刪除這個人或他的名單群組。
  const disqualified = disqualifyWinner(nextState, nextState.winners[0].id);
  assert.equal(canDeleteParticipant(disqualified, wonParticipantId), false);
  assert.equal(canDeleteRoster(disqualified, wonParticipant.rosterId), false);

  // 沒中獎的人不受影響，還是可以刪除。
  const untouchedParticipant = current.participants.find((participant) => participant.id !== wonParticipantId);
  assert.equal(canDeleteParticipant(nextState, untouchedParticipant.id), true);
});

test("空白活動不崩潰：所有查詢函式對空狀態都安全", () => {
  const empty = createEmptyEventState();
  assert.deepEqual(candidatePool(empty, "anything"), []);
  assert.equal(validateDraw(empty, "anything", 1).ok, false);
  assert.equal(winnersToCsv(empty), "﻿抽取時間,獎項,部門,姓名,員工編號,狀態");
  assert.equal(canDeletePrize(empty, "anything"), true);
});

test("winnersToCsv：欄位含逗號時正確跳脫", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  const current = { ...state, prizes: [bigPrize] };
  const { nextState } = drawEventWinners(current, prize.id, 1);
  const csv = winnersToCsv(nextState);
  assert.match(csv, /得獎/);
  assert.match(csv, new RegExp(nextState.winners[0].participantName));
});

test("JSON 備份匯出／匯入：往返後資料一致", () => {
  const { state, prize } = buildBasicState();
  const bigPrize = { ...prize, totalCount: 3 };
  const current = { ...state, prizes: [bigPrize] };
  const { nextState } = drawEventWinners(current, prize.id, 1);
  const backupText = exportEventBackup(nextState);
  const restored = parseEventBackup(JSON.parse(backupText));
  assert.equal(restored.eventTitle, nextState.eventTitle);
  assert.equal(restored.participants.length, nextState.participants.length);
  assert.equal(restored.winners.length, nextState.winners.length);
  assert.equal(restored.prizes[0].drawnCount, nextState.prizes[0].drawnCount);
});

test("JSON 備份匯入：不信任檔案內容，格式或版本錯誤要拒絕", () => {
  assert.throws(() => parseEventBackup({ format: "something-else" }), EventLotteryError);
  assert.throws(() => parseEventBackup({ format: "toolverse-event-lottery-backup", version: 999 }), EventLotteryError);
  assert.throws(() => parseEventBackup(null), EventLotteryError);
  assert.throws(() => parseEventBackup("not-an-object"), EventLotteryError);
});

test("eventBackupFileName：檔名清掉不安全字元", () => {
  const state = { ...createEmptyEventState(), eventTitle: "2026/尾牙:活動" };
  const name = eventBackupFileName(state, new Date("2026-01-15T00:00:00Z"));
  assert.doesNotMatch(name, /[\\/:*?"<>|]/);
  assert.match(name, /2026-01-15\.json$/);
});
