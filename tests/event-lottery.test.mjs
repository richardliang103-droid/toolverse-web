import assert from "node:assert/strict";
import test from "node:test";
import {
  candidatePool,
  canDeletePrize,
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
  mergeParticipantsFromCsv,
  parseEventBackup,
  parseParticipantsCsv,
  parsePrizesCsv,
  prepareStagePrize,
  remainingSlots,
  resetEventDraws,
  sanitizeEventState,
  validateDraw,
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
  assert.equal(state.eventTitle, "活動抽獎");
  assert.equal(state.rosters.length, 0);
  // 沒有任何名單群組時，參加者找不到有效 rosterId，應該被安全捨棄而不是讓整份資料壞掉。
  assert.equal(state.participants.length, 0);
  assert.equal(state.prizes.length, 1);
  assert.equal(state.prizes[0].totalCount, 1);
  assert.equal(state.winners.length, 0);
  assert.equal(state.revealMode, "sequential");
  assert.equal(state.animationDurationMs, 3200);
  assert.equal(state.soundEnabled, true);
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

test("mergeParticipantsFromCsv：員工編號重複時略過並回報，不會靜默重複加入", () => {
  const { state, rosterA } = buildBasicState();
  const { rows } = parseParticipantsCsv("姓名,員工編號,部門\n小新,E001,業務\n小剛,E010,業務\n");
  const result = mergeParticipantsFromCsv(state.participants, rows, rosterA.id);
  assert.equal(result.added, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /E001/);
  assert.equal(result.participants.length, state.participants.length + 1);
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
  assert.deepEqual(current.stageWinnerIds, []);

  const { nextState } = drawEventWinners(current, prize.id, 1);
  assert.equal(nextState.stageWinnerIds.length, 1);

  const cleared = clearStage(nextState);
  assert.equal(cleared.activePrizeId, null);
  assert.deepEqual(cleared.stageWinnerIds, []);

  const resetState = resetEventDraws(nextState);
  assert.equal(resetState.winners.length, 0);
  assert.equal(resetState.prizes[0].drawnCount, 0);
  assert.equal(resetState.activePrizeId, null);
  assert.equal(resetState.rosters.length, state.rosters.length, "重置只清空抽獎進度，名單要保留");
  assert.equal(resetState.participants.length, state.participants.length, "重置只清空抽獎進度，參加者要保留");
});

test("空白活動不崩潰：所有查詢函式對空狀態都安全", () => {
  const empty = createEmptyEventState();
  assert.deepEqual(candidatePool(empty, "anything"), []);
  assert.equal(validateDraw(empty, "anything", 1).ok, false);
  assert.equal(winnersToCsv(empty), "﻿抽出時間,獎項,姓名,員工編號,部門,狀態");
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
