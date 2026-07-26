import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

async function render(pathname = "/") {
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the ToolVerse homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ToolVerse/i);
  assert.match(html, /選一個，直接開始/);
  assert.match(html, /隨機抽名單/);
  assert.match(html, /圖片去背/);
  assert.match(html, /流程圖/);
  assert.doesNotMatch(html, /BUILT WITH CARE|更多工具，持續加入|把麻煩的小事/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("serves a deployment version endpoint for production verification", async () => {
  const response = await render("/api/version");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const body = await response.json();
  assert.equal(typeof body.commit, "string");
  assert.equal(typeof body.deploymentId, "string");
});

test("server-renders all tool routes", async () => {
  const routes = [
    ["/tools/lottery", /開始抽選/],
    ["/tools/background-remover", /把圖片拖到這裡/],
    ["/tools/ai-flowchart", /描述你的流程/],
    ["/tools/gantt", /新增任務/],
    ["/tools/random-groups", /開始分組/],
    ["/tools/image-compressor", /開始壓縮/],
    ["/tools/qr-code", /網址或文字/],
    ["/tools/countdown-timer", /設定時間/],
    ["/tools/pdf-toolkit", /合併多份 PDF/],
    ["/tools/text-cleaner", /清理結果/],
    ["/tools/exif-cleaner", /把照片拖到這裡/],
    ["/tools/chinese-converter", /轉換方向/],
    ["/tools/favicon-generator", /預覽與下載/],
    ["/tools/image-crop", /把圖片拖到這裡/],
    ["/tools/text-compare", /兩段文字/],
    ["/tools/markdown-editor", /即時渲染|預覽/],
    ["/tools/csv-editor", /CSV／TSV 表格/],
    ["/tools/image-converter", /輸出格式/],
    ["/tools/audio-trimmer", /把音訊檔拖到這裡|合併音檔/],
  ];
  for (const [pathname, pattern] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} 應回 200`);
    assert.match(await response.text(), pattern, `${pathname} 缺少預期內容`);
  }
});

test("server-renders the workspace page without touching browser storage", async () => {
  const response = await render("/workspace");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /本機工作區/);
  assert.match(html, /把檔案拖到這裡/);
  assert.match(html, /備份與移轉/);
  assert.match(html, /匯出備份/);
  assert.match(html, /合併匯入備份/);
  // 伺服器端沒有 IndexedDB／OPFS，清單必須是「載入中」而不是渲染時就去讀儲存空間。
  assert.match(html, /載入中/);
  // 個人內容不該被索引。
  assert.match(html, /noindex/);
});

test("homepage renders the smart intake entry with an explanatory heading", async () => {
  const html = await (await render()).text();
  assert.match(html, /不確定要用哪個工具/);
  assert.match(html, /貼上文字，或把檔案拖到這裡/);
  assert.match(html, /內容只在瀏覽器裡分析，不會上傳/);
});

test("homepage renders search box and category chips", async () => {
  const html = await (await render()).text();
  assert.match(html, /搜尋工具/);
  assert.match(html, /圖表/);
  assert.match(html, /抽選分組/);
  assert.match(html, /你的工具/);
  assert.match(html, /不記錄最近使用/);
  assert.match(html, /本機工作區/);
});

test("tool pages render usage guide, FAQ, and JSON-LD", async () => {
  const html = await (await render("/tools/lottery")).text();
  assert.match(html, /怎麼使用/);
  assert.match(html, /常見問題/);
  assert.match(html, /抽選結果公平嗎/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /FAQPage/);
  assert.match(html, /WebApplication/);
});

test("serves a sitemap covering every tool", async () => {
  const response = await render("/sitemap.xml");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /xml/);
  const xml = await response.text();
  assert.match(xml, /<urlset/);
  assert.match(xml, /toolverse-web\.vercel\.app\/<\/loc>|toolverse-web\.vercel\.app\/</);
  for (const slug of ["gantt", "qr-code", "chinese-converter", "pdf-toolkit"]) {
    assert.match(xml, new RegExp(`/tools/${slug}</loc>`), `sitemap 缺少 ${slug}`);
  }
});

test("serves robots.txt pointing at the sitemap", async () => {
  const response = await render("/robots.txt");
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /User-agent: \*/);
  assert.match(body, /Sitemap: https:\/\/toolverse-web\.vercel\.app\/sitemap\.xml/);
});
