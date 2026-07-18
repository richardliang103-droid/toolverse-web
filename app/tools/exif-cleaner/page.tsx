import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ExifCleanerTool } from "./exif-cleaner-tool";

export const metadata: Metadata = { title: "照片隱私清除", description: "無損移除照片的 EXIF、GPS 位置與拍攝資訊，畫質完全不變，照片不上傳。" };

export default function ExifCleanerPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>照片隱私清除</h1><span className="privacy-badge">✓ 照片只在此裝置處理</span></div></section><ExifCleanerTool /></main>;
}
