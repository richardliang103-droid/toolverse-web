import assert from "node:assert/strict";
import test from "node:test";
import { normalizeParticipants } from "../lib/lottery.ts";

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
