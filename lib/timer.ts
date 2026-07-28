export const MAX_TIMER_MS = 99 * 60_000 + 59_000;

/** 顯示為 MM:SS（不足補零；上限 99:59）。 */
export function formatClock(ms: number) {
  const clamped = Math.max(0, Math.min(Math.round(ms / 1000) * 1000, MAX_TIMER_MS));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 碼表顯示：未滿一小時 MM:SS.cc，一小時以上 H:MM:SS.cc（cc 為百分之一秒，不設上限）。 */
export function formatStopwatch(ms: number) {
  const clamped = Math.max(0, Math.floor(ms));
  const centiseconds = Math.floor(clamped / 10) % 100;
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${base}.${String(centiseconds).padStart(2, "0")}`;
}

export interface LapRecord {
  index: number;
  /** 這一圈本身耗時（跟上一圈的累計時間差）。 */
  lapMs: number;
  /** 按下這一圈當下的碼表累計總時間。 */
  totalMs: number;
}

/**
 * 把「每次按分圈當下的累計時間」換算成每一圈的單圈耗時，並標出最快／最慢圈。
 * 少於兩圈時無從比較，`fastestIndex`／`slowestIndex` 回傳 null。
 */
export function computeLaps(cumulativeMs: readonly number[]): { laps: LapRecord[]; fastestIndex: number | null; slowestIndex: number | null } {
  const laps: LapRecord[] = cumulativeMs.map((totalMs, index) => ({
    index: index + 1,
    totalMs,
    lapMs: totalMs - (cumulativeMs[index - 1] ?? 0),
  }));
  if (laps.length < 2) return { laps, fastestIndex: null, slowestIndex: null };
  let fastestIndex = 0;
  let slowestIndex = 0;
  for (let i = 1; i < laps.length; i += 1) {
    if (laps[i].lapMs < laps[fastestIndex].lapMs) fastestIndex = i;
    if (laps[i].lapMs > laps[slowestIndex].lapMs) slowestIndex = i;
  }
  return { laps, fastestIndex, slowestIndex };
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
