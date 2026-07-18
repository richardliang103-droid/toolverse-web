export const MAX_TIMER_MS = 99 * 60_000 + 59_000;

/** 顯示為 MM:SS（不足補零；上限 99:59）。 */
export function formatClock(ms: number) {
  const clamped = Math.max(0, Math.min(Math.round(ms / 1000) * 1000, MAX_TIMER_MS));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function clampTimerMs(ms: number) {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.min(Math.round(ms), MAX_TIMER_MS));
}

/** 剩餘時間低於總長 15%（且計時中）視為警示區，介面轉紅。 */
export function isWarningZone(remainingMs: number, totalMs: number) {
  if (totalMs <= 0 || remainingMs <= 0) return false;
  return remainingMs <= Math.max(totalMs * 0.15, 10_000);
}
