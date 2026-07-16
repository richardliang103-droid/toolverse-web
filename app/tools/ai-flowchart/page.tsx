import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AiFlowchartTool } from "./ai-flowchart-tool";

export const metadata: Metadata = { title: "AI 流程圖", description: "用中文描述流程，自動產生、驗證並匯出 Mermaid、PNG、SVG 與 draw.io 流程圖。" };

export default function AiFlowchartPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>AI 流程圖</h1><span className="privacy-badge flow-ai-badge">✦ Mermaid / draw.io</span></div></section><AiFlowchartTool /></main>;
}
