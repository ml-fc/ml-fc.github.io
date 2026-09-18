import { API } from "./api/endpoints.js";
import { getCachedUser } from "./auth.js";

const LS_PUSH_SYNC = "mlfc_push_sync_v1";
const PUSH_SYNC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

export function pushSupport() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, reason: "Push notifications are not supported by this browser." };
  }
  return { supported: true, permission: Notification.permission };
}

export async function ensurePushSubscribed({ requestPermission = false } = {}) {
  const support = pushSupport();
  if (!support.supported) return { ok: false, error: support.reason };

  let permission = Notification.permission;
  if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      permission,
      error: permission === "denied"
        ? "Notifications are blocked. Allow them in your phone settings, then try again."
        : "Notification permission was not enabled.",
    };
  }

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    const out = await API.pushPublicKey();
    if (!out?.ok || !out?.publicKey) throw new Error("Push notification setup is unavailable.");
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(out.publicKey),
    });
  }

  const user = getCachedUser();
  const endpoint = String(subscription.endpoint || "");
  let lastSync = null;
  try { lastSync = JSON.parse(localStorage.getItem(LS_PUSH_SYNC) || "null"); } catch {}
  const alreadySynced = lastSync?.endpoint === endpoint
    && lastSync?.playerName === String(user?.name || "")
    && Date.now() - Number(lastSync?.ts || 0) < PUSH_SYNC_MAX_AGE_MS;

  if (!alreadySynced) {
    const result = await API.pushSubscribe(subscription, navigator.userAgent);
    if (!result?.ok) throw new Error(result?.error || "Could not register this phone for notifications.");
    try {
      localStorage.setItem(LS_PUSH_SYNC, JSON.stringify({
        endpoint,
        playerName: String(user?.name || ""),
        ts: Date.now(),
      }));
    } catch {}
  }

  return { ok: true, permission: "granted", subscription };
}
