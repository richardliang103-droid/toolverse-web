import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ChineseConverterTool } from "./chinese-converter-tool";

export const metadata: Metadata = { title: "繁簡轉換", description: "OpenCC 繁簡中文互轉，支援台灣用詞（軟件→軟體），瀏覽器本機處理內容不上傳。" };

export default function ChineseConverterPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>繁簡轉換</h1><span className="privacy-badge">✓ 內容只在此裝置處理</span></div></section><ChineseConverterTool /></main>;
}
