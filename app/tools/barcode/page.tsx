import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { BarcodeTool } from "./barcode-tool";

export const metadata: Metadata = { title: "條碼產生器", description: "產生 Code 128 與 EAN-13 條碼，EAN 自動計算檢查碼，下載 PNG、SVG，全程在瀏覽器本機完成。" };

export default function BarcodePage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>條碼產生器</h1><span className="privacy-badge">✓ 內容只在此裝置處理</span></div></section><BarcodeTool /><ToolInfo slug="barcode" /></main>;
}
