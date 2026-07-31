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

test("text encoding: auto mode picks Windows-1252 for Western-European ANSI text, not Big5", () => {
  // 這幾個字（重音字母＋英文字母）在寬鬆解碼下也會被 Big5 解碼器當成合法的
  // 雙位元組字元（不出現替代字元），過去單靠有無替代字元判斷會誤判成 Big5，
  // 變成一串亂碼；這裡的每個字都不含中文，必須正確判斷成 windows-1252。
  for (const text of ["Löwe", "être", "façade"]) {
    const bytes = Uint8Array.from([...text].map((ch) => ch.codePointAt(0)));
    const decoded = decodeTextBytes(bytes, "auto");
    assert.equal(decoded.encoding, "windows-1252", `${text} 應判斷成 windows-1252`);
    assert.equal(decoded.text, text);
  }
});

test("text encoding: auto mode still picks Big5 for real Chinese CSV-style content mixed with ASCII", () => {
  // 中文字跟英數字之間一定有逗號分隔（不像上面誤判案例那樣直接黏在一起），
  // 確保新增的懲罰規則不會誤傷真正的中文 CSV 內容。
  const bytes = Uint8Array.from([164, 112, 169, 250, 44, 69, 48, 48, 49, 44, 183, 126, 176, 200]); // "小明,E001,業務"
  const decoded = decodeTextBytes(bytes, "auto");
  assert.equal(decoded.encoding, "big5");
  assert.equal(decoded.text, "小明,E001,業務");
});
