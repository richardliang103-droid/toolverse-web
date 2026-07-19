import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { ImageCompressorTool } from "./image-compressor-tool";

export const metadata: Metadata = { title: "圖片壓縮", description: "在瀏覽器本機批次壓縮與轉檔圖片：JPG、PNG、WebP，可調品質與尺寸上限，圖片不上傳。" };

export default function ImageCompressorPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>圖片壓縮</h1><span className="privacy-badge">✓ 圖片只在此裝置處理</span></div></section><ImageCompressorTool /><ToolInfo slug="image-compressor" /></main>;
}
