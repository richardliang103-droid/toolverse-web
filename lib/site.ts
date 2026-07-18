import { tools } from "./tools";

// 站台正式網址（單一真相來源）。若之後接自訂網域，只改這裡。
export const SITE_URL = "https://toolverse-web.vercel.app";

/** 供 sitemap 使用的所有頁面路徑，首頁優先權最高。 */
export function sitePaths(): Array<{ path: string; priority: number }> {
  return [
    { path: "/", priority: 1 },
    ...tools.map((tool) => ({ path: `/tools/${tool.slug}`, priority: 0.8 })),
  ];
}
