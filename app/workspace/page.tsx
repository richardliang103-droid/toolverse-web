import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { WorkspaceView } from "./workspace-view";

export const metadata: Metadata = {
  title: "本機工作區",
  description: "把處理結果暫存在這台裝置的瀏覽器裡，不必下載再重新上傳。檔案不會離開你的瀏覽器。",
  // 工作區的內容因人而異，對搜尋引擎沒有意義，也不該被索引。
  robots: { index: false, follow: true },
};

export default function WorkspacePage() {
  return (
    <main className="tool-page">
      <SiteHeader />
      <section className="compact-tool-heading page-shell">
        <Link className="back-link" href="/">← 所有工具</Link>
        <div>
          <h1>本機工作區</h1>
          <span className="privacy-badge">✓ 檔案只存在此裝置</span>
        </div>
      </section>
      <WorkspaceView />
    </main>
  );
}
