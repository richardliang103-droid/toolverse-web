import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyWinnerNames, normalizeParticipants } from "../lib/lottery.ts";

test("lottery: duplicate labels remain distinct entries when deduplication is off", () => {
  const participants = normalizeParticipants("小明\n小明\n小美", false);
  assert.deepEqual(participants.map((participant) => participant.label), ["小明", "小明", "小美"]);
  assert.equal(new Set(participants.map((participant) => participant.id)).size, 3);
  assert.notEqual(participants[0].id, participants[1].id);
});

test("lottery: deduplication preserves one entry per label", () => {
  const participants = normalizeParticipants("小明\n小明\n小美", true);
  assert.deepEqual(participants.map((participant) => participant.label), ["小明", "小美"]);
});

test("migrateLegacyWinnerNames：名稱對應到與 normalizeParticipants 一致的籤 id", () => {
  const ids = migrateLegacyWinnerNames(["小明", "小美", "小明"]);
  assert.deepEqual(ids, ["小明\u00000", "小美\u00000", "小明\u00001"]);
  const participants = normalizeParticipants("小明\n小美\n小明", false);
  for (const id of ids) {
    assert.ok(participants.some((participant) => participant.id === id), "遷移出的 id 應對應到現有籤");
  }
  assert.deepEqual(migrateLegacyWinnerNames([]), []);
});
