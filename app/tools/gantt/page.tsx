import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { GanttTool } from "./gantt-tool";

export const metadata: Metadata = { title: "甘特圖", description: "免登入的線上甘特圖：拖曳排出任務、里程碑與依賴關係，匯出 PNG、CSV、Mermaid 與 JSON。時程只留在你的瀏覽器。" };

export default function GanttPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>甘特圖</h1><span className="privacy-badge">✓ 時程只在此裝置處理</span></div></section><GanttTool /></main>;
}
