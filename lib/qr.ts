export type QrErrorLevel = "L" | "M" | "Q" | "H";

export const QR_MAX_LENGTH = 1000;

export function hexLuminance(hex: string) {
  const match = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 掃描器需要「暗前景、亮背景」且對比夠大；不符時回傳警告文字。 */
export function contrastWarning(darkHex: string, lightHex: string) {
  const dark = hexLuminance(darkHex);
  const light = hexLuminance(lightHex);
  if (dark === null || light === null) return null;
  if (dark >= light) return "前景應比背景深，否則多數掃描器讀不到";
  if (light - dark < 0.35) return "前景與背景對比偏低，可能不易掃描";
  return null;
}

export function qrFilename(text: string) {
  const base = text.replace(/^https?:\/\//, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return `qrcode-${base || "toolverse"}`;
}
