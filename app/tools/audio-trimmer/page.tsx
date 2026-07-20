import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { AudioTrimmerTool } from "./audio-trimmer-tool";

export const metadata: Metadata = { title: "音訊剪輯", description: "上傳 MP3、WAV 等音訊，看著波形框出片段、先試聽再輸出 PCM WAV，全程在瀏覽器本機處理。" };

export default function Page() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>音訊剪輯</h1><span className="privacy-badge">✓ 音訊不上傳</span></div></section><AudioTrimmerTool /><ToolInfo slug="audio-trimmer" /></main>;
}
