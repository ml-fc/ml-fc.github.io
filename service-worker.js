/* MLFC Service Worker
 * - Caches static assets for offline/instant load
 * - Does NOT cache API responses (we cache API data in localStorage/sessionStorage in JS)
 */

// Version the cache by the service-worker URL query param (?b=BUILD_ID).
// This prevents the app getting "stuck" on an old cached index.html.
const SW_URL = new URL(self.location);
const BUILD_ID = SW_URL.searchParams.get("b") || "dev";
const CACHE_NAME = `mlfc-static-${BUILD_ID}`;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/src/app.js",
  "/src/router.js",
  "/src/config.js",
  "/src/prefetch.js",
  "/src/api/client.js",
  "/src/api/endpoints.js",
  "/src/pages/match.js",
  "/src/pages/register.js",
  "/src/pages/leaderboard.js",
  "/src/pages/admin.js",
  "/src/pages/captain.js",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Force a network revalidation when (re)building the cache.
      // Otherwise the browser HTTP cache can hand us stale content.
      const requests = STATIC_ASSETS.map(
        (u) => new Request(u, { cache: "reload" })
      );
      await cache.addAll(requests);
    })()
  );

  // Activate immediately.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove ALL older caches.
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))
      );

      // Ensure all tabs are controlled right away.
      await self.clients.claim();
    })()
  );
});

// Cache-first for same-origin static requests (but HTML navigations are network-first)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  // Always fetch fresh manifest (prevents stale icons/install metadata)
  if (url.pathname.endsWith("/manifest.json")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML navigations must be network-first.
  // If we serve cached /index.html forever, users never see the new BUILD_ID
  // and the new service-worker is never registered.
  if (
    event.request.mode === "navigate" ||
    (event.request.headers.get("accept") || "").includes("text/html")
  ) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(
            new Request(event.request, { cache: "no-store" })
          );

          // Keep a copy for offline fallback.
          const cache = await caches.open(CACHE_NAME);
          const key = url.pathname === "/" ? "/" : "/index.html";
          cache.put(key, fresh.clone());

          return fresh;
        } catch {
          const cached = await caches.match(url.pathname === "/" ? "/" : "/index.html");
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Avoid caching anything with a query string (likely dynamic).
  if (url.search) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first only for our known static asset list.
  const path = url.pathname === "/" ? "/" : url.pathname;
  if (!STATIC_ASSETS.includes(path)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
