import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { CsvEditorTool } from "./csv-editor-tool";

export const metadata: Metadata = { title: "CSV 編輯器", description: "貼上或開啟 CSV／TSV 直接編輯：改儲存格、增刪欄列、排序，匯出 CSV 或 JSON，檔案不上傳。" };

export default function Page() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>CSV 編輯器</h1><span className="privacy-badge">✓ 資料不上傳</span></div></section><CsvEditorTool /><ToolInfo slug="csv-editor" /></main>;
}
