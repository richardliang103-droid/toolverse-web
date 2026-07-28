"use client";

import { useState, type ChangeEvent } from "react";
import { buildMonthGrid, shiftMonth } from "@/lib/calendar/month-grid";
import { holidayFor } from "@/lib/calendar/holidays-tw";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function monthInputValue(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * 初始月份直接讀系統時間，不像倒數計時器的時鐘模式延後到掛載後才填值——
 * 這裡的整份月曆格線都是「今天是幾號」算出來的，延後顯示會讓使用者一開
 * 頁就看到錯的月份，體感比偶爾跨到日期交界時 React 補一次 client patch
 * 還差。這個頁面本來就是每個請求都重新算（route 是動態渲染，不是靜態
 * 快取），伺服器與瀏覽器算出來的「現在」正常情況下只差幾毫秒，唯一會不
 * 一致的情境是請求剛好卡在月份交界那一刻——機率低、後果輕（React 會自己
 * 用瀏覽器端的值把文字補正確），用 suppressHydrationWarning 承認這個
 * 已知、可接受的差異，而不是讓主控台冒出使用者也修不了的警告。
 */
export function CalendarTool() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const days = buildMonthGrid(year, month, today);
  const todayLabel = today.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  function go(delta: number) {
    const next = shiftMonth(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  }

  function jumpToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
  }

  function onPickMonth(event: ChangeEvent<HTMLInputElement>) {
    const [nextYear, nextMonth] = event.target.value.split("-").map(Number);
    if (Number.isFinite(nextYear) && Number.isFinite(nextMonth) && nextMonth >= 1 && nextMonth <= 12) {
      setYear(nextYear);
      setMonth(nextMonth);
    }
  }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  return <section className="workspace calendar-workspace page-shell" aria-label="月曆" suppressHydrationWarning>
    <div className="panel calendar-controls">
      <div className="panel-header"><h2>{year} 年 {month} 月</h2><span className="panel-meta" suppressHydrationWarning>今天 {todayLabel}</span></div>
      <div className="calendar-nav">
        <button className="button button-small button-secondary" type="button" onClick={() => go(-1)} aria-label="上個月">← 上個月</button>
        <label className="sr-only" htmlFor="calendar-month-picker">跳到指定月份</label>
        <input id="calendar-month-picker" className="key-input calendar-month-picker" type="month" value={monthInputValue(year, month)} onChange={onPickMonth} suppressHydrationWarning />
        <button className="button button-small button-secondary" type="button" onClick={() => go(1)} aria-label="下個月">下個月 →</button>
      </div>
      <button className="button button-small button-blue calendar-today-button" type="button" onClick={jumpToday} disabled={isCurrentMonth}>回到本月</button>
      <p className="key-note">週末與週六日以外的休假日會標色；國定假日目前只涵蓋日期每年固定的部分（元旦、228、兒童節、勞動節、國慶日）。農曆節日（春節、端午、中秋）與政府公告的彈性補班尚未收錄，需要時請另外查詢人事行政總處官方行事曆。</p>
    </div>
    <div className="panel panel-tinted calendar-grid-panel">
      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={label} className={index === 0 || index === 6 ? "calendar-weekday calendar-weekday-weekend" : "calendar-weekday"}>{label}</span>
        ))}
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${year} 年 ${month} 月`} suppressHydrationWarning>
        {days.map((day) => {
          const holiday = day.inCurrentMonth ? holidayFor(day.month, day.day) : null;
          const classes = ["calendar-day"];
          if (!day.inCurrentMonth) classes.push("calendar-day-outside");
          if (day.isWeekend) classes.push("calendar-day-weekend");
          if (holiday) classes.push("calendar-day-holiday");
          if (day.isToday) classes.push("calendar-day-today");
          return (
            <div key={day.date} className={classes.join(" ")} role="gridcell" aria-current={day.isToday ? "date" : undefined} aria-label={holiday ? `${day.month} 月 ${day.day} 日，${holiday.name}` : undefined}>
              <span className="calendar-day-number">{day.day}</span>
              {holiday && <span className="calendar-day-holiday-label">{holiday.name}</span>}
            </div>
          );
        })}
      </div>
    </div>
  </section>;
}
