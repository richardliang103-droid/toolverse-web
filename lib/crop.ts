export type CropRect = { x: number; y: number; w: number; h: number };

export const CROP_MIN_SIZE = 24;

/** 把裁切框限制在畫布範圍內，並保證最小尺寸。 */
export function clampCropRect(rect: CropRect, boundsW: number, boundsH: number): CropRect {
  const w = Math.min(Math.max(rect.w, CROP_MIN_SIZE), boundsW);
  const h = Math.min(Math.max(rect.h, CROP_MIN_SIZE), boundsH);
  const x = Math.min(Math.max(rect.x, 0), boundsW - w);
  const y = Math.min(Math.max(rect.y, 0), boundsH - h);
  return { x, y, w, h };
}

/** 以中心為基準套用比例（aspect = 寬/高），並收回畫布內。 */
export function applyAspect(rect: CropRect, aspect: number, boundsW: number, boundsH: number): CropRect {
  let w = rect.w;
  let h = w / aspect;
  if (h > boundsH) { h = boundsH; w = h * aspect; }
  if (w > boundsW) { w = boundsW; h = w / aspect; }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return clampCropRect({ x: cx - w / 2, y: cy - h / 2, w, h }, boundsW, boundsH);
}

/** 顯示座標 → 原圖像素座標（四捨五入並限制在原圖內）。 */
export function toNaturalRect(rect: CropRect, scale: number, naturalW: number, naturalH: number): CropRect {
  const x = Math.max(0, Math.round(rect.x * scale));
  const y = Math.max(0, Math.round(rect.y * scale));
  const w = Math.min(naturalW - x, Math.max(1, Math.round(rect.w * scale)));
  const h = Math.min(naturalH - y, Math.max(1, Math.round(rect.h * scale)));
  return { x, y, w, h };
}
