import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { CountdownTimerTool } from "./countdown-timer-tool";

export const metadata: Metadata = { title: "倒數計時器", description: "活動與簡報用的全螢幕倒數計時器：快速預設、警示變色、結束提示音，免登入直接用。" };

export default function CountdownTimerPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>倒數計時器</h1><span className="privacy-badge">✓ 免登入直接用</span></div></section><CountdownTimerTool /><ToolInfo slug="countdown-timer" /></main>;
}
