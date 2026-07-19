import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { ImageCropTool } from "./image-crop-tool";

export const metadata: Metadata = { title: "圖片裁切", description: "在瀏覽器本機裁切圖片：自由框選或固定比例（1:1、16:9…），輸出 PNG、JPG，圖片不上傳。" };

export default function ImageCropPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>圖片裁切</h1><span className="privacy-badge">✓ 圖片不上傳</span></div></section><ImageCropTool /><ToolInfo slug="image-crop" /></main>;
}
