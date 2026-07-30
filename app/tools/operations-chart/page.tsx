import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { OperationsChartTool } from "./operations-chart-tool";

export const metadata: Metadata = { title: "營運架構圖", description: "免登入的線上營運架構圖：輸入上下游往來對象與佔比，自動畫出三欄架構，標示關係人交易，適合企業徵信報告。資料只留在你的瀏覽器。" };

export default function OperationsChartPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>營運架構圖</h1><span className="privacy-badge">✓ 資料只在此裝置處理</span></div></section><OperationsChartTool /><ToolInfo slug="operations-chart" /></main>;
}
