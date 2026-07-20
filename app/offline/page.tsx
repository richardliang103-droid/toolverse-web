import Link from "next/link";

export default function OfflinePage() {
  return <main className="page-shell"><section className="panel" style={{ marginTop: "4rem" }}><h1>目前無法連線</h1><p>這個頁面尚未儲存在裝置上。恢復網路後再開啟工具頁，即可讓瀏覽器保留離線副本。</p><Link className="button button-blue" href="/">回到工具首頁</Link></section></main>;
}
