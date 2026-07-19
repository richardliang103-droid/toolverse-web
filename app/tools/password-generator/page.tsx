import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { PasswordGeneratorTool } from "./password-generator-tool";

export const metadata: Metadata = { title: "密碼產生器", description: "用 Web Crypto 安全隨機產生高強度密碼：可調長度、字元類別與排除易混字元，密碼不上傳、不儲存。" };

export default function PasswordGeneratorPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>密碼產生器</h1><span className="privacy-badge">✓ 密碼只在此裝置產生</span></div></section><PasswordGeneratorTool /></main>;
}
