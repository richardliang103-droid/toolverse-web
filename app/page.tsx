import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { tools } from "@/lib/tools";

export default function Home() {
  return (
    <main className="directory-page">
      <SiteHeader />
      <section className="directory-heading page-shell">
        <h1>所有工具</h1>
        <p>選一個，直接開始。</p>
      </section>
      <section className="compact-tool-grid page-shell" id="tools" aria-label="工具列表">
        {tools.map((tool) => (
          <Link className={`compact-tool compact-tool-${tool.accent}`} href={`/tools/${tool.slug}`} key={tool.slug}>
            <span className="compact-tool-icon" aria-hidden="true">{tool.symbol}</span>
            <span className="compact-tool-copy">
              <strong>{tool.name}</strong>
              <small>{tool.description}</small>
            </span>
            <span className="compact-tool-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>
      <footer className="directory-footer page-shell"><span>ToolVerse</span><span>{tools.length} 個工具</span></footer>
    </main>
  );
}
