import assert from "node:assert/strict";
import test from "node:test";
import { fitDimensions, formatBytes, mimeForFormat, outputFilename, savingsPercent } from "../lib/image-compress.ts";
import { clampTimerMs, formatClock, isWarningZone } from "../lib/timer.ts";
import { extractedFilename, mergedFilename, parsePageRanges } from "../lib/pdf-pages.ts";
import { cleanText, DEFAULT_CLEANER_OPTIONS, fullwidthToHalfwidth, textStats } from "../lib/text-cleaner.ts";
import { contrastWarning, qrFilename } from "../lib/qr.ts";

test("image-compress: dimensions, filenames and savings", () => {
  assert.deepEqual(fitDimensions(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(fitDimensions(800, 600, 2000), { width: 800, height: 600 });
  assert.deepEqual(fitDimensions(4000, 3000, 0), { width: 4000, height: 3000 });
  assert.deepEqual(fitDimensions(10000, 5, 100), { width: 100, height: 1 });
  assert.equal(mimeForFormat("original", "image/png"), "image/png");
  assert.equal(mimeForFormat("original", "image/jpeg"), "image/jpeg");
  assert.equal(mimeForFormat("webp", "image/png"), "image/webp");
  assert.equal(outputFilename("photo.JPEG", "image/webp"), "photo-compressed.webp");
  assert.equal(outputFilename("無副檔名", "image/jpeg"), "無副檔名-compressed.jpg");
  assert.equal(savingsPercent(1000, 400), 60);
  assert.equal(savingsPercent(1000, 1200), 0);
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(2.5 * 1024 * 1024), "2.50 MB");
});

test("timer: clock formatting, clamping and warning zone", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(65_000), "01:05");
  assert.equal(formatClock(3_600_000), "60:00");
  assert.equal(formatClock(99 * 60_000 + 59_000), "99:59");
  assert.equal(formatClock(10 * 60 * 60 * 1000), "99:59"); // 超過上限被夾住
  assert.equal(clampTimerMs(-5), 0);
  assert.equal(isWarningZone(50_000, 300_000), false);
  assert.equal(isWarningZone(44_000, 300_000), true); // 15% = 45 秒
  assert.equal(isWarningZone(9_000, 30_000), true);   // 最少 10 秒警示
  assert.equal(isWarningZone(0, 300_000), false);
});

test("pdf-pages: range parsing keeps order, supports reverse, rejects garbage", () => {
  assert.deepEqual(parsePageRanges("1-3,5", 10), [0, 1, 2, 4]);
  assert.deepEqual(parsePageRanges("8-6", 10), [7, 6, 5]);
  assert.deepEqual(parsePageRanges("3, 3, 1-2", 5), [2, 0, 1]);
  assert.deepEqual(parsePageRanges("1，2、3", 5), [0, 1, 2]); // 全形逗號與頓號也可分隔
  assert.throws(() => parsePageRanges("0-2", 5), /從 1 開始/);
  assert.throws(() => parsePageRanges("4-9", 5), /共 5 頁/);
  assert.throws(() => parsePageRanges("abc", 5), /不是有效/);
  assert.throws(() => parsePageRanges("  ", 5), /請輸入/);
  assert.equal(mergedFilename(["a.pdf", "b.pdf"]), "a-合併2份.pdf");
  assert.equal(extractedFilename("report.PDF"), "report-選取頁.pdf");
});

test("text-cleaner: transforms compose correctly", () => {
  assert.equal(fullwidthToHalfwidth("ＡＢＣ１２３！　ｘ"), "ABC123! x");
  const cleaned = cleanText("  b  \n\n a \n b ", { ...DEFAULT_CLEANER_OPTIONS, dropEmptyLines: true, dedupeLines: true, sort: "asc" });
  assert.equal(cleaned, "a\nb");
  const collapsed = cleanText("a    b\tc", { ...DEFAULT_CLEANER_OPTIONS, collapseSpaces: true });
  assert.equal(collapsed, "a b c");
  const upper = cleanText("abc", { ...DEFAULT_CLEANER_OPTIONS, casing: "upper" });
  assert.equal(upper, "ABC");
  const stats = textStats("a\n\na\nb");
  assert.equal(stats.lines, 4);
  assert.equal(stats.nonEmptyLines, 3);
  assert.equal(stats.uniqueLines, 2);
  assert.equal(textStats("").characters, 0);
});

test("qr: contrast warnings and filename slug", () => {
  assert.equal(contrastWarning("#101628", "#ffffff"), null);
  assert.match(contrastWarning("#ffffff", "#101628") ?? "", /前景應比背景深/);
  assert.match(contrastWarning("#888888", "#999999") ?? "", /對比偏低/);
  assert.equal(contrastWarning("oops", "#ffffff"), null);
  assert.equal(qrFilename("https://example.com/path?q=1"), "qrcode-example-com-path-q-1");
  assert.equal(qrFilename("   "), "qrcode-toolverse");
});
