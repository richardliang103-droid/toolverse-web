import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { RandomGroupsTool } from "./random-groups-tool";

export const metadata: Metadata = { title: "隨機分組", description: "貼上名單，用安全隨機來源公平分組：可指定組數或每組人數，結果可複製或下載 CSV。名單只留在你的瀏覽器。" };

export default function RandomGroupsPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>隨機分組</h1><span className="privacy-badge">✓ 名單只在此裝置處理</span></div></section><RandomGroupsTool /></main>;
}
