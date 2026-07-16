import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { LotteryTool } from "./lottery-tool";

export const metadata: Metadata = { title: "線上抽獎", description: "不用登入，直接從名單中公平抽出得獎者。名單只留在你的瀏覽器。" };

export default function LotteryPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>線上抽獎</h1><span className="privacy-badge">✓ 名單不上傳</span></div></section><LotteryTool /></main>;
}
