import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { TextCleanerTool } from "./text-cleaner-tool";

export const metadata: Metadata = { title: "文字清理", description: "整理雜亂文字：去空白、去重複行、排序、全形轉半形，即時統計字數與行數，內容不上傳。" };

export default function TextCleanerPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>文字清理</h1><span className="privacy-badge">✓ 內容只在此裝置處理</span></div></section><TextCleanerTool /></main>;
}
