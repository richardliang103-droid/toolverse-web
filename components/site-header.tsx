import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header page-shell">
      <Link className="brand" href="/" aria-label="ToolVerse 首頁"><span className="brand-mark" aria-hidden="true">T</span><span>TOOLVERSE</span></Link>
      <nav className="site-nav" aria-label="主要導覽"><Link href="/#tools">工具</Link></nav>
    </header>
  );
}
