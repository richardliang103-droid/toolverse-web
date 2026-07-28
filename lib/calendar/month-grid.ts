/**
 * 月曆格線的純日期運算。零依賴，不管假日、不管畫面，只算「這個月要畫哪 42 格」。
 *
 * 固定 6 週（42 格）而不是依月份長度算 4–6 週：格數固定，換月份時版面高度
 * 不會跳動。以週日為一週的第一天，符合台灣月曆的慣例。
 */

export interface CalendarDay {
  /** ISO 日期字串 yyyy-mm-dd，同時當這一格的 React key。 */
  date: string;
  year: number;
  /** 1–12。 */
  month: number;
  day: number;
  /** 0（週日）–6（週六），對應 `Date.prototype.getDay()`。 */
  weekday: number;
  /** 這一格是不是落在目前檢視的月份內；框外是上個月尾巴或下個月開頭。 */
  inCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 產生 `year` 年 `month`（1–12）月的 42 格月曆。
 *
 * `today` 預設是呼叫當下的系統時間；測試與「跳到今天」以外的畫面渲染會
 * 傳入固定值，讓結果可預期。只比對年／月／日，不比對時分秒。
 */
export function buildMonthGrid(year: number, month: number, today: Date = new Date()): CalendarDay[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  // 往回退到當週週日：JS Date 的 setDate 會正確跨月甚至跨年往前推，不用自己處理借位。
  const gridStart = new Date(year, month - 1, 1 - firstOfMonth.getDay());
  const todayIso = isoDate(today);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i += 1) {
    const cursor = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const weekday = cursor.getDay();
    days.push({
      date: isoDate(cursor),
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
      day: cursor.getDate(),
      weekday,
      inCurrentMonth: cursor.getMonth() + 1 === month && cursor.getFullYear() === year,
      isToday: isoDate(cursor) === todayIso,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }
  return days;
}

/** 月份加減，正確跨年（1 月減 1 個月 → 上一年 12 月）。回傳 1-based 月份。 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const base = new Date(year, month - 1 + delta, 1);
  return { year: base.getFullYear(), month: base.getMonth() + 1 };
}
