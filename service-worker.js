/* MLFC Service Worker
 * - Caches static assets for offline/instant load
 * - Does NOT cache API responses (we cache API data in localStorage/sessionStorage in JS)

*/

// Version the cache by the service-worker URL query param (?b=BUILD_ID).
// This prevents the app getting  "stuck" on an old cached index.html.


const SW_URL = new URL(self.location);
const BUILD_ID = SW_URL.searchParams.get("b") || "dev";
const CACHE_NAME = `mlfc-static-${BUILD_ID}`;
const NOTIFICATION_DB = "mlfc-notification-state-v1";
const DISMISSED_STORE = "dismissed";

function openNotificationDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTIFICATION_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DISMISSED_STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeDismissedNotification(id) {
  if (id === null || id === undefined || id === "") return false;
  const value = Number(id);
  if (!Number.isFinite(value)) return false;
  const db = await openNotificationDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DISMISSED_STORE, "readwrite");
    transaction.objectStore(DISMISSED_STORE).put({ id: value });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return true;
}

async function dismissedNotificationIds() {
  const db = await openNotificationDb();
  const ids = await new Promise((resolve, reject) => {
    const request = db.transaction(DISMISSED_STORE).objectStore(DISMISSED_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return ids;
}

async function removeDismissedNotifications(ids) {
  const values = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
  if (!values.length) return;
  const db = await openNotificationDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DISMISSED_STORE, "readwrite");
    values.forEach((id) => transaction.objectStore(DISMISSED_STORE).delete(id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function broadcastDismissedNotification(id) {
  let stored = false;
  try { stored = await storeDismissedNotification(id); } catch {}
  if (!stored) return;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  windows.forEach((client) => client.postMessage({ type: "MLFC_NOTIFICATION_DISMISSED", ids: [Number(id)] }));
}

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/src/app.js",
  "/src/router.js",
  "/src/auth.js",
  "/src/storage.js",
  "/src/nav_state.js",
  "/src/cache_cleanup.js",
  "/src/config.js",
  "/src/prefetch.js",
  "/src/push.js",
  "/src/ui/toast.js",
  "/src/ui/team_field.js",
  "/src/ui/player_photo.js",
  "/src/ui/fc_card.js",
  "/src/ui/face_detection.js",
  "/src/ui/push_reminder.js",
  "/src/ui/install_prompt.js",
  "/src/ui/email_sent_prompt.js",
  "/src/api/client.js",
  "/src/api/endpoints.js",
  "/src/pages/match.js",
  "/src/pages/login.js",
  "/src/pages/register.js",
  "/src/pages/leaderboard.js",
  "/src/pages/admin.js",
  "/src/pages/captain.js",
  "/src/pages/season.js",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon-120.png",
  "/assets/icons/apple-touch-icon-152.png",
  "/assets/icons/apple-touch-icon-167.png",
  "/assets/icons/apple-touch-icon-180.png",
  "/assets/icons/maskable-192.png",
  "/assets/icons/maskable-512.png",
  "/assets/icons/notification-badge.png"
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

// Allow the page to force-activate a newly installed worker and/or clear caches.
// Useful for a "Update app" button.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  const type = String(data.type || "").toUpperCase();

  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (type === "GET_DISMISSED_NOTIFICATIONS") {
    event.waitUntil(dismissedNotificationIds()
      .then((ids) => event.source?.postMessage({ type: "MLFC_NOTIFICATION_DISMISSED", ids }))
      .catch(() => {}));
    return;
  }

  if (type === "ACK_DISMISSED_NOTIFICATIONS") {
    event.waitUntil(removeDismissedNotifications(data.ids).catch(() => {}));
    return;
  }

  if (type === "CLEAR_CACHES" || type === "CLEAR_ALL") {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      })()
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    try {
      const raw = event.data?.text() || "";
      try { data = JSON.parse(raw); } catch { data = { body: raw }; }
    } catch {}
  }

  // Older API releases double-encoded the payload. Keep those queued pushes
  // readable while subscriptions and push-service queues roll forward.
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = { body: data }; }
  }

  // Accept both our direct payload and the common { notification: { ... } }
  // envelope so the real notification copy is not replaced by generic text.
  const notification = data?.notification && typeof data.notification === "object"
    ? data.notification
    : data;
  const title = String(notification?.title || data?.title || "Manor Lakes FC");
  const body = String(notification?.body || data?.body || data?.message || "Open the app to view your update.");
  const options = {
    body,
    icon: "/assets/icons/icon-192.png",
    badge: "/assets/icons/notification-badge.png",
    tag: String(notification?.tag || data?.tag || "mlfc-update"),
    data: {
      url: String(notification?.url || data?.url || "/#/login"),
      notificationId: notification?.notificationId ?? data?.notificationId ?? null,
    },
  };
  const image = String(notification?.image || data?.image || "");
  if (/^https:\/\//i.test(image)) options.image = image;

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "MLFC_PUSH" }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  const notificationId = event.notification?.data?.notificationId;
  event.notification.close();
  event.waitUntil((async () => {
    await broadcastDismissedNotification(notificationId);
    const target = new URL(event.notification?.data?.url || "/#/login", self.location.origin).href;
    const isSameOrigin = new URL(target).origin === self.location.origin;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (isSameOrigin) {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(target);
          return client.focus();
        }
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
  })());
});

self.addEventListener("notificationclose", (event) => {
  event.waitUntil(broadcastDismissedNotification(event.notification?.data?.notificationId));
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
