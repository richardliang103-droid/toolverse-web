import { SiteHeader } from "@/components/site-header";
import { SplitText } from "@/components/split-text";
import { ToolDirectory } from "@/components/tool-directory";
import { tools } from "@/lib/tools";

export default function Home() {
  return (
    <main className="directory-page">
      <SiteHeader />
      <section className="directory-heading page-shell">
        <h1><SplitText text="所有工具" /></h1>
        <p>選一個，直接開始。</p>
      </section>
      <ToolDirectory />
      <footer className="directory-footer page-shell"><span>ToolVerse</span><span>{tools.length} 個工具</span></footer>
    </main>
  );
}
