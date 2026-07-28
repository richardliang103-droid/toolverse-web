/**
 * 台灣國定假日中「日期每年固定」的部分。零依賴、可測。
 *
 * 刻意只收錄這些：農曆為準的節日（除夕、春節、端午、中秋）與政府每年
 * 公告的彈性放假／補班調整，日期不是算出來的，是行政院人事行政總處
 * 逐年公告，而且春節等農曆節日還需要準確的農曆換算表才能算出西曆日期。
 * 沒有一份逐年驗證過、免連線就能內建的資料來源以前，寧可不顯示，也不要
 * 顯示一個沒把握是否正確的日期——月曆工具的價值就在準確，顯示錯的假日
 * 比不顯示更糟。要補上這塊，需要之後有人對照官方行事曆逐年建檔。
 */

export interface Holiday {
  /** MM-DD，例如 "01-01"。 */
  monthDay: string;
  name: string;
}

export const FIXED_HOLIDAYS_TW: readonly Holiday[] = [
  { monthDay: "01-01", name: "元旦" },
  { monthDay: "02-28", name: "和平紀念日" },
  { monthDay: "04-04", name: "兒童節" },
  { monthDay: "05-01", name: "勞動節" },
  { monthDay: "10-10", name: "國慶日" },
];

const BY_MONTH_DAY = new Map(FIXED_HOLIDAYS_TW.map((holiday) => [holiday.monthDay, holiday]));

/** `month` 1–12。查不到就回 null——沒有把握的日期不硬猜，見檔案開頭說明。 */
export function holidayFor(month: number, day: number): Holiday | null {
  const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return BY_MONTH_DAY.get(key) ?? null;
}
