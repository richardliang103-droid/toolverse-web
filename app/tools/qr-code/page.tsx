import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { QrCodeTool } from "./qr-code-tool";

export const metadata: Metadata = { title: "QR Code 產生器", description: "即時產生 QR Code：自訂顏色與容錯等級，下載 PNG、SVG 或直接複製，內容不上傳。" };

export default function QrCodePage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>QR Code 產生器</h1><span className="privacy-badge">✓ 內容只在此裝置處理</span></div></section><QrCodeTool /></main>;
}
