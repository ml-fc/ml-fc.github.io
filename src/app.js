import { startRouter } from "./router.js";
import { warmAppData } from "./prefetch.js";
import { initReloadContext } from "./nav_state.js";
import { getCachedUser, refreshMe, updateNavForUser } from "./auth.js";
import { API } from "./api/endpoints.js";
import { ensurePushSubscribed } from "./push.js";
import { showInitialPushEnableReminder } from "./ui/push_reminder.js";
import { initInstallPrompt } from "./ui/install_prompt.js";
import { applyWeeklyTheme, initWeeklyTheme } from "./themes.js";

const LS_NOTIFIED = "mlfc_notified_ids_v1";
const LS_NOTI_CACHE = "mlfc_notifications_cache_v1";

let __mlfcNotiLastCheck = 0;
let __mlfcNotiInflight = null;
const NOTIFICATION_REFRESH_COOLDOWN_MS = 30 * 1000;
async function refreshIdentity() {
  const before = getCachedUser();
  const user = await refreshMe(true);
  updateNavForUser(user);
  if (String(before?.photoUrl || "") !== String(user?.photoUrl || "")) {
    try {
      Object.keys(localStorage).filter(key => key.startsWith("mlfc_match_detail_cache_v2:") || key.startsWith("mlfc_admin_manage_cache_v3:")).forEach(key => localStorage.removeItem(key));
    } catch {}
    window.dispatchEvent(new CustomEvent("mlfc:identity-updated", { detail: user }));
  }
  return user;
}
function notifyDesktop(title, body) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    // ignore
  }
}

function setAccountNotiBadge(has) {
  try {
    // Apply to both desktop tab + mobile bottom nav item
    const els = document.querySelectorAll(
      'nav.tabs a[href="#/login"], nav.tabs a[data-tab="register"], nav.bottomnav a[href="#/login"], a.bottomnav__item[href="#/login"]'
    );
    els.forEach((a) => a.classList.toggle("has-noti", !!has));
  } catch {
    // ignore
  }
}

function hydrateBadgeFromCache() {
  try {
    const raw = localStorage.getItem(LS_NOTI_CACHE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const list = parsed?.data?.notifications || parsed?.notifications || [];
    setAccountNotiBadge(Array.isArray(list) && list.length > 0);
  } catch {
    // ignore
  }
}

async function checkNotificationsBadge(reason = "nav", { force = false } = {}) {
  const cachedUser = getCachedUser();
  if (!cachedUser) {
    setAccountNotiBadge(false);
    return;
  }

  const nowTs = Date.now();
  // Throttle to avoid hammering the API while tabbing around.
  // (Still allow forced checks, e.g. the 10-minute timer.)
  if (!force && nowTs - __mlfcNotiLastCheck < NOTIFICATION_REFRESH_COOLDOWN_MS) return null;
  if (__mlfcNotiInflight) return __mlfcNotiInflight;
  __mlfcNotiLastCheck = nowTs;

  __mlfcNotiInflight = API.notifications().catch(() => null);
  const out = await __mlfcNotiInflight;
  __mlfcNotiInflight = null;
  if (!out?.ok) return null;

  try {
    localStorage.setItem(LS_NOTI_CACHE, JSON.stringify({ ts: nowTs, data: out }));
  } catch {
    // ignore
  }

  setAccountNotiBadge((out.notifications || []).length > 0);
  return out;
}

function acknowledgePhoneDismissals(ids) {
  navigator.serviceWorker?.controller?.postMessage({ type: "ACK_DISMISSED_NOTIFICATIONS", ids });
}

async function syncPhoneDismissals(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite))];
  if (!list.length || !getCachedUser()) return;
  const result = await API.notificationsMarkRead(list).catch(() => null);
  if (!result?.ok) return;

  try {
    const cached = JSON.parse(localStorage.getItem(LS_NOTI_CACHE) || "null");
    const removed = new Set(list.map(String));
    const notifications = (cached?.data?.notifications || []).filter((item) => !removed.has(String(item.id)));
    localStorage.setItem(LS_NOTI_CACHE, JSON.stringify({ ts: Date.now(), data: { ok: true, notifications } }));
    setAccountNotiBadge(notifications.length > 0);
  } catch {}
  acknowledgePhoneDismissals(list);
  await checkNotificationsBadge("phone-dismiss", { force: true });
  if ((location.hash || "").split("?")[0] === "#/login") {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

function requestPendingPhoneDismissals() {
  navigator.serviceWorker?.controller?.postMessage({ type: "GET_DISMISSED_NOTIFICATIONS" });
}


async function checkNotificationsOnce() {
  const cachedUser = getCachedUser();
  if (!cachedUser) return;

  // Browsers require notification permission prompts to follow a user gesture.
  // Startup only repairs an already-granted subscription; the Account screen
  // owns the explicit "Enable notifications" action.
  await ensurePushSubscribed().catch(() => {});

  const out = await checkNotificationsBadge("startup", { force: true });
  if (!out?.ok) return;

  const ids = new Set();
  try {
    (JSON.parse(localStorage.getItem(LS_NOTIFIED) || "[]") || []).forEach((x) => ids.add(String(x)));
  } catch {
    // ignore
  }

  const list = (out.notifications || []).slice(0, 10);
  const newly = [];
  for (const n of list) {
    const id = String(n.id);
    if (!ids.has(id)) {
      newly.push(n);
      ids.add(id);
    }
  }

  if (newly.length) {
    const first = newly[0];
    notifyDesktop("MLFC", newly.length === 1 ? first.message : `${newly.length} new notifications`);
    try {
      localStorage.setItem(LS_NOTIFIED, JSON.stringify(Array.from(ids).slice(0, 200)));
    } catch {
      // ignore
    }
  }
}

function resetBusyButtons() {
  try {
    document.querySelectorAll("button[disabled][data-orig-text]").forEach((b) => {
      b.disabled = false;
      b.textContent = b.dataset.origText || b.textContent;
    });
  } catch {
    // ignore
  }
}

function ensureInitialRouteRender() {
  // On hard refresh, some browsers won"t fire hashchange. Make sure router + tab state render.
  try {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } catch {
    // ignore
  }
}

function rerenderPhotoSensitiveRoute() {
  const path = (location.hash || "#/match").split("?")[0];
  if (!["#/match", "#/admin", "#/captain"].includes(path)) return;
  window.dispatchEvent(new CustomEvent("mlfc:rerender-route"));
}

function boot() {
  window.addEventListener("unhandledrejection", () => resetBusyButtons());
  window.addEventListener("error", () => resetBusyButtons());

  initReloadContext();
  initInstallPrompt();
  initWeeklyTheme(API.themeCurrent).catch(() => {});
  window.addEventListener("mlfc:theme-setting-changed", (event) => applyWeeklyTheme(event.detail));
  warmAppData().catch(() => {});

  // Render any cached badge immediately (keeps badge on mobile too)
  hydrateBadgeFromCache();

  // Update nav based on cached user first (fast path)
  const cached = getCachedUser();
  if (cached) updateNavForUser(cached);

  // Confirm auth from API and refresh nav
  refreshIdentity()
    .then((u) => {
      updateNavForUser(u);
      if (u) showInitialPushEnableReminder(document.body).catch(() => {});
      checkNotificationsOnce().catch(() => {});
      if (u) requestPendingPhoneDismissals();
    })
    .catch(() => {
      updateNavForUser(null);
      setAccountNotiBadge(false);
    });

  // Check notifications when user navigates across tabs.
  window.addEventListener("hashchange", () => {
    checkNotificationsBadge("tab").catch(() => {});
  });

  // Also re-check when the browser tab becomes visible again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkNotificationsBadge("visible").catch(() => {});
      refreshIdentity().catch(() => {});
    }
  });

  window.addEventListener("online", () => {
    checkNotificationsBadge("online").catch(() => {});
  });

  window.addEventListener("mlfc:player-photo-updated", rerenderPhotoSensitiveRoute);
  window.addEventListener("mlfc:identity-updated", rerenderPhotoSensitiveRoute);
  window.addEventListener("storage", event => {
    const key = String(event.key || "");
    if (key.startsWith("mlfc_match_detail_cache_v2:") || key.startsWith("mlfc_admin_manage_cache_v3:") || key.startsWith("mlfc_captain_teams_v1:")) rerenderPhotoSensitiveRoute();
  });

  // When a Web Push arrives, the Service Worker will postMessage("MLFC_PUSH") to any open tabs.
  // Use that as a trigger to refresh the in-app badge and (if currently viewing Account) the list.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev?.data?.type === "MLFC_NOTIFICATION_DISMISSED") {
        syncPhoneDismissals(ev.data.ids).catch(() => {});
        return;
      }
      if (ev?.data?.type !== "MLFC_PUSH") return;

      // Update badge immediately
      checkNotificationsBadge("push", { force: true }).catch(() => {});

      // If the user is currently on the Account/Login page, force a re-render so the list updates
      try {
        const hash = window.location.hash || "";
        const path = hash.split("?")[0];
        if (path === "#/login") {
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      } catch {}
    });
  }

  startRouter();
  ensureInitialRouteRender();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
