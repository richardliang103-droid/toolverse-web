import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AMOUNT,
  MAX_EXPENSES,
  MAX_PARTICIPANTS,
  calculateExpenseSplit,
  formatTwd,
  sanitizeExpenseSplitDraft,
  sanitizeExpenses,
  sanitizeParticipants,
  settlementText,
  toTwdAmount,
} from "../lib/expense-splitter.ts";

const PEOPLE = [
  { id: "a", name: "小安" },
  { id: "b", name: "小白" },
  { id: "c", name: "小岑" },
];

test("金額統一取整數元、夾住負數與過大值", () => {
  assert.equal(toTwdAmount(12.5), 13);
  assert.equal(toTwdAmount(-1), 0);
  assert.equal(toTwdAmount("42"), 42);
  assert.equal(toTwdAmount(Number.NaN), 0);
  assert.equal(toTwdAmount(MAX_AMOUNT + 1), MAX_AMOUNT);
});

test("參加者清理：去除空白、重複名稱與重複 id，並保留合法順序", () => {
  assert.deepEqual(sanitizeParticipants([
    { id: "a", name: " 小安 " },
    { id: "a", name: "另一位" },
    { id: "b", name: "小安" },
    { id: "c", name: "" },
    { id: "d", name: "小白" },
  ]), [{ id: "a", name: "小安" }, { id: "d", name: "小白" }]);
});

test("參加者與支出都有上限，損壞草稿不會讓頁面失效", () => {
  const manyPeople = Array.from({ length: MAX_PARTICIPANTS + 3 }, (_, index) => ({ id: `p-${index}`, name: `人 ${index}` }));
  const participants = sanitizeParticipants(manyPeople);
  assert.equal(participants.length, MAX_PARTICIPANTS);
  const manyExpenses = Array.from({ length: MAX_EXPENSES + 3 }, (_, index) => ({ id: `e-${index}`, paidBy: participants[0].id, sharedBy: [participants[0].id], amount: 10 }));
  assert.equal(sanitizeExpenses(manyExpenses, participants).length, MAX_EXPENSES);
  assert.deepEqual(sanitizeExpenseSplitDraft("broken"), { participants: [], expenses: [] });
});

test("支出清理移除不存在的付款人／分帳人與重複 id", () => {
  const expenses = sanitizeExpenses([
    { id: "ok", description: "午餐", amount: 99.6, paidBy: "a", sharedBy: ["a", "b", "b", "missing"] },
    { id: "ok", paidBy: "a", sharedBy: ["a"], amount: 10 },
    { id: "bad", paidBy: "missing", sharedBy: ["a"], amount: 10 },
  ], PEOPLE);
  assert.deepEqual(expenses, [{ id: "ok", description: "午餐", amount: 100, paidBy: "a", sharedBy: ["a", "b"] }]);
});

test("三人均分時，餘數會確實分配且所有淨額加總為零", () => {
  const result = calculateExpenseSplit(PEOPLE, [{ id: "lunch", description: "午餐", amount: 100, paidBy: "a", sharedBy: ["a", "b", "c"] }]);
  assert.equal(result.totalAmount, 100);
  assert.equal(result.includedExpenseCount, 1);
  assert.deepEqual(result.balances.map((balance) => [balance.id, balance.amount]), [["a", 66], ["b", -33], ["c", -33]]);
  assert.equal(result.balances.reduce((sum, balance) => sum + balance.amount, 0), 0);
  assert.deepEqual(result.settlements.map((settlement) => [settlement.from.id, settlement.to.id, settlement.amount]), [["b", "a", 33], ["c", "a", 33]]);
});

test("多人多筆支出會先抵銷淨額，再給出精簡且守恆的轉帳", () => {
  const result = calculateExpenseSplit(PEOPLE, [
    { id: "dinner", description: "晚餐", amount: 100, paidBy: "a", sharedBy: ["a", "b", "c"] },
    { id: "taxi", description: "車資", amount: 50, paidBy: "b", sharedBy: ["b", "c"] },
  ]);
  assert.deepEqual(result.balances.map((balance) => [balance.id, balance.amount]), [["a", 66], ["b", -8], ["c", -58]]);
  assert.deepEqual(result.settlements.map((settlement) => [settlement.from.id, settlement.to.id, settlement.amount]), [["c", "a", 58], ["b", "a", 8]]);
  assert.equal(result.settlements.reduce((sum, settlement) => sum + settlement.amount, 0), 66);
});

test("付款者不在分帳人中也能正確處理", () => {
  const result = calculateExpenseSplit(PEOPLE, [{ id: "gift", description: "禮物", amount: 90, paidBy: "a", sharedBy: ["b", "c"] }]);
  assert.deepEqual(result.balances.map((balance) => [balance.id, balance.amount]), [["a", 90], ["b", -45], ["c", -45]]);
});

test("零金額與沒有分帳人的草稿不計入結算", () => {
  const result = calculateExpenseSplit(PEOPLE, [
    { id: "zero", description: "", amount: 0, paidBy: "a", sharedBy: ["a"] },
    { id: "none", description: "", amount: 100, paidBy: "a", sharedBy: [] },
  ]);
  assert.equal(result.totalAmount, 0);
  assert.equal(result.includedExpenseCount, 0);
  assert.deepEqual(result.settlements, []);
});

test("結算不修改傳入的資料，也不會產生自己轉給自己", () => {
  const expenses = [{ id: "one", description: "", amount: 10, paidBy: "a", sharedBy: ["a", "b"] }];
  const before = structuredClone(expenses);
  const result = calculateExpenseSplit(PEOPLE, expenses);
  assert.deepEqual(expenses, before);
  assert.ok(result.settlements.every((settlement) => settlement.from.id !== settlement.to.id));
});

test("格式化結果可直接複製給旅伴", () => {
  const result = calculateExpenseSplit(PEOPLE, [{ id: "one", description: "", amount: 20, paidBy: "a", sharedBy: ["a", "b"] }]);
  assert.equal(formatTwd(1234567), "NT$1,234,567");
  assert.match(settlementText(result), /小白 → 小安：NT\$10/);
  assert.match(settlementText(result), /各自淨額/);
});
