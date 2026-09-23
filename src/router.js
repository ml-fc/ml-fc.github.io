// src/router.js
import { renderMatchPage } from "./pages/match.js";
import { renderLeaderboardPage } from "./pages/leaderboard.js";
import { renderAdminPage } from "./pages/admin.js";
import { renderCaptainPage } from "./pages/captain.js";
import { renderLoginPage } from "./pages/login.js";
import { renderSeasonPage } from "./pages/season.js";
import { getToken, getCachedUser, refreshMe } from "./auth.js";

const ROUTES = {
  "#/match": renderMatchPage,
  "#/leaderboard": renderLeaderboardPage,
  "#/admin": renderAdminPage,
  "#/captain": renderCaptainPage,
  "#/login": renderLoginPage,
  "#/season": renderSeasonPage,
};

const PAGE_CONTAINERS = {};   // route -> div
const LAST_HASH_BY_ROUTE = {}; // route -> full hash (includes query)

// Used by pages to cancel stale async UI updates
export function getRouteToken() {
  return window.__mlfcRouteToken || "";
}
export function setRouteToken() {
  window.__mlfcRouteToken = String(Math.random());
  return window.__mlfcRouteToken;
}

// Compatibility export (in case anything still imports getRoute)
export function getRoute() {
  const hash = window.location.hash || "#/match";
  const [path, qs] = hash.split("?");
  const query = new URLSearchParams(qs || "");
  return { path, query };
}

function getPathQueryAndHash() {
  const hash = window.location.hash || "#/match";
  const [path, qs] = hash.split("?");
  const query = new URLSearchParams(qs || "");
  return { path, query, fullHash: hash };
}

function getRoot() {
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app in index.html");
  return root;
}

function ensureContainer(route) {
  const root = getRoot();
  if (!PAGE_CONTAINERS[route]) {
    const div = document.createElement("div");
    div.dataset.route = route;
    div.hidden = true;
    root.appendChild(div);
    PAGE_CONTAINERS[route] = div;
  }
  return PAGE_CONTAINERS[route];
}

function showOnly(route) {
  Object.entries(PAGE_CONTAINERS).forEach(([r, el]) => {
    const active = r === route;
    el.hidden = !active;
    el.classList.toggle("route--active", active);
  });
}

async function renderRoute() {
  const { path, query, fullHash } = getPathQueryAndHash();
  // Auth guard
  const hasToken = !!getToken();
  let route = ROUTES[path] ? path : (hasToken ? "#/match" : "#/login");

  // If not logged in, force login page except for leaderboard
  if (!hasToken && route !== "#/login" && route !== "#/leaderboard") {
    window.location.hash = "#/login";
    return;
  }

  // Refresh older cached user records that predate profile photos so an existing
  // server-side photo is not mistaken for a missing one.
  let user = getCachedUser();
  if (hasToken && (!user || !Object.prototype.hasOwnProperty.call(user, "photoUrl") || !Object.prototype.hasOwnProperty.call(user, "phone") || !Object.prototype.hasOwnProperty.call(user, "email") || !Object.prototype.hasOwnProperty.call(user, "emailVerifiedAt"))) {
    user = await refreshMe(true).catch(() => null);
  }
  const isSuperAdmin = String(user?.name || "").trim().toLowerCase() === "admin";
  const profileIncomplete = user && (!String(user.photoUrl || "").trim() || (!isSuperAdmin && (!String(user.phone || "").trim() || !String(user.email || "").trim() || !String(user.emailVerifiedAt || "").trim())));
  if (hasToken && profileIncomplete && route !== "#/login") {
    window.location.hash = "#/login?profile=required";
    return;
  }

  if (route === "#/admin") {
    if (!user?.isAdmin) {
      window.location.hash = "#/match";
      return;
    }
  }
  const token = setRouteToken();

  const container = ensureContainer(route);
  showOnly(route);

  const lastHash = LAST_HASH_BY_ROUTE[route] || "";
  const firstTime = !container.dataset.rendered;

  // Key behavior:
  // - Switch tabs: no rerender if same hash for that route
  // - Open match detail: hash changes (#/match?code=...) => rerender match page
  // Login page content depends on auth state, so always re-render it.
  // Score/ratings actions happen on the captain page. Re-render match and admin
  // whenever they are revisited so hidden route DOM cannot show stale results.
  const shouldRender = firstTime || (fullHash !== lastHash) || route === "#/login" || route === "#/admin" || route === "#/match";
  LAST_HASH_BY_ROUTE[route] = fullHash;

  if (!shouldRender) return;

  try {
    // Only show a loading placeholder the first time a route is created
    if (firstTime) {
      container.innerHTML = `<div class="card"><div class="h1">Loading…</div><div class="small">Please wait.</div></div>`;
    }
    await ROUTES[route](container, query, token);

    // Mark rendered only if still current token
    if (getRouteToken() === token) container.dataset.rendered = "1";
  } catch (e) {
    console.error(e);
    container.innerHTML = `
      <div class="card">
        <div class="h1">Something went wrong</div>
        <div class="small">${String(e?.message || e)}</div>
      </div>
    `;
  }
}

window.addEventListener("hashchange", renderRoute);
window.addEventListener("mlfc:rerender-route", () => {
  const { path } = getPathQueryAndHash();
  if (ROUTES[path]) LAST_HASH_BY_ROUTE[path] = "";
  renderRoute();
});

export function startRouter() {
  if (!window.location.hash) window.location.hash = (getToken() ? "#/match" : "#/leaderboard");
  renderRoute();
}
