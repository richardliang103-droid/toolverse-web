import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { BackgroundRemover } from "./background-remover";

export const metadata: Metadata = { title: "圖片去背", description: "上傳 JPG、PNG 或 WebP，自動移除背景並下載透明 PNG。" };

export default function BackgroundRemoverPage() {
  return <main className="tool-page"><SiteHeader /><section className="tool-hero page-shell"><Link className="back-link" href="/">← 回到工具箱</Link><div className="tool-title-row"><div className="tool-title"><p className="eyebrow">IMAGE · SERVER ASSISTED</p><h1>圖片去背</h1><p>上傳一張圖片，自動移除背景，立即下載透明 PNG。</p></div><span className="privacy-badge">◐ 圖片不永久儲存</span></div></section><BackgroundRemover /><section className="tool-note page-shell"><article className="note-card"><h3>支援常見格式</h3><p>JPG、PNG 與 WebP，單張最大 10 MB。</p></article><article className="note-card"><h3>只做即時處理</h3><p>圖片送至去背服務處理，不會保存在本站。</p></article><article className="note-card"><h3>透明 PNG</h3><p>結果可預覽、比較，並直接下載使用。</p></article></section></main>;
}
