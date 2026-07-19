import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { FaviconGeneratorTool } from "./favicon-generator-tool";

export const metadata: Metadata = { title: "Favicon 產生器", description: "用文字、emoji 或圖片產生整套 favicon（16/32/180/192/512），附 HTML 與 manifest 片段，本機處理不上傳。" };

export default function FaviconGeneratorPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>Favicon 產生器</h1><span className="privacy-badge">✓ 圖片只在此裝置處理</span></div></section><FaviconGeneratorTool /></main>;
}
