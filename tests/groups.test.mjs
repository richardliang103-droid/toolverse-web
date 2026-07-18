import assert from "node:assert/strict";
import test from "node:test";
import { groupsToCsv, groupsToText, resolveGroupCount, splitIntoGroups } from "../lib/groups.ts";

const NAMES = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];

test("resolveGroupCount handles both modes and edge cases", () => {
  assert.equal(resolveGroupCount(10, "byCount", 3), 3);
  assert.equal(resolveGroupCount(10, "byCount", 99), 10); // 組數不會超過人數
  assert.equal(resolveGroupCount(10, "bySize", 4), 3);    // 每組 4 人 → 3 組
  assert.equal(resolveGroupCount(10, "bySize", 10), 1);
  assert.equal(resolveGroupCount(10, "bySize", 1), 10);
  assert.equal(resolveGroupCount(0, "byCount", 3), 0);
  assert.equal(resolveGroupCount(10, "byCount", 0), 0);
  assert.equal(resolveGroupCount(10, "bySize", -2), 0);
  assert.equal(resolveGroupCount(10, "byCount", 2.5), 0);
});

test("splitIntoGroups keeps every member exactly once", () => {
  const { groups } = splitIntoGroups(NAMES, "byCount", 3);
  const flattened = groups.flat().sort();
  assert.deepEqual(flattened, [...NAMES].sort());
});

test("splitIntoGroups balances sizes within one member", () => {
  const { groups, groupCount } = splitIntoGroups(NAMES, "byCount", 3);
  assert.equal(groupCount, 3);
  const sizes = groups.map((group) => group.length);
  assert.deepEqual(sizes, [4, 3, 3]); // 多的往前面組放
});

test("splitIntoGroups bySize computes the right number of groups", () => {
  const { groups } = splitIntoGroups(NAMES, "bySize", 4);
  assert.equal(groups.length, 3);
  for (const group of groups) assert.ok(group.length >= 3 && group.length <= 4);
});

test("splitIntoGroups throws on empty or invalid input", () => {
  assert.throws(() => splitIntoGroups([], "byCount", 3));
  assert.throws(() => splitIntoGroups(NAMES, "byCount", 0));
});

test("splitIntoGroups actually shuffles", () => {
  // 20 人分 1 組，重複 12 次至少要出現一次與原順序不同的排列。
  const many = Array.from({ length: 20 }, (_, index) => `p${index}`);
  const different = Array.from({ length: 12 }, () => splitIntoGroups(many, "byCount", 1).groups[0].join(","))
    .some((order) => order !== many.join(","));
  assert.ok(different, "洗牌 12 次全部保持原順序，機率上幾乎不可能");
});

test("text and csv exports include every group and member", () => {
  const groups = [["小明", "小美"], ["Alex"]];
  const text = groupsToText(groups);
  assert.match(text, /第 1 組（2 人）：小明、小美/);
  assert.match(text, /第 2 組（1 人）：Alex/);
  const csv = groupsToCsv(groups);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /第 1 組,小明/);
  assert.match(csv, /第 2 組,Alex/);
  assert.equal(csv.split("\r\n").length, 4); // 表頭 + 3 位成員
});
