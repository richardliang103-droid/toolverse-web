import { Entrance } from "@/components/entrance";
import { SiteHeader } from "@/components/site-header";
import { SplitText } from "@/components/split-text";
import { ToolDirectory } from "@/components/tool-directory";
import { tools } from "@/lib/tools";

export default function Home() {
  return (
    <main className="directory-page">
      <SiteHeader />
      <Entrance>
        <section className="directory-heading page-shell">
          <p className="directory-eyebrow" data-rise><span className="eyebrow-seal" aria-hidden="true">道</span>TOOLVERSE — 免登入・資料留在你手上</p>
          <h1><SplitText text="所有工具" /></h1>
          <p data-rise>選一個，直接開始。</p>
        </section>
        <ToolDirectory />
        <footer className="directory-footer page-shell" data-rise>
          <div className="footer-brand"><span className="brand-mark" aria-hidden="true">T</span><strong>TOOLVERSE</strong><span className="footer-kana">実用の道具箱</span></div>
          <p className="footer-line">全 {tools.length} 項工具・多數在你的瀏覽器本機完成・需連線功能會明確標示</p>
        </footer>
      </Entrance>
    </main>
  );
}
