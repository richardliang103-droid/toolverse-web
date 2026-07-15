import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AiFlowchartTool } from "./ai-flowchart-tool";

export const metadata: Metadata = { title: "AI 流程圖", description: "用中文描述流程，自動產生、驗證並匯出 Mermaid、PNG、SVG 與 draw.io 流程圖。" };

export default function AiFlowchartPage() {
  return <main className="tool-page"><SiteHeader /><section className="tool-hero page-shell"><Link className="back-link" href="/">← 回到工具箱</Link><div className="tool-title-row"><div className="tool-title"><p className="eyebrow">DIAGRAM · STRUCTURED AI</p><h1>AI 流程圖</h1><p>用中文描述需求，AI 會拆成節點與連線，通過結構驗證後產生 Mermaid 與 draw.io 格式。</p></div><span className="privacy-badge flow-ai-badge">✦ 可編輯、可匯出</span></div></section><AiFlowchartTool /><section className="tool-note page-shell"><article className="note-card"><h3>先驗證再繪圖</h3><p>自動整理節點 ID、重複連線與失效關係。</p></article><article className="note-card"><h3>四種帶走方式</h3><p>可下載 PNG、SVG、.drawio，或複製 Mermaid 原始碼。</p></article><article className="note-card"><h3>繼續細修</h3><p>一鍵帶入 diagrams.net，調整位置、樣式與更多圖形。</p></article></section></main>;
}
