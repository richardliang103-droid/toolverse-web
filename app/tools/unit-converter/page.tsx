import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { UnitConverterTool } from "./unit-converter-tool";

export const metadata: Metadata = { title: "單位換算", description: "長度、面積、重量、容量、溫度、速度即時換算，支援坪、甲、台斤等台制單位，全程在瀏覽器本機計算。" };

export default function UnitConverterPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>單位換算</h1><span className="privacy-badge">✓ 本機計算，不需連線</span></div></section><UnitConverterTool /><ToolInfo slug="unit-converter" /></main>;
}
