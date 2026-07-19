import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { BackgroundRemover } from "./background-remover";

export const metadata: Metadata = { title: "圖片去背", description: "在瀏覽器本機以 WebGPU 或 WASM 免費去背，圖片不上傳；也可切換為 remove.bg API 模式取得更高品質結果。" };

export default function BackgroundRemoverPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>圖片去背</h1></div></section><BackgroundRemover /><ToolInfo slug="background-remover" /></main>;
}
