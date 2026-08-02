import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { ScreenshotBeautifierTool } from "./screenshot-beautifier-tool";

export const metadata: Metadata = { title: "截圖美化", description: "在瀏覽器本機幫截圖加上日系和色漸層背景、留白、圓角與陰影，輸出 1:1、16:9、9:16 等社群常用比例的 PNG、JPG，圖片不上傳。" };

export default function ScreenshotBeautifierPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>截圖美化</h1><span className="privacy-badge">✓ 圖片不上傳</span></div></section><ScreenshotBeautifierTool /><ToolInfo slug="screenshot-beautifier" /></main>;
}
