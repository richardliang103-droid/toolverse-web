import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { QuoteBuilderTool } from "./quote-builder-tool";

export const metadata: Metadata = { title: "報價單產生器", description: "免登入的線上報價單產生器：填品項與單價自動算 5% 營業稅，支援未稅（外加稅）與含稅（內含稅）兩種報價，匯出 PNG、SVG、JSON。資料只留在你的瀏覽器。" };

export default function QuoteBuilderPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>報價單產生器</h1><span className="privacy-badge">✓ 資料只在此裝置處理</span></div></section><QuoteBuilderTool /><ToolInfo slug="quote-builder" /></main>;
}
