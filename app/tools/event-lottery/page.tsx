import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { EventLotteryConsole } from "./event-lottery-console";

export const metadata: Metadata = { title: "抽獎系統 - 後台控制面板", description: "尾牙、公司活動用的正式抽獎控制台：多名單群組、多獎項、得獎紀錄，搭配獨立投影舞台；名單與得獎紀錄只留在本機，手機遙控只傳送非敏感狀態摘要。" };

export default function EventLotteryPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>活動抽獎控制台</h1><span className="privacy-badge">✓ 名單留在本機；遙控只傳摘要</span></div></section><EventLotteryConsole /><ToolInfo slug="event-lottery" /></main>;
}
