import { startRouter } from "./router.js";
import { warmAppData } from "./prefetch.js";
import { initReloadContext } from "./nav_state.js";
import { getCachedUser, refreshMe, updateNavForUser } from "./auth.js";
import { API } from "./api/endpoints.js";

const LS_NOTIFIED = "mlfc_notified_ids_v1";

function notifyDesktop(title, body) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return;
    }
  } catch {}
}

async function checkNotificationsOnce() {
  const cachedUser = getCachedUser();
  if (!cachedUser) return;
  let perm = "default";
  try {
    perm = ("Notification" in window) ? Notification.permission : "default";
    if (perm === "default") {
      // Ask once after user logs in (best-effort)
      await Notification.requestPermission().catch(() => {});
    }
  } catch {}

  const out = await API.notifications().catch(() => null);
  if (!out?.ok) return;

  const ids = new Set();
  try { (JSON.parse(localStorage.getItem(LS_NOTIFIED) || "[]") || []).forEach(x => ids.add(String(x))); } catch {}

  const unread = (out.notifications || []).slice(0, 10);
  const newly = [];
  for (const n of unread) {
    const id = String(n.id);
    if (!ids.has(id)) {
      newly.push(n);
      ids.add(id);
    }
  }

  if (newly.length) {
    // Show a single summary notification to avoid spamming
    const first = newly[0];
    notifyDesktop("MLFC", newly.length === 1 ? first.message : `${newly.length} new notifications`);
    try { localStorage.setItem(LS_NOTIFIED, JSON.stringify(Array.from(ids).slice(0, 200))); } catch {}
  }
}

function boot() {
  // Record reload context (if this app load is a browser reload)
  initReloadContext();

  // Prefetch API data without blocking UI
  warmAppData().catch(() => {});

  // Load current user (if token exists) and update nav visibility
  const cached = getCachedUser();
  if (cached) updateNavForUser(cached);
  refreshMe()
    .then(u => {
      updateNavForUser(u);
      // Desktop/app notification (best-effort)
      checkNotificationsOnce().catch(() => {});
    })
    .catch(() => updateNavForUser(null));

  // Start hash router + initial render
  startRouter();
}

// Make sure DOM exists first
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
