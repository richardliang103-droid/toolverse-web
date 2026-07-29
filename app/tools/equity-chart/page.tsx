import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { EquityChartTool } from "./equity-chart-tool";

export const metadata: Metadata = { title: "股權架構圖", description: "免登入的線上股權架構圖：輸入股東與持股比例，自動畫出分層架構，標示境外公司與公司狀態，匯出 PNG、SVG、JSON。資料只留在你的瀏覽器。" };

export default function EquityChartPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>股權架構圖</h1><span className="privacy-badge">✓ 資料只在此裝置處理</span></div></section><EquityChartTool /><ToolInfo slug="equity-chart" /></main>;
}
