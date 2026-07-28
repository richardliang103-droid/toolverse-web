import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { CalendarTool } from "./calendar-tool";

export const metadata: Metadata = { title: "月曆", description: "快速檢視日期的月曆：標示今天、週末與國定假日（含農曆節日），可跳到任何月份，免登入直接用。" };

export default function CalendarPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>月曆</h1><span className="privacy-badge">✓ 免登入直接用</span></div></section><CalendarTool /><ToolInfo slug="calendar" /></main>;
}
