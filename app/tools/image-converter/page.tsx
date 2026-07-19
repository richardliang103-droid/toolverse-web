import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { ImageConverterTool } from "./image-converter-tool";

export const metadata: Metadata = { title: "圖片格式轉換", description: "批次把 JPG、PNG、GIF、BMP、SVG 轉成 WebP、PNG 或 JPG，可調品質，圖片不上傳。" };

export default function Page() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>圖片格式轉換</h1><span className="privacy-badge">✓ 圖片不上傳</span></div></section><ImageConverterTool /><ToolInfo slug="image-converter" /></main>;
}
