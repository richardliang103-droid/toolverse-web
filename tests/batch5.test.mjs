import assert from "node:assert/strict";
import test from "node:test";
import { diffRows, diffTokens } from "../lib/diff.ts";
import { detectDelimiter, parseDelimited, sortRows, toDelimitedText, toJsonText } from "../lib/csv.ts";
import { clampTrimRange, encodeWavPcm16, formatSeconds } from "../lib/wav.ts";

const OPTS = { granularity: "line", ignoreCase: false, ignoreWhitespace: false };

test("diffTokens：行級新增刪除與相等合併", () => {
  const ops = diffTokens("a\nb\nc", "a\nx\nc", OPTS);
  assert.deepEqual(ops.map((op) => op.type), ["equal", "remove", "add", "equal"]);
  assert.equal(ops[1].text, "b");
  assert.equal(ops[2].text, "x");
});

test("diffRows：修改配對與統計", () => {
  const { rows, stats } = diffRows("一\n二\n三", "一\n貳\n三\n四", OPTS);
  assert.deepEqual(stats, { added: 1, removed: 0, modified: 1 });
  assert.equal(rows.find((row) => row.kind === "modify")?.left, "二");
  assert.equal(rows.find((row) => row.kind === "add")?.right, "四");
});

test("diff 選項：忽略大小寫與空白", () => {
  assert.ok(diffTokens("Hello World", "hello   world", { granularity: "word", ignoreCase: true, ignoreWhitespace: true }).every((op) => op.type === "equal"));
  assert.ok(diffTokens("Hello", "hello", { granularity: "char", ignoreCase: false, ignoreWhitespace: false }).some((op) => op.type !== "equal"));
});

test("diff 逐詞：中文沒有空格也要斷得出詞", () => {
  const wordOpts = { granularity: "word", ignoreCase: false, ignoreWhitespace: false };
  const ops = diffTokens("今天天氣很好", "今天天氣很糟", wordOpts);
  // 舊的 /\S+|\s+/ 會把整句當成一個 token，結果是整段刪除＋整段新增；
  // 斷得出詞的話「今天天氣」要保持相等，只有最後一個詞不同。
  assert.ok(ops.some((op) => op.type === "equal" && op.text.includes("今天")));
  assert.ok(ops.some((op) => op.type === "remove" && op.text === "很好"));
  assert.ok(ops.some((op) => op.type === "add" && op.text === "很糟"));
  // 不論切法為何，還原後都必須等於原文，呈現才不會失真。
  assert.equal(ops.filter((op) => op.type !== "add").map((op) => op.text).join(""), "今天天氣很好");
  assert.equal(ops.filter((op) => op.type !== "remove").map((op) => op.text).join(""), "今天天氣很糟");
});

test("diff 逐字：不拆散組合字元", () => {
  const charOpts = { granularity: "char", ignoreCase: false, ignoreWhitespace: false };
  const ops = diffTokens("a👨‍👩‍👧‍👦b", "a👨‍👩‍👧‍👦c", charOpts);
  // 家庭 emoji 由 7 個 code point 組成，逐字比較不該把它切開來，
  // 否則只改了尾字卻會顯示成 emoji 也被改動。
  assert.ok(ops.some((op) => op.type === "equal" && op.text.includes("👨‍👩‍👧‍👦")));
  assert.ok(ops.some((op) => op.type === "remove" && op.text === "b"));
  assert.ok(ops.some((op) => op.type === "add" && op.text === "c"));
});

test("csv：分隔符偵測、解析、欄數對齊", () => {
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  const rows = parseDelimited('名字,"備註,含逗號"\n小明,"說 ""你好"""\n單欄', ",");
  assert.deepEqual(rows[0], ["名字", "備註,含逗號"]);
  assert.deepEqual(rows[1], ["小明", '說 "你好"']);
  assert.deepEqual(rows[2], ["單欄", ""]);
});

test("csv：sep=X 宣告列會被當成分隔符指示，不會被解析成資料列", () => {
  const withSemicolon = "sep=;\n名字;分機\n小明;120\n";
  assert.equal(detectDelimiter(withSemicolon), ";");
  const rows = parseDelimited(withSemicolon, detectDelimiter(withSemicolon));
  assert.deepEqual(rows, [["名字", "分機"], ["小明", "120"]]);
});

test("csv：BOM＋sep=, 宣告列同時存在時仍正確剝除，不影響後面的資料列", () => {
  const withBomAndSep = "﻿sep=,\r\n名字,分機\r\n小明,120\r\n";
  assert.equal(detectDelimiter(withBomAndSep), ",");
  const rows = parseDelimited(withBomAndSep, ",");
  assert.deepEqual(rows, [["名字", "分機"], ["小明", "120"]]);
});

test("csv：沒有 sep= 宣告列時行為不變（純粹用內容啟發式偵測）", () => {
  assert.equal(detectDelimiter("名字,分機\n小明,120"), ",");
  assert.deepEqual(parseDelimited("名字,分機\n小明,120", ","), [["名字", "分機"], ["小明", "120"]]);
});

test("csv：round-trip 與 JSON 匯出", () => {
  const rows = [["名字", "分機"], ["小明,A", "120"], ['引"號', "241"]];
  const text = toDelimitedText(rows);
  assert.ok(text.startsWith("﻿"));
  assert.deepEqual(parseDelimited(text, ","), rows);
  const json = JSON.parse(toJsonText(rows, true));
  assert.deepEqual(json[0], { "名字": "小明,A", "分機": "120" });
  const noHeader = JSON.parse(toJsonText(rows, false));
  assert.equal(noHeader.length, 3);
});

test("csv：排序（數值欄與文字欄）", () => {
  const rows = [["品名", "價格"], ["b", "30"], ["a", "9"], ["c", "100"]];
  const byPrice = sortRows(rows, 1, "asc", true);
  assert.deepEqual(byPrice.slice(1).map((row) => row[1]), ["9", "30", "100"]);
  const byName = sortRows(rows, 0, "desc", true);
  assert.deepEqual(byName.slice(1).map((row) => row[0]), ["c", "b", "a"]);
});

test("wav：RIFF 標頭與資料大小", () => {
  const left = new Float32Array([0, 0.5, -0.5, 1]);
  const buffer = encodeWavPcm16([left, left], 44100);
  const view = new DataView(buffer);
  const ascii = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 4 * 2 * 2);
  assert.equal(buffer.byteLength, 44 + 16);
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(50, true), Math.round(0.5 * 0x7fff));
});

test("wav：秒數格式與範圍防呆", () => {
  assert.equal(formatSeconds(0), "00:00.0");
  assert.equal(formatSeconds(75.2), "01:15.2");
  assert.deepEqual(clampTrimRange(-5, 999, 30), { start: 0, end: 30 });
  assert.deepEqual(clampTrimRange(10, 10, 30), { start: 10, end: 10.1 });
});
