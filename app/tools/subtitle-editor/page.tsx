import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToolInfo } from "@/components/tool-info";
import { SubtitleEditorTool } from "./subtitle-editor-tool";

export const metadata: Metadata = {
  title: "字幕編輯器",
  description: "SRT 與 VTT 字幕互轉、時間碼整體偏移與影格率倍率校正，可逐條編輯並輸出字幕或逐字稿，字幕檔不上傳。",
};

export default function SubtitleEditorPage() {
  return <main className="tool-page"><SiteHeader /><section className="compact-tool-heading page-shell"><Link className="back-link" href="/">← 所有工具</Link><div><h1>字幕編輯器</h1><span className="privacy-badge">✓ 字幕只在此裝置處理</span></div></section><SubtitleEditorTool /><ToolInfo slug="subtitle-editor" /></main>;
}
