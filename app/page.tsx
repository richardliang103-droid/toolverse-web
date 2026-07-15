import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { tools } from "@/lib/tools";

export default function Home() {
  return (
    <main>
      <SiteHeader />
      <section className="hero page-shell">
        <div className="hero-copy">
          <p className="eyebrow">TOOLVERSE · 瀏覽器即開即用</p>
          <h1>把麻煩的小事，<br />變成俐落的一步。</h1>
          <p className="hero-lede">
            一組專注、快速又尊重隱私的網頁工具。免安裝、免登入，現在就能開始。
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/tools/lottery">開始抽獎</Link>
            <Link className="button button-secondary" href="/tools/background-remover">圖片去背</Link>
          </div>
          <div className="trust-row" aria-label="產品特色">
            <span>免註冊</span><span>手機可用</span><span>清楚透明</span>
          </div>
        </div>
        <div className="hero-stage" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hero-card hero-card-main">
            <span className="mini-label">今日好用</span>
            <strong>2 個工具</strong>
            <small>更多工具，持續加入</small>
          </div>
          <div className="hero-chip chip-lottery">✦ 公平抽選</div>
          <div className="hero-chip chip-image">◐ 透明去背</div>
        </div>
      </section>

      <section className="tools-section page-shell" id="tools">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TOOLBOX</p>
            <h2>先從最常用的開始</h2>
          </div>
          <p>每個工具只解決一件事，操作清楚，不塞多餘功能。</p>
        </div>
        <div className="tool-grid">
          {tools.map((tool, index) => (
            <Link className={`tool-card tool-card-${tool.accent}`} href={`/tools/${tool.slug}`} key={tool.slug}>
              <div className="tool-card-top">
                <span className="tool-number">0{index + 1}</span>
                <span className="tool-status">{tool.status}</span>
              </div>
              <div className="tool-symbol" aria-hidden="true">{tool.symbol}</div>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
              <span className="tool-link">開啟工具 <span aria-hidden="true">↗</span></span>
            </Link>
          ))}
          <div className="tool-card tool-card-coming">
            <div className="tool-card-top"><span className="tool-number">03</span><span className="tool-status">COMING</span></div>
            <div className="tool-symbol" aria-hidden="true">＋</div>
            <h3>下一個工具</h3>
            <p>圖片壓縮、QR Code 或文字整理？工具箱會持續長大。</p>
            <span className="tool-link">正在準備中</span>
          </div>
        </div>
      </section>

      <section className="principles page-shell">
        <p className="eyebrow">BUILT WITH CARE</p>
        <div className="principle-grid">
          <article><span>01</span><h3>能在裝置上完成，就不離開裝置</h3><p>抽獎名單只保留在你的瀏覽器，不會上傳到伺服器。</p></article>
          <article><span>02</span><h3>每一步都說清楚</h3><p>需要上傳圖片時，會明確告訴你資料如何處理。</p></article>
          <article><span>03</span><h3>小工具也值得好體驗</h3><p>手機、鍵盤與觸控都好用，沒有廣告迷宮。</p></article>
        </div>
      </section>
      <footer className="site-footer page-shell"><strong>TOOLVERSE</strong><span>讓工具回到工具本身。</span><span>© 2026</span></footer>
    </main>
  );
}
