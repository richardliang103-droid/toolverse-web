import assert from "node:assert/strict";
import test from "node:test";
import { applyAspect, clampCropRect, toNaturalRect } from "../lib/crop.ts";
import { exceedsImagePixelLimit } from "../lib/image-limits.ts";
import { createSafeMarkdownRenderer, safeMarkdownUrl } from "../lib/markdown-safety.ts";
import { marked } from "marked";

test("crop 幾何：clamp、aspect、座標換算", () => {
  assert.deepEqual(clampCropRect({ x: -10, y: -10, w: 50, h: 50 }, 100, 100), { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(clampCropRect({ x: 80, y: 80, w: 50, h: 50 }, 100, 100), { x: 50, y: 50, w: 50, h: 50 });
  const square = applyAspect({ x: 10, y: 10, w: 80, h: 40 }, 1, 200, 200);
  assert.ok(Math.abs(square.w - square.h) < 1e-9);
  const natural = toNaturalRect({ x: 10, y: 10, w: 50, h: 50 }, 2, 200, 200);
  assert.deepEqual(natural, { x: 20, y: 20, w: 100, h: 100 });
});

test("Markdown 連結只允許安全協定", () => {
  assert.equal(safeMarkdownUrl("https://example.com"), "https://example.com");
  assert.equal(safeMarkdownUrl("/help"), "/help");
  assert.equal(safeMarkdownUrl("mailto:hello@example.com"), "mailto:hello@example.com");
  assert.equal(safeMarkdownUrl("javascript:alert(1)"), null);
  assert.equal(safeMarkdownUrl("java\nscript:alert(1)"), null);
  assert.equal(safeMarkdownUrl("data:text/html,hello", "image"), null);
});

test("Markdown renderer 不輸出 javascript URL", async () => {
  const html = await marked.parse("[危險](javascript:alert(1))\n\n![危險](data:text/html,hello)", { renderer: createSafeMarkdownRenderer() });
  assert.doesNotMatch(html, /javascript:|data:text\/html/i);
  assert.match(html, /危險/);
});

test("影像像素上限避免巨大 Canvas", () => {
  assert.equal(exceedsImagePixelLimit(4000, 3000), false);
  assert.equal(exceedsImagePixelLimit(10000, 5000), true);
  assert.equal(exceedsImagePixelLimit(0, 10), true);
});
