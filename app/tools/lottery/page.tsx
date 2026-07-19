import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { LotteryTool } from "./lottery-tool";

export const metadata: Metadata = { title: "隨機抽名單", description: "不用登入，直接從名單中公平隨機抽出一位或多位成員。名單只留在你的瀏覽器。" };

export default function LotteryPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>隨機抽名單</h1><span className="privacy-badge">✓ 名單只在此裝置處理</span></div></section><LotteryTool /><ToolInfo slug="lottery" /></main>;
}
