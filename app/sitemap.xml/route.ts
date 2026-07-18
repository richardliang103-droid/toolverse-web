import { SITE_URL, sitePaths } from "@/lib/site";

// 以 Route Handler 產生 sitemap，而非 Next 的 app/sitemap.ts 慣例：
// 這個專案同時用 vinext 與 next build 兩套建置，route handler（如 /api）
// 是已驗證兩邊都能運作的路徑。
export const dynamic = "force-static";

export function GET() {
  const lastModified = new Date().toISOString();
  const urls = sitePaths()
    .map(({ path, priority }) => `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <lastmod>${lastModified}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority.toFixed(1)}</priority>\n  </url>`)
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
