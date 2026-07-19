import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { MarkdownEditorTool } from "./markdown-editor-tool";

export const metadata: Metadata = { title: "Markdown 編輯器", description: "即時預覽的 Markdown 編輯器：支援 GFM 表格與程式碼區塊，草稿自動存在瀏覽器，可下載 .md 或複製 HTML。" };

export default function Page() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>Markdown 編輯器</h1><span className="privacy-badge">✓ 草稿只存在此裝置</span></div></section><MarkdownEditorTool /><ToolInfo slug="markdown-editor" /></main>;
}
