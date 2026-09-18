// src/auth.js
import { API } from "./api/endpoints.js";

const LS_TOKEN = "mlfc_token_v1";
const LS_USER = "mlfc_user_v1";

export function getToken() {
  try { return String(localStorage.getItem(LS_TOKEN) || "").trim(); } catch { return ""; }
}

export function setToken(token) {
  try { localStorage.setItem(LS_TOKEN, String(token || "")); } catch {}
}

export function clearAuth() {
  try { localStorage.removeItem(LS_TOKEN); } catch {}
  try { localStorage.removeItem(LS_USER); } catch {}
}

export function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || "null"); } catch { return null; }
}

export function setCachedUser(user) {
  try { localStorage.setItem(LS_USER, JSON.stringify(user || null)); } catch {}
}

export async function refreshMe(force = false) {
  if (!getToken()) {
    clearAuth();
    return null;
  }
  if (!force) {
    const cached = getCachedUser();
    if (cached) return cached;
  }
  const res = await API.me();
  if (!res?.ok) {
    clearAuth();
    return null;
  }
  setCachedUser(res.user);
  return res.user;
}

export function updateNavForUser(user) {
  // Match features require login. Leaderboard stays public.
  // Keep the brand/home link visible. Only hide the actual navigation items.
  const matchTabs = document.querySelectorAll('nav.tabs [data-tab="match"], nav.bottomnav .bottomnav__item[href="#/match"]');
  matchTabs.forEach(el => {
    el.style.display = user ? "" : "none";
  });

  const seasonTabs = document.querySelectorAll('[data-tab="season"], a[href="#/season"], .bottomnav__item[href="#/season"]');
  seasonTabs.forEach(el => {
    el.style.display = user ? "" : "none";
  });

  // Toggle Admin tab visibility
  const adminTabs = document.querySelectorAll('[data-tab="admin"], a[href="#/admin"], .bottomnav__item[href="#/admin"]');
  adminTabs.forEach(el => {
    el.style.display = user && user.isAdmin ? "" : "none";
  });

  // Profile is the home for account, security and notification settings.
  document.querySelectorAll('[data-tab="register"]')
    .forEach(a => { a.textContent = user ? "Profile" : "Sign in"; a.setAttribute("href", "#/login"); });
  document.querySelectorAll('a.bottomnav__item[href="#/login"]')
    .forEach(a => { a.querySelector('.bottomnav__label') && (a.querySelector('.bottomnav__label').textContent = user ? "Profile" : "Sign in"); });

  const profile = document.querySelector("#appbarProfile");
  const image = document.querySelector("#appbarProfileImage");
  const fallback = document.querySelector("#appbarProfileFallback");
  if (profile) profile.hidden = !user;
  if (fallback) fallback.textContent = String(user?.name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "?";
  let photo = "";
  try { const parsed = new URL(String(user?.photoUrl || "")); if (parsed.protocol === "https:" || ["localhost", "127.0.0.1"].includes(parsed.hostname)) photo = parsed.href; } catch {}
  if (image) {
    image.hidden = true;
    image.removeAttribute("src");
    image.dataset.pendingPhoto = photo;
    if (fallback) fallback.hidden = false;
    if (photo) {
      const probe = new Image();
      probe.onload = () => {
        if (image.dataset.pendingPhoto !== photo) return;
        image.src = photo;
        image.hidden = false;
        if (fallback) fallback.hidden = true;
      };
      probe.onerror = () => {
        if (image.dataset.pendingPhoto === photo && fallback) fallback.hidden = false;
      };
      probe.src = photo;
    }
  }
}
