import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { BackgroundRemover } from "./background-remover";

export const metadata: Metadata = { title: "本機 AI 圖片去背", description: "圖片不上傳，在瀏覽器本機以 WebGPU 或 WASM 自動移除背景。" };

export default function BackgroundRemoverPage() {
  return <main className="tool-page"><SiteHeader /><section className="tool-hero page-shell"><Link className="back-link" href="/">← 回到工具箱</Link><div className="tool-title-row"><div className="tool-title"><p className="eyebrow">IMAGE · ON-DEVICE AI</p><h1>圖片去背</h1><p>圖片不離開你的裝置，由瀏覽器本機 AI 自動移除背景。</p></div><span className="privacy-badge">◐ 100% 圖片不上傳</span></div></section><BackgroundRemover /><section className="tool-note page-shell"><article className="note-card"><h3>支援常見格式</h3><p>JPG、PNG 與 WebP，單張最大 10 MB。</p></article><article className="note-card"><h3>本機 AI 運算</h3><p>優先使用 WebGPU，無法使用時自動切換至 WASM。</p></article><article className="note-card"><h3>透明 PNG</h3><p>結果可預覽、比較，並直接下載使用。</p></article></section></main>;
}
