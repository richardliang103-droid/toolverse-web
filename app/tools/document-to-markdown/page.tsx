import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { DocumentToMarkdownTool } from "./document-to-markdown-tool";

export const metadata: Metadata = {
  title: "文件轉 Markdown",
  description: "在瀏覽器本機把 Word、Excel、PowerPoint、PDF、EPUB、RTF、OpenDocument 與 CSV 轉成 Markdown。",
};

export default function Page() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>文件轉 Markdown</h1><span className="privacy-badge">✓ 資料不上傳</span></div></section><DocumentToMarkdownTool /><ToolInfo slug="document-to-markdown" /></main>;
}
