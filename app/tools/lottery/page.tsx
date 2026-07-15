import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { LotteryTool } from "./lottery-tool";

export const metadata: Metadata = { title: "公平抽獎", description: "不用登入，直接從名單中公平抽出得獎者。名單只留在你的瀏覽器。" };

export default function LotteryPage() {
  return <main className="tool-page"><SiteHeader /><section className="tool-hero page-shell"><Link className="back-link" href="/">← 回到工具箱</Link><div className="tool-title-row"><div className="tool-title"><p className="eyebrow">RANDOM · CLIENT SIDE</p><h1>公平抽獎</h1><p>貼上參加者名單，設定中獎人數，剩下的交給安全隨機抽選。</p></div><span className="privacy-badge">✓ 名單不上傳</span></div></section><LotteryTool /><section className="tool-note page-shell"><article className="note-card"><h3>更可靠的隨機來源</h3><p>使用瀏覽器 Crypto API，不以畫面動畫決定結果。</p></article><article className="note-card"><h3>只存在你的裝置</h3><p>名單與最近結果僅保存在目前瀏覽器。</p></article><article className="note-card"><h3>適合一般活動</h3><p>不適用於博彩、金融或需要公證的高價值抽獎。</p></article></section></main>;
}
