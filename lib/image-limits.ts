export const MAX_IMAGE_PIXELS = 40_000_000;

export function exceedsImagePixelLimit(width: number, height: number) {
  return !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS;
}

export function imagePixelLimitMessage() {
  return `圖片解析度超過 ${(MAX_IMAGE_PIXELS / 1_000_000).toFixed(0)} 百萬像素安全上限，請先縮小圖片後再試。`;
}
