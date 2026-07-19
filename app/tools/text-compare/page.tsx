import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { TextCompareTool } from "./text-compare-tool";

export const metadata: Metadata = { title: "文字比較", description: "比較兩段文字的差異：逐行、逐詞或逐字，標示新增、刪除與修改，全程在瀏覽器本機比較。" };

export default function Page() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>文字比較</h1><span className="privacy-badge">✓ 內容只在此裝置比較</span></div></section><TextCompareTool /><ToolInfo slug="text-compare" /></main>;
}
