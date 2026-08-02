import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_PRESETS,
  CANVAS_RATIOS,
  DEFAULT_BACKGROUND_ID,
  MAX_CANVAS_EDGE,
  PADDING_MAX_PERCENT,
  PADDING_MIN_PERCENT,
  RADIUS_MAX_PERCENT,
  backgroundCss,
  canvasRatioOf,
  clampPaddingPercent,
  clampRadiusPercent,
  clampShadowStrength,
  computeFrameLayout,
  computeShadow,
  getBackground,
  gradientEndpoints,
  outputFileName,
  resolveCornerRadius,
} from "../lib/screenshot-frame.ts";

const near = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 與 ${expected} 差距超過 ${tolerance}`);

test("原始比例：畫布＝原圖＋兩倍留白，圖片四邊等距", () => {
  const layout = computeFrameLayout({ width: 800, height: 600 }, { paddingPercent: 10, ratio: null });
  assert.equal(layout.padding, 80);
  assert.deepEqual(layout.canvas, { width: 960, height: 760 });
  assert.deepEqual(layout.image, { x: 80, y: 80, width: 800, height: 600 });
  assert.equal(layout.scale, 1);
  // 四邊留白必須一致，否則視覺上會偏移。
  assert.equal(layout.canvas.width - layout.image.x - layout.image.width, layout.image.x);
  assert.equal(layout.canvas.height - layout.image.y - layout.image.height, layout.image.y);
});

test("留白以長邊為基準，直圖與橫圖的視覺寬度才一致", () => {
  const landscape = computeFrameLayout({ width: 1200, height: 400 }, { paddingPercent: 5, ratio: null });
  const portrait = computeFrameLayout({ width: 400, height: 1200 }, { paddingPercent: 5, ratio: null });
  assert.equal(landscape.padding, 60);
  assert.equal(portrait.padding, 60);
});

test("套用畫布比例：比例正確、圖片置中、留白不縮水", () => {
  const source = { width: 800, height: 600 };
  const cases = [
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["9:16", 9 / 16],
  ];
  for (const [id, ratio] of cases) {
    const layout = computeFrameLayout(source, { paddingPercent: 10, ratio: canvasRatioOf(id) });
    near(layout.canvas.width / layout.canvas.height, ratio, 0.005);
    // 只會往外撐，原圖絕不被裁掉。
    assert.equal(layout.image.width, source.width, `${id} 不該縮圖`);
    assert.equal(layout.image.height, source.height, `${id} 不該縮圖`);
    // 置中（奇數差值容許 1px）。
    assert.ok(Math.abs((layout.canvas.width - layout.image.width) / 2 - layout.image.x) <= 1, `${id} 水平未置中`);
    assert.ok(Math.abs((layout.canvas.height - layout.image.height) / 2 - layout.image.y) <= 1, `${id} 垂直未置中`);
    // 四邊留白至少維持基準值。
    assert.ok(layout.image.x >= layout.padding, `${id} 左右留白小於基準`);
    assert.ok(layout.image.y >= layout.padding, `${id} 上下留白小於基準`);
  }
});

test("9:16 直式社群尺寸：橫圖會往上下補滿，不是把圖拉長", () => {
  const layout = computeFrameLayout({ width: 800, height: 600 }, { paddingPercent: 10, ratio: canvasRatioOf("9:16") });
  assert.equal(layout.canvas.width, 960);
  assert.equal(layout.image.width, 800);
  assert.equal(layout.image.height, 600);
  assert.ok(layout.canvas.height > layout.canvas.width);
});

test("畫布超過長邊上限時整體等比縮小，比例與置中仍成立", () => {
  const layout = computeFrameLayout({ width: 4000, height: 3000 }, { paddingPercent: 15, ratio: canvasRatioOf("9:16") });
  assert.ok(layout.scale < 1);
  assert.equal(Math.max(layout.canvas.width, layout.canvas.height), MAX_CANVAS_EDGE);
  near(layout.canvas.width / layout.canvas.height, 9 / 16, 0.005);
  // 縮小的是輸出解析度，圖片仍然完整置中在畫布裡。
  assert.ok(layout.image.width < 4000);
  near(layout.image.width / layout.image.height, 4000 / 3000, 0.01);
  assert.ok(Math.abs((layout.canvas.width - layout.image.width) / 2 - layout.image.x) <= 1);
});

test("未超過上限就不動解析度", () => {
  const layout = computeFrameLayout({ width: 1280, height: 720 }, { paddingPercent: 6, ratio: null });
  assert.equal(layout.scale, 1);
  assert.equal(layout.image.width, 1280);
});

test("maxEdge 可以自訂，供預覽用較小的畫布", () => {
  const layout = computeFrameLayout({ width: 1600, height: 900 }, { paddingPercent: 10, ratio: null, maxEdge: 480 });
  assert.equal(Math.max(layout.canvas.width, layout.canvas.height), 480);
});

test("壞掉的輸入不會算出 NaN 畫布", () => {
  const layout = computeFrameLayout({ width: Number.NaN, height: 0 }, { paddingPercent: Number.NaN, ratio: Number.NaN });
  assert.ok(Number.isFinite(layout.canvas.width) && layout.canvas.width >= 1);
  assert.ok(Number.isFinite(layout.canvas.height) && layout.canvas.height >= 1);
  assert.ok(Number.isFinite(layout.image.x) && Number.isFinite(layout.image.y));
});

test("數值 clamp：超界與非數字都收回合法區間", () => {
  assert.equal(clampPaddingPercent(0), PADDING_MIN_PERCENT);
  assert.equal(clampPaddingPercent(999), PADDING_MAX_PERCENT);
  assert.equal(clampPaddingPercent(8), 8);
  assert.equal(clampPaddingPercent(Number.NaN), 6);

  assert.equal(clampRadiusPercent(-5), 0);
  assert.equal(clampRadiusPercent(50), RADIUS_MAX_PERCENT);

  assert.equal(clampShadowStrength(-1), 0);
  assert.equal(clampShadowStrength(200), 100);
});

test("canvasRatioOf：清單內的 id 有值，未知 id 退回原始比例", () => {
  assert.equal(canvasRatioOf("original"), null);
  assert.equal(canvasRatioOf("1:1"), 1);
  near(canvasRatioOf("16:9"), 16 / 9);
  assert.equal(canvasRatioOf("不存在"), null);
  // 每個 preset 的 id 都不重複，按鈕才不會撞 key。
  assert.equal(new Set(CANVAS_RATIOS.map((entry) => entry.id)).size, CANVAS_RATIOS.length);
});

test("圓角以短邊百分比計算，最多到短邊的一半", () => {
  assert.equal(resolveCornerRadius(0, { width: 800, height: 600 }), 0);
  assert.equal(resolveCornerRadius(5, { width: 800, height: 600 }), 30);
  // 換解析度時視覺比例不變。
  assert.equal(resolveCornerRadius(5, { width: 1600, height: 1200 }), 60);
  // 百分比會先被 clamp，永遠不會超過短邊一半而畫成怪形狀。
  assert.ok(resolveCornerRadius(999, { width: 100, height: 40 }) <= 20);
});

test("陰影強度 0 等於沒有陰影，強度越大越明顯", () => {
  const image = { width: 1000, height: 800 };
  const none = computeShadow(0, image);
  assert.equal(none.blur, 0);
  assert.equal(none.offsetY, 0);
  assert.match(none.color, /rgba\(16, 22, 40, 0\.000\)/);

  const soft = computeShadow(30, image);
  const strong = computeShadow(90, image);
  assert.ok(strong.blur > soft.blur && soft.blur > 0);
  assert.ok(strong.offsetY >= soft.offsetY);
  assert.match(strong.color, /^rgba\(16, 22, 40, 0\.\d{3}\)$/);
});

test("陰影跟著圖片長邊等比放大", () => {
  const small = computeShadow(50, { width: 1000, height: 600 });
  const large = computeShadow(50, { width: 2000, height: 1200 });
  // 兩者都會各自四捨五入，容許 1px 誤差。
  near(large.blur, small.blur * 2, 1);
  near(large.offsetY, small.offsetY * 2, 1);
  assert.ok(large.blur > small.blur && large.offsetY > small.offsetY);
});

test("gradientEndpoints：0 度由上往下、90 度由左往右", () => {
  const canvas = { width: 400, height: 200 };

  const down = gradientEndpoints(0, canvas);
  assert.deepEqual(down, { x0: 200, y0: 0, x1: 200, y1: 200 });

  const right = gradientEndpoints(90, canvas);
  assert.deepEqual(right, { x0: 0, y0: 100, x1: 400, y1: 100 });

  // 180 度是 0 度的反向。
  const up = gradientEndpoints(180, canvas);
  near(up.y0, down.y1);
  near(up.y1, down.y0);

  // 斜角時漸層線要吃滿兩個對角，端點會落在畫布外，這是 CSS 的標準行為。
  const diagonal = gradientEndpoints(135, canvas);
  assert.ok(diagonal.x1 > diagonal.x0 && diagonal.y1 < diagonal.y0);
});

test("backgroundCss：CSS 角度與本模組角度差 180 度，方向才對得上", () => {
  assert.equal(backgroundCss({ id: "t", label: "t", kind: "transparent" }), "transparent");
  assert.equal(backgroundCss({ id: "s", label: "s", kind: "solid", color: "#5F83A8" }), "#5F83A8");
  assert.equal(
    backgroundCss({ id: "g", label: "g", kind: "gradient", angle: 0, stops: ["#5F83A8", "#9B8BBF"] }),
    "linear-gradient(180deg, #5F83A8, #9B8BBF)",
  );
  assert.equal(
    backgroundCss({ id: "g", label: "g", kind: "gradient", angle: 135, stops: ["#5F83A8", "#9B8BBF"] }),
    "linear-gradient(45deg, #5F83A8, #9B8BBF)",
  );
  // 換算後永遠落在 0–359，不會產生負角度。
  for (const preset of BACKGROUND_PRESETS) {
    if (preset.kind !== "gradient") continue;
    const [, angle] = backgroundCss(preset).match(/^linear-gradient\((-?\d+(?:\.\d+)?)deg/) ?? [];
    assert.ok(Number(angle) >= 0 && Number(angle) < 360, `${preset.id} 的 CSS 角度 ${angle} 超出範圍`);
  }
});

test("背景預設集：id 唯一、格式合法、預設值存在", () => {
  assert.equal(new Set(BACKGROUND_PRESETS.map((preset) => preset.id)).size, BACKGROUND_PRESETS.length);
  assert.ok(BACKGROUND_PRESETS.some((preset) => preset.id === DEFAULT_BACKGROUND_ID));
  assert.equal(getBackground(DEFAULT_BACKGROUND_ID).id, DEFAULT_BACKGROUND_ID);
  // 未知 id 退回預設，不會讓畫面變空白。
  assert.equal(getBackground("已被刪掉的舊 id").id, DEFAULT_BACKGROUND_ID);

  assert.ok(BACKGROUND_PRESETS.some((preset) => preset.kind === "transparent"), "缺少透明背景");
  assert.ok(BACKGROUND_PRESETS.filter((preset) => preset.kind === "solid").length >= 2, "純色背景太少");
  assert.ok(BACKGROUND_PRESETS.filter((preset) => preset.kind === "gradient").length >= 4, "漸層背景太少");

  for (const preset of BACKGROUND_PRESETS) {
    assert.ok(preset.label.length > 0, `${preset.id} 缺少標籤`);
    if (preset.kind === "solid") assert.match(preset.color, /^#[0-9A-Fa-f]{6}$/);
    if (preset.kind === "gradient") {
      assert.ok(preset.stops.length >= 2, `${preset.id} 漸層至少要兩個色停`);
      for (const stop of preset.stops) assert.match(stop, /^#[0-9A-Fa-f]{6}$/);
      assert.ok(Number.isFinite(preset.angle), `${preset.id} 角度不是數字`);
    }
  }
});

/** 取色相（0–360）與彩度差，用來檢查有沒有混進黃色系。 */
function hueAndChroma(hex) {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) return { hue: 0, chroma };
  let hue;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  return { hue: (hue * 60 + 360) % 360, chroma };
}

test("背景配色全是日系和色，沒有預設黃色系", () => {
  // 維護者明確拒絕「AI 感」的黃色預設配色（見 CLAUDE.md 設計語彙）。
  // 判準是「黃色相 ＋ 有明顯彩度」，和紙這種近中性的暖白不算。
  const colors = BACKGROUND_PRESETS.flatMap((preset) => {
    if (preset.kind === "solid") return [preset.color];
    if (preset.kind === "gradient") return [...preset.stops];
    return [];
  });
  assert.ok(colors.length > 0);
  for (const color of colors) {
    const { hue, chroma } = hueAndChroma(color);
    const yellowish = hue >= 35 && hue <= 75 && chroma >= 0.12;
    assert.ok(!yellowish, `${color} 是黃色系（色相 ${hue.toFixed(1)}、彩度 ${chroma.toFixed(2)}），不符合設計語彙`);
  }
});

test("outputFileName：沿用來源檔名並換上正確副檔名", () => {
  assert.equal(outputFileName("螢幕截圖 2026-08-02.png", "png"), "螢幕截圖 2026-08-02-美化.png");
  assert.equal(outputFileName("shot.webp", "jpeg"), "shot-美化.jpg");
  assert.equal(outputFileName("", "png"), "screenshot-美化.png");
  assert.equal(outputFileName("no-extension", "png"), "no-extension-美化.png");
});
