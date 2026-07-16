import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { BackgroundRemover } from "./background-remover";

export const metadata: Metadata = { title: "本機 AI 圖片去背", description: "圖片不上傳，在瀏覽器本機以 WebGPU 或 WASM 自動移除背景。" };

export default function BackgroundRemoverPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>圖片去背</h1><span className="privacy-badge">◐ 圖片不上傳</span></div></section><BackgroundRemover /></main>;
}
