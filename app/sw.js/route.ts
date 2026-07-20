export const dynamic = "force-dynamic";

const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local";
const cacheName = `toolverse-${commit.slice(0, 12)}`;

export function GET() {
  const script = `/* Generated for ${cacheName}: do not cache this response. */
const CACHE = ${JSON.stringify(cacheName)};
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
    || /\\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname);
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
});`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Service-Worker-Allowed": "/",
    },
  });
}
