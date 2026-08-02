/**
 * 截圖美化的版面計算與背景預設集 —— 純資料＋純函式，零依賴。
 *
 * 元件（`app/tools/screenshot-beautifier/`）只負責把這裡算出來的座標畫到
 * Canvas 上，所有「畫布要多大、圖片畫在哪、圓角幾 px、陰影多重」的決定都留在
 * 這個模組，才能用 `node --test --experimental-strip-types` 直接驗。
 *
 * 座標系統：畫布左上角是原點，y 往下為正，單位一律是輸出像素。
 */

export interface FrameSize {
  width: number;
  height: number;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameLayout {
  /** 輸出畫布尺寸。 */
  canvas: FrameSize;
  /** 原圖在畫布上的位置與尺寸。 */
  image: FrameRect;
  /** 四邊至少保留的留白（像素）。 */
  padding: number;
  /**
   * 為了不超過畫布邊長上限而套用的等比縮小倍率，1 代表維持原解析度。
   * 版面比例不受影響，縮的只是輸出解析度。
   */
  scale: number;
}

export interface FrameLayoutOptions {
  /** 留白佔原圖長邊的百分比。 */
  paddingPercent: number;
  /** 目標畫布比例（寬/高）。null 代表沿用「原圖＋留白」的比例。 */
  ratio: number | null;
  /** 畫布長邊上限；預設 `MAX_CANVAS_EDGE`。 */
  maxEdge?: number;
}

export const PADDING_MIN_PERCENT = 2;
export const PADDING_MAX_PERCENT = 15;
export const PADDING_DEFAULT_PERCENT = 6;

export const RADIUS_MIN_PERCENT = 0;
export const RADIUS_MAX_PERCENT = 12;
export const RADIUS_DEFAULT_PERCENT = 3;

export const SHADOW_MIN_STRENGTH = 0;
export const SHADOW_MAX_STRENGTH = 100;
export const SHADOW_DEFAULT_STRENGTH = 45;

/**
 * 畫布長邊上限。加了大留白又套 9:16 之後，畫布會比原圖大得多；瀏覽器各家的
 * Canvas 尺寸限制不一致，超過就會靜默吐出空白圖，所以在這裡先收斂。
 */
export const MAX_CANVAS_EDGE = 4096;

/** 社群常見的輸出比例。`ratio` 是寬/高。 */
export const CANVAS_RATIOS = [
  { id: "original", label: "原始比例", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
] as const;

export type CanvasRatioId = (typeof CANVAS_RATIOS)[number]["id"];

export const DEFAULT_RATIO_ID: CanvasRatioId = "original";

/** 日系和色，與全站設計語彙一致（刻意不使用黃色系）。 */
export const WAIRO = {
  /** 縹 */
  hanada: "#5F83A8",
  /** 鴇 */
  toki: "#CF7F8D",
  /** 松葉 */
  matsuba: "#7D9A63",
  /** 藤 */
  fuji: "#9B8BBF",
  /** 和紙 */
  washi: "#F5F1E8",
  /** 墨 */
  sumi: "#101628",
} as const;

export type ScreenshotBackground =
  | { id: string; label: string; kind: "gradient"; angle: number; stops: readonly string[] }
  | { id: string; label: string; kind: "solid"; color: string }
  | { id: string; label: string; kind: "transparent" };

/**
 * 背景預設集。
 *
 * `angle` 用的是「0 度＝由上往下、90 度＝由左往右」的直覺定義，不是 CSS 的
 * `linear-gradient` 角度；要給 CSS 用請走 `backgroundCss()` 轉換。
 */
export const BACKGROUND_PRESETS: readonly ScreenshotBackground[] = [
  { id: "hanada-fuji", label: "縹藤", kind: "gradient", angle: 135, stops: [WAIRO.hanada, WAIRO.fuji] },
  { id: "toki-fuji", label: "鴇藤", kind: "gradient", angle: 135, stops: [WAIRO.toki, WAIRO.fuji] },
  { id: "matsuba-hanada", label: "松葉縹", kind: "gradient", angle: 135, stops: [WAIRO.matsuba, WAIRO.hanada] },
  { id: "hanada-toki", label: "縹鴇", kind: "gradient", angle: 90, stops: [WAIRO.hanada, WAIRO.toki] },
  { id: "fuji-toki-hanada", label: "藤鴇縹", kind: "gradient", angle: 160, stops: [WAIRO.fuji, WAIRO.toki, WAIRO.hanada] },
  { id: "matsuba-fuji", label: "松葉藤", kind: "gradient", angle: 45, stops: [WAIRO.matsuba, WAIRO.fuji] },
  { id: "washi", label: "和紙", kind: "solid", color: WAIRO.washi },
  { id: "sumi", label: "墨", kind: "solid", color: WAIRO.sumi },
  { id: "hanada", label: "縹", kind: "solid", color: WAIRO.hanada },
  { id: "toki", label: "鴇", kind: "solid", color: WAIRO.toki },
  { id: "matsuba", label: "松葉", kind: "solid", color: WAIRO.matsuba },
  { id: "transparent", label: "透明", kind: "transparent" },
];

export const DEFAULT_BACKGROUND_ID = "hanada-fuji";

function toFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampPaddingPercent(value: number): number {
  return clamp(toFinite(value, PADDING_DEFAULT_PERCENT), PADDING_MIN_PERCENT, PADDING_MAX_PERCENT);
}

export function clampRadiusPercent(value: number): number {
  return clamp(toFinite(value, RADIUS_DEFAULT_PERCENT), RADIUS_MIN_PERCENT, RADIUS_MAX_PERCENT);
}

export function clampShadowStrength(value: number): number {
  return clamp(toFinite(value, SHADOW_DEFAULT_STRENGTH), SHADOW_MIN_STRENGTH, SHADOW_MAX_STRENGTH);
}

/** 找不到就回傳 null（＝原始比例），不讓壞掉的 id 把版面算成 NaN。 */
export function canvasRatioOf(id: string): number | null {
  return CANVAS_RATIOS.find((entry) => entry.id === id)?.ratio ?? null;
}

/** 找不到就回傳預設背景，避免舊 id 讓畫面變成空白。 */
export function getBackground(id: string): ScreenshotBackground {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id)
    ?? BACKGROUND_PRESETS.find((preset) => preset.id === DEFAULT_BACKGROUND_ID)
    ?? BACKGROUND_PRESETS[0];
}

function normalizeRatio(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined) return null;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * 算出畫布尺寸與原圖該畫的位置。
 *
 * 留白以原圖「長邊」為基準，橫圖直圖才不會有一邊看起來特別擠；套用畫布比例時
 * 只會往外撐（不會裁到圖），所以四邊的留白永遠 ≥ `padding`。
 */
export function computeFrameLayout(image: FrameSize, options: FrameLayoutOptions): FrameLayout {
  const sourceWidth = Math.max(1, Math.round(toFinite(image?.width, 1)));
  const sourceHeight = Math.max(1, Math.round(toFinite(image?.height, 1)));
  const paddingPercent = clampPaddingPercent(options.paddingPercent);
  const maxEdge = Math.max(64, Math.round(toFinite(options.maxEdge ?? MAX_CANVAS_EDGE, MAX_CANVAS_EDGE)));

  const padding = Math.round((Math.max(sourceWidth, sourceHeight) * paddingPercent) / 100);
  let canvasWidth = sourceWidth + padding * 2;
  let canvasHeight = sourceHeight + padding * 2;

  const ratio = normalizeRatio(options.ratio);
  if (ratio !== null) {
    if (canvasWidth / canvasHeight < ratio) canvasWidth = Math.round(canvasHeight * ratio);
    else canvasHeight = Math.round(canvasWidth / ratio);
  }

  const longest = Math.max(canvasWidth, canvasHeight);
  const scale = longest > maxEdge ? maxEdge / longest : 1;

  const outWidth = Math.max(1, Math.round(canvasWidth * scale));
  const outHeight = Math.max(1, Math.round(canvasHeight * scale));
  const imageWidth = Math.max(1, Math.min(outWidth, Math.round(sourceWidth * scale)));
  const imageHeight = Math.max(1, Math.min(outHeight, Math.round(sourceHeight * scale)));

  return {
    canvas: { width: outWidth, height: outHeight },
    image: {
      x: Math.round((outWidth - imageWidth) / 2),
      y: Math.round((outHeight - imageHeight) / 2),
      width: imageWidth,
      height: imageHeight,
    },
    padding: Math.round(padding * scale),
    scale,
  };
}

/** 圓角以圖片短邊的百分比計算，換解析度時視覺比例才不會跑掉。 */
export function resolveCornerRadius(radiusPercent: number, image: FrameSize): number {
  const percent = clampRadiusPercent(radiusPercent);
  const shortest = Math.max(1, Math.min(
    Math.round(toFinite(image?.width, 1)),
    Math.round(toFinite(image?.height, 1)),
  ));
  return Math.min(Math.round((shortest * percent) / 100), Math.floor(shortest / 2));
}

export interface FrameShadow {
  blur: number;
  offsetY: number;
  color: string;
}

/** 陰影同樣跟著圖片長邊等比放大，1000px 與 4000px 的截圖看起來才一致。 */
export function computeShadow(strength: number, image: FrameSize): FrameShadow {
  const ratio = clampShadowStrength(strength) / 100;
  const reference = Math.max(1, Math.max(
    Math.round(toFinite(image?.width, 1)),
    Math.round(toFinite(image?.height, 1)),
  ));
  return {
    blur: Math.round(reference * 0.055 * ratio),
    offsetY: Math.round(reference * 0.018 * ratio),
    color: `rgba(16, 22, 40, ${(0.42 * ratio).toFixed(3)})`,
  };
}

/**
 * 把角度換算成 `createLinearGradient` 需要的兩個端點。
 *
 * 方向向量取 (sin θ, cos θ)，θ=0 是由上往下、θ=90 是由左往右；漸層線長度用
 * CSS 的算法（|dx|·W + |dy|·H），角度不是 0/90 時兩個角落才會剛好吃滿。
 */
export function gradientEndpoints(angleDeg: number, canvas: FrameSize): { x0: number; y0: number; x1: number; y1: number } {
  const width = Math.max(1, toFinite(canvas?.width, 1));
  const height = Math.max(1, toFinite(canvas?.height, 1));
  const theta = (toFinite(angleDeg, 0) * Math.PI) / 180;
  const dx = Math.sin(theta);
  const dy = Math.cos(theta);
  const half = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return {
    x0: round2(cx - dx * half),
    y0: round2(cy - dy * half),
    x1: round2(cx + dx * half),
    y1: round2(cy + dy * half),
  };
}

/**
 * 給 CSS 用的背景值（色票按鈕的預覽）。
 *
 * CSS 的 `linear-gradient` 角度 0 度是「由下往上」，跟本模組的定義差 180 度，
 * 這裡一次換算掉，色票才會跟實際輸出同一個方向。
 */
export function backgroundCss(background: ScreenshotBackground): string {
  if (background.kind === "transparent") return "transparent";
  if (background.kind === "solid") return background.color;
  const cssAngle = ((180 - background.angle) % 360 + 360) % 360;
  return `linear-gradient(${cssAngle}deg, ${background.stops.join(", ")})`;
}

/** 輸出檔名：沿用來源檔名並加上工具後綴。 */
export function outputFileName(sourceName: string, format: "png" | "jpeg"): string {
  const base = sourceName.replace(/\.[^.]+$/, "").trim();
  return `${base === "" ? "screenshot" : base}-美化.${format === "png" ? "png" : "jpg"}`;
}
