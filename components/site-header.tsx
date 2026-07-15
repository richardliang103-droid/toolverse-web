import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header page-shell">
      <Link className="brand" href="/" aria-label="Hermes Tools 首頁"><span className="brand-mark" aria-hidden="true">H</span><span>HERMES TOOLS</span></Link>
      <nav className="site-nav" aria-label="主要導覽"><Link href="/#tools">所有工具</Link><Link href="/#tools">關於</Link><Link className="nav-pill" href="/tools/lottery">立即使用</Link></nav>
    </header>
  );
}
