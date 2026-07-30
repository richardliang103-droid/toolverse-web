import assert from "node:assert/strict";
import test from "node:test";
import { decodeTextBytes, encodingLabel } from "../lib/text-encoding.ts";

test("text encoding: UTF-8 BOM is detected and removed", () => {
  const bytes = new TextEncoder().encode("\uFEFF姓名,部門\n小明,行銷");
  const decoded = decodeTextBytes(bytes);
  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.source, "bom");
  assert.equal(decoded.text, "姓名,部門\n小明,行銷");
});

test("text encoding: Traditional Chinese ANSI bytes fall back to Big5", () => {
  const decoded = decodeTextBytes(new Uint8Array([0xa4, 0x70, 0xa9, 0xfa]), "big5");
  assert.equal(decoded.encoding, "big5");
  assert.equal(decoded.text, "小明");
  assert.equal(encodingLabel(decoded.encoding), "Big5／ANSI 繁中");
});
