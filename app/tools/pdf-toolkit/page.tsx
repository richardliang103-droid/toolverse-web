import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { PdfToolkitTool } from "./pdf-toolkit-tool";

export const metadata: Metadata = { title: "PDF 合併與取頁", description: "在瀏覽器本機合併多份 PDF 或取出指定頁面，檔案不上傳伺服器。" };

export default function PdfToolkitPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>PDF 合併與取頁</h1><span className="privacy-badge">✓ 檔案只在此裝置處理</span></div></section><PdfToolkitTool /><ToolInfo slug="pdf-toolkit" /></main>;
}
