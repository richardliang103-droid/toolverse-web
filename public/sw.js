/* ToolVerse service worker：保守策略 —
   靜態資產 cache-first（檔名帶 hash，不會過期錯亂）、
   頁面 network-first（斷線時回快取），絕不攔截非 GET 與跨網域請求。 */
const CACHE = "toolverse-20260720-v2";
const OFFLINE_PAGE = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_PAGE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("toolverse-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/")
    || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) { const cache = await caches.open(CACHE); cache.put(request, response.clone()); }
      return response;
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) { const cache = await caches.open(CACHE); cache.put(request, response.clone()); }
        return response;
      } catch {
        const cached = await caches.match(request);
        return cached ?? (await caches.match(OFFLINE_PAGE)) ?? Response.error();
      }
    })());
  }
});
