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
  const matchTabs = document.querySelectorAll('[data-tab="match"], a[href="#/match"], .bottomnav__item[href="#/match"]');
  matchTabs.forEach(el => {
    el.style.display = user ? "" : "none";
  });

  // Toggle Admin tab visibility
  const adminTabs = document.querySelectorAll('[data-tab="admin"], a[href="#/admin"], .bottomnav__item[href="#/admin"]');
  adminTabs.forEach(el => {
    el.style.display = user && user.isAdmin ? "" : "none";
  });

  // Rename Register tab label to Account/Login
  document.querySelectorAll('[data-tab="register"]')
    .forEach(a => { a.textContent = user ? "Account" : "Login"; a.setAttribute("href", "#/login"); });
  document.querySelectorAll('a.bottomnav__item[href="#/login"]')
    .forEach(a => { a.querySelector('.bottomnav__label') && (a.querySelector('.bottomnav__label').textContent = user ? "Account" : "Login"); });
}
