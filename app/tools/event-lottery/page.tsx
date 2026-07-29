import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { EventLotteryConsole } from "./event-lottery-console";

export const metadata: Metadata = { title: "活動抽獎控制台", description: "尾牙、公司活動用的正式抽獎控制台：多名單群組、多獎項、得獎紀錄，搭配獨立投影舞台，資料只留在這台裝置。" };

export default function EventLotteryPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>活動抽獎控制台</h1><span className="privacy-badge">✓ 資料只在此裝置處理</span></div></section><EventLotteryConsole /><ToolInfo slug="event-lottery" /></main>;
}
