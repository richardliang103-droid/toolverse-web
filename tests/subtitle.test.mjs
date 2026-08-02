import assert from "node:assert/strict";
import test from "node:test";
import {
  SubtitleParseError,
  detectSubtitleFormat,
  filterCuesByRange,
  findCueProblems,
  formatTimecode,
  frameRateFactor,
  mergeAdjacentCues,
  parseSrt,
  parseSubtitle,
  parseTimecode,
  parseVtt,
  renumberCues,
  scaleCues,
  serializeCues,
  shiftCues,
  stripCueTags,
  toPlainText,
  toSrt,
  toVtt,
  totalDurationMs,
} from "../lib/subtitle.ts";

const SRT_SAMPLE = [
  "1",
  "00:00:01,000 --> 00:00:03,500",
  "第一句字幕",
  "",
  "2",
  "00:00:04,000 --> 00:00:06,250",
  "第二句字幕",
  "換行的第二行",
  "",
].join("\n");

const VTT_SAMPLE = [
  "WEBVTT",
  "",
  "00:00:01.000 --> 00:00:03.500",
  "第一句字幕",
  "",
  "00:00:04.000 --> 00:00:06.250",
  "第二句字幕",
  "換行的第二行",
  "",
].join("\n");

// ---------- 時間碼 ----------

test("formatTimecode：SRT 用逗號、VTT 用句點，欄位補零", () => {
  assert.equal(formatTimecode(1500, "srt"), "00:00:01,500");
  assert.equal(formatTimecode(1500, "vtt"), "00:00:01.500");
  assert.equal(formatTimecode(0), "00:00:00,000");
  assert.equal(formatTimecode(3_723_004, "srt"), "01:02:03,004");
  // 超過 99 小時不截斷，寧可欄位變寬也不要偷偷丟掉時間。
  assert.equal(formatTimecode(360_000_000, "srt"), "100:00:00,000");
});

test("formatTimecode：負數夾到 0，小數四捨五入後正確進位", () => {
  assert.equal(formatTimecode(-1), "00:00:00,000");
  assert.equal(formatTimecode(-5_000), "00:00:00,000");
  // 999.6 ms 要進位成整整一秒，不能變成 00:00:00,1000。
  assert.equal(formatTimecode(999.6), "00:00:01,000");
  assert.equal(formatTimecode(59_999.7), "00:01:00,000");
  assert.equal(formatTimecode(3_599_999.5), "01:00:00,000");
});

test("formatTimecode：非有限數字直接報錯，不會產生 NaN 時間碼", () => {
  assert.throws(() => formatTimecode(Number.NaN), TypeError);
  assert.throws(() => formatTimecode(Number.POSITIVE_INFINITY), TypeError);
});

test("parseTimecode：兩種毫秒分隔符與省略小時的 VTT 寫法都吃", () => {
  assert.equal(parseTimecode("00:00:01,500"), 1500);
  assert.equal(parseTimecode("00:00:01.500"), 1500);
  assert.equal(parseTimecode("01:02:03.004"), 3_723_004);
  assert.equal(parseTimecode("01:30.500"), 90_500);
  // 毫秒不足三位是右補零：`,5` 是 500 ms。
  assert.equal(parseTimecode("00:00:01,5"), 1500);
  assert.equal(parseTimecode("00:00:01,05"), 1050);
  assert.equal(parseTimecode("  00:00:02,000  "), 2000);
});

test("parseTimecode：格式錯誤丟 SubtitleParseError，訊息說得出是哪一行、哪個值", () => {
  assert.throws(() => parseTimecode("不是時間碼", 7), (error) => {
    assert.ok(error instanceof SubtitleParseError);
    assert.equal(error.line, 7);
    assert.match(error.message, /第 7 行/);
    assert.match(error.message, /不是時間碼/);
    return true;
  });
  assert.throws(() => parseTimecode("00:00:01"), SubtitleParseError);
  assert.throws(() => parseTimecode("00:99:00,000"), /分鐘超過 59/);
  assert.throws(() => parseTimecode("00:00:99,000"), /秒數超過 59/);
});

test("時間碼往返：格式化再解析回來完全相等", () => {
  for (const ms of [0, 1, 999, 1000, 59_999, 60_000, 3_599_999, 3_600_000, 45_296_789]) {
    assert.equal(parseTimecode(formatTimecode(ms, "srt")), ms, `${ms} 的 SRT 往返不一致`);
    assert.equal(parseTimecode(formatTimecode(ms, "vtt")), ms, `${ms} 的 VTT 往返不一致`);
  }
});

// ---------- 解析 ----------

test("parseSrt：序號、時間、多行內容都解析正確", () => {
  const cues = parseSrt(SRT_SAMPLE);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { index: 1, startMs: 1000, endMs: 3500, text: "第一句字幕" });
  assert.equal(cues[1].index, 2);
  assert.equal(cues[1].startMs, 4000);
  assert.equal(cues[1].endMs, 6250);
  assert.equal(cues[1].text, "第二句字幕\n換行的第二行");
});

test("parseSrt：容忍 CRLF、BOM、缺序號與亂跳的序號，輸出一律重新編號", () => {
  const messy = "\uFEFF9\r\n00:00:01,000 --> 00:00:02,000\r\n甲\r\n\r\n00:00:03,000 --> 00:00:04,000\r\n乙\r\n";
  const cues = parseSrt(messy);
  assert.deepEqual(cues.map((cue) => cue.index), [1, 2]);
  assert.deepEqual(cues.map((cue) => cue.text), ["甲", "乙"]);
});

test("parseSrt：空字串與純空白回傳空陣列，不算錯誤", () => {
  assert.deepEqual(parseSrt(""), []);
  assert.deepEqual(parseSrt("   \n\n  \n"), []);
});

test("parseVtt：吃 WEBVTT 標頭、metadata、NOTE 區塊、cue 識別字與 cue 設定", () => {
  const vtt = [
    "WEBVTT Kind: captions",
    "Language: zh-Hant",
    "",
    "NOTE 這段是註解",
    "不該被當成字幕",
    "",
    "intro",
    "00:00:01.000 --> 00:00:03.500 align:start line:90%",
    "第一句字幕",
    "",
    "00:01:30.500 --> 00:01:32.000",
    "第二句字幕",
    "",
  ].join("\n");
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].id, "intro");
  assert.equal(cues[0].settings, "align:start line:90%");
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[1].startMs, 90_500);
  assert.equal(cues[1].id, undefined);
  assert.equal(cues[1].settings, undefined);
});

test("parseVtt：沒有 WEBVTT 標頭直接報錯，不會默默當成 SRT 解析", () => {
  assert.throws(() => parseVtt(SRT_SAMPLE), (error) => {
    assert.ok(error instanceof SubtitleParseError);
    assert.match(error.message, /必須是 WEBVTT/);
    return true;
  });
});

test("解析失敗一律丟出帶行號的錯誤，不靜默跳過壞掉的段落", () => {
  assert.throws(() => parseSrt("這一行不是序號也不是時間碼"), (error) => {
    assert.ok(error instanceof SubtitleParseError);
    assert.equal(error.line, 1);
    assert.match(error.message, /預期是字幕序號或時間碼/);
    return true;
  });

  // 箭號打成單箭號是手改字幕最常見的錯字。
  assert.throws(() => parseSrt("1\n00:00:01,000 -> 00:00:02,000\n甲"), (error) => {
    assert.equal(error.line, 2);
    assert.match(error.message, /缺少「-->」/);
    return true;
  });

  assert.throws(() => parseSrt("1"), /缺少時間碼/);
  assert.throws(() => parseSrt("1\n00:00:01,000 --> 壞掉\n甲"), SubtitleParseError);
  assert.throws(() => parseVtt("WEBVTT\n\nintro"), /缺少時間碼/);
});

test("detectSubtitleFormat／parseSubtitle：靠 WEBVTT 標頭自動判斷格式", () => {
  assert.equal(detectSubtitleFormat(VTT_SAMPLE), "vtt");
  assert.equal(detectSubtitleFormat("\uFEFF\nWEBVTT\n\n"), "vtt");
  assert.equal(detectSubtitleFormat(SRT_SAMPLE), "srt");
  assert.equal(parseSubtitle(VTT_SAMPLE).format, "vtt");
  assert.equal(parseSubtitle(SRT_SAMPLE).format, "srt");
  assert.equal(parseSubtitle(SRT_SAMPLE).cues.length, 2);
});

// ---------- 序列化與互轉 ----------

test("toSrt／toVtt：往返解析後內容不變", () => {
  assert.equal(toSrt(parseSrt(SRT_SAMPLE)), SRT_SAMPLE);
  assert.equal(toVtt(parseVtt(VTT_SAMPLE)), VTT_SAMPLE);
  assert.equal(toSrt([]), "");
  assert.equal(toVtt([]), "WEBVTT\n");
  assert.equal(serializeCues(parseSrt(SRT_SAMPLE), "vtt"), VTT_SAMPLE);
  assert.equal(serializeCues(parseVtt(VTT_SAMPLE), "srt"), SRT_SAMPLE);
});

test("SRT ⇄ VTT 互轉：分隔符換過去換回來，時間與內容不漂移", () => {
  const vtt = toVtt(parseSrt(SRT_SAMPLE));
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.match(vtt, /00:00:01\.000 --> 00:00:03\.500/);
  assert.doesNotMatch(vtt, /,\d{3}/);

  const backToSrt = toSrt(parseVtt(vtt));
  assert.equal(backToSrt, SRT_SAMPLE);
  assert.match(backToSrt, /00:00:01,000 --> 00:00:03,500/);
  assert.doesNotMatch(backToSrt, /WEBVTT/);
});

test("轉成 SRT 會捨棄 VTT 專屬的 cue 識別字與 cue 設定", () => {
  const cues = parseVtt("WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.000 align:start\n甲\n");
  const srt = toSrt(cues);
  assert.equal(srt, "1\n00:00:01,000 --> 00:00:02,000\n甲\n");
  assert.doesNotMatch(srt, /intro|align/);
  // 反過來轉回 VTT 時，識別字與設定確實已經不在了。
  assert.equal(toVtt(parseSrt(srt)), "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n甲\n");
});

test("toSrt 一律重新編號，來源檔亂跳的序號不會被帶出去", () => {
  const srt = toSrt(parseSrt("7\n00:00:01,000 --> 00:00:02,000\n甲\n\n99\n00:00:03,000 --> 00:00:04,000\n乙\n"));
  assert.match(srt, /^1\n/);
  assert.match(srt, /\n2\n/);
  assert.doesNotMatch(srt, /\n7\n|\n99\n/);
});

// ---------- 時間碼調整 ----------

test("shiftCues：整體平移支援小數秒，正負都行", () => {
  const cues = parseSrt(SRT_SAMPLE);
  const later = shiftCues(cues, 2.5);
  assert.deepEqual(later.map((cue) => cue.startMs), [3500, 6500]);
  assert.deepEqual(later.map((cue) => cue.endMs), [6000, 8750]);

  const earlier = shiftCues(cues, -0.25);
  assert.deepEqual(earlier.map((cue) => cue.startMs), [750, 3750]);
});

test("shiftCues：往前平移到 0 之前一律夾到 0，不產生負數時間", () => {
  const cues = parseSrt("1\n00:00:01,000 --> 00:00:03,000\n甲\n\n2\n00:00:05,000 --> 00:00:07,000\n乙\n");
  const shifted = shiftCues(cues, -2);
  assert.deepEqual(shifted.map((cue) => [cue.startMs, cue.endMs]), [[0, 1000], [3000, 5000]]);

  const way = shiftCues(cues, -99);
  assert.deepEqual(way.map((cue) => [cue.startMs, cue.endMs]), [[0, 0], [0, 0]]);
  assert.match(toSrt(way), /00:00:00,000 --> 00:00:00,000/);
});

test("shiftCues：不改動原陣列，也擋掉非有限數字", () => {
  const cues = parseSrt(SRT_SAMPLE);
  shiftCues(cues, 10);
  assert.equal(cues[0].startMs, 1000);
  assert.throws(() => shiftCues(cues, Number.NaN), TypeError);
});

test("scaleCues：倍率修正影格率造成的漸進偏差", () => {
  const cues = [{ index: 1, startMs: 1000, endMs: 2000, text: "甲" }, { index: 2, startMs: 3_600_000, endMs: 3_601_000, text: "乙" }];
  const factor = frameRateFactor(23.976, 25);
  const scaled = scaleCues(cues, factor);
  // 開頭幾乎沒差，一小時之後差了兩分鐘出頭——這正是要修的漸進偏差。
  assert.equal(scaled[0].startMs, 959);
  assert.equal(scaled[1].startMs, 3_452_544);
  assert.deepEqual(scaleCues(cues, 1).map((cue) => cue.startMs), [1000, 3_600_000]);
});

test("frameRateFactor／scaleCues：倍率與影格率必須大於 0", () => {
  assert.equal(frameRateFactor(25, 25), 1);
  assert.throws(() => frameRateFactor(0, 25), RangeError);
  assert.throws(() => frameRateFactor(25, -1), RangeError);
  assert.throws(() => scaleCues([], 0), RangeError);
  assert.throws(() => scaleCues([], -2), RangeError);
  assert.throws(() => scaleCues([], Number.NaN), RangeError);
});

// ---------- 編輯輔助 ----------

test("mergeAdjacentCues：間隔在容許值以內的相鄰字幕合併成一段", () => {
  const cues = parseSrt([
    "1", "00:00:01,000 --> 00:00:02,000", "甲", "",
    "2", "00:00:02,200 --> 00:00:03,000", "乙", "",
    "3", "00:00:10,000 --> 00:00:11,000", "丙", "",
  ].join("\n"));

  const merged = mergeAdjacentCues(cues, 300);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { index: 1, startMs: 1000, endMs: 3000, text: "甲\n乙" });
  assert.deepEqual(merged[1].index, 2);
  assert.equal(merged[1].text, "丙");

  // 預設容許值 0：只有完全接續的字幕才會被合併。
  assert.equal(mergeAdjacentCues(cues).length, 3);
  assert.throws(() => mergeAdjacentCues(cues, -1), RangeError);
});

test("filterCuesByRange：保留與範圍重疊的字幕並重新編號", () => {
  const cues = parseSrt([
    "1", "00:00:01,000 --> 00:00:02,000", "甲", "",
    "2", "00:00:05,000 --> 00:00:06,000", "乙", "",
    "3", "00:00:09,000 --> 00:00:10,000", "丙", "",
  ].join("\n"));

  const inRange = filterCuesByRange(cues, 4000, 9500);
  assert.deepEqual(inRange.map((cue) => cue.text), ["乙", "丙"]);
  assert.deepEqual(inRange.map((cue) => cue.index), [1, 2]);
  assert.deepEqual(filterCuesByRange(cues, 0, 0), []);
  assert.throws(() => filterCuesByRange(cues, 5000, 1000), RangeError);
});

test("renumberCues：重新編號但保留其他欄位", () => {
  const cues = renumberCues([{ index: 9, startMs: 0, endMs: 1, text: "甲", id: "a" }]);
  assert.deepEqual(cues, [{ index: 1, startMs: 0, endMs: 1, text: "甲", id: "a" }]);
});

test("stripCueTags／toPlainText：逐字稿只留文字，時間碼與標記都不見", () => {
  assert.equal(stripCueTags("<i>斜體</i>{\\an8}文字"), "斜體文字");
  const cues = parseSrt("1\n00:00:01,000 --> 00:00:02,000\n<i>第一句</i>\n接續\n\n2\n00:00:03,000 --> 00:00:04,000\n第二句\n");
  const transcript = toPlainText(cues);
  assert.equal(transcript, "第一句 接續\n第二句");
  assert.doesNotMatch(transcript, /-->|00:00/);
  assert.equal(toPlainText([]), "");
});

test("findCueProblems／totalDurationMs：健檢與總長度", () => {
  assert.deepEqual(findCueProblems(parseSrt(SRT_SAMPLE)), []);
  const broken = [
    { index: 1, startMs: 2000, endMs: 1000, text: "甲" },
    { index: 2, startMs: 500, endMs: 3000, text: "乙" },
  ];
  const problems = findCueProblems(broken);
  assert.ok(problems.some((problem) => problem.includes("結束時間早於開始時間")), problems.join("\n"));
  assert.ok(problems.some((problem) => problem.includes("重疊")), problems.join("\n"));
  assert.equal(totalDurationMs(parseSrt(SRT_SAMPLE)), 6250);
  assert.equal(totalDurationMs([]), 0);
});
