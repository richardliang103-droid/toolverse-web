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

test("text encoding: auto mode must not misdetect common Big5 department/building codes that mix a bare Latin letter directly against Chinese characters", () => {
  // 「A組」「B棟」這類部門／棟別代號，中文字直接接著單一英文字母、中間沒有
  // 逗號或空白分隔，在台灣的名單／CSV 資料裡極為常見。曾經試過用「英文字母
  // 緊貼中文字」當懲罰訊號來抓西歐語系「ANSI」誤判（見下一個測試），結果
  // 反而把這些常見的合法中文內容也一起誤判成 windows-1252，變成亂碼——這是
  // 比原本要修的問題更嚴重的迴歸，所以那個懲罰規則已經移除，這裡把當初壓垮
  // 它的具體案例都釘成測試，防止同樣的迴歸再發生。
  const cases = [
    ["AI部門", [65, 73, 179, 161, 170, 249]],
    ["A組", [65, 178, 213]],
    ["B棟", [66, 180, 201]],
    ["台北A區", [165, 120, 165, 95, 65, 176, 207]],
    ["HR名單", [72, 82, 166, 87, 179, 230]],
    ["E001王小明", [69, 48, 48, 49, 164, 253, 164, 112, 169, 250]],
  ];
  for (const [text, bytes] of cases) {
    const decoded = decodeTextBytes(Uint8Array.from(bytes), "auto");
    assert.equal(decoded.encoding, "big5", `${text} 應判斷成 big5`);
    assert.equal(decoded.text, text);
  }
});

test("text encoding: auto mode still picks Big5 for real Chinese CSV-style content mixed with ASCII", () => {
  const bytes = Uint8Array.from([164, 112, 169, 250, 44, 69, 48, 48, 49, 44, 183, 126, 176, 200]); // "小明,E001,業務"
  const decoded = decodeTextBytes(bytes, "auto");
  assert.equal(decoded.encoding, "big5");
  assert.equal(decoded.text, "小明,E001,業務");
});

test("text encoding: auto mode falling back to Big5 for Western-European ANSI text is a known, accepted trade-off, not a bug — manual override exists", () => {
  // Big5 的寬鬆解碼幾乎不會因為亂碼而失敗，單靠有無替代字元判斷不出真正的
  // 西歐語系文字；這個工具的預設情境是台灣使用者的繁體中文匯出檔，判斷平手
  // 時故意偏向 Big5。真的遇到西歐語系「ANSI」內容時，使用者可以手動切換。
  const decoded = decodeTextBytes(Uint8Array.from([...("Löwe")].map((ch) => ch.codePointAt(0))), "windows-1252");
  assert.equal(decoded.text, "Löwe");
});
