// src/pages/leaderboard.js
import { API } from "../api/endpoints.js";
import { toastError, toastSuccess } from "../ui/toast.js";
import { cleanupCaches } from "../cache_cleanup.js";
import { getRouteToken } from "../router.js";
import { lsGet, lsSet, lsDel } from "../storage.js";
import { isReloadFor } from "../nav_state.js";
import { refreshMe } from "../auth.js";

const LS_SELECTED_SEASON = "mlfc_selected_season_v1";
const LS_SEASONS_CACHE = "mlfc_seasons_cache_v1";
const LS_LB_PREFIX = "mlfc_leaderboard_v2:"; // + seasonId => {ts,data}

// Preference: show/hide ratings on leaderboard
const LS_SHOW_RATING = "mlfc_lb_show_rating_v1";

const LB_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
const LB_REFRESH_COOLDOWN_MS = 20 * 1000;

let ACTIVE_LB = { root: null, seasonId: "", refresh: null };
let LB_AUTO_REFRESH_LISTENERS = false;
let LB_LAST_REFRESH_TS = 0;
let LB_REFRESH_INFLIGHT = false;

function now(){ return Date.now(); }

function lbKey(seasonId){ return `${LS_LB_PREFIX}${seasonId}`; }

function seasonSelectHtml(seasons, selectedId) {
  const opts = (seasons||[]).map(s =>
    `<option value="${s.seasonId}" ${s.seasonId===selectedId?"selected":""}>${s.name}</option>`
  ).join("");
  return `
    <div class="row" style="gap:10px; align-items:center; margin-top:10px">
      <div class="small" style="min-width:64px"><b>Season</b></div>
      <select class="input" id="seasonSelect" style="flex:1">${opts}</select>
    </div>
  `;
}

async function getSeasonsCached() {
  const cached = lsGet(LS_SEASONS_CACHE);
  if (cached?.data?.ok) return cached.data;
  const res = await API.seasons();
  if (res.ok) lsSet(LS_SEASONS_CACHE, { ts: now(), data: res });
  return res;
}

function pickSelectedSeason(seasonsRes) {
  const seasons = seasonsRes.seasons || [];
  const current = seasonsRes.currentSeasonId || "";
  let selected = localStorage.getItem(LS_SELECTED_SEASON) || "";
  if (!seasons.some(s => s.seasonId === selected)) selected = current || seasons[0]?.seasonId || "";
  if (selected) localStorage.setItem(LS_SELECTED_SEASON, selected);
  return { seasons, selected };
}

function sortRows(rows, mode, showRating) {
  const r = (rows||[]).slice();
  if (mode === "goals") r.sort((a,b)=>(b.goals||0)-(a.goals||0));
  else if (mode === "assists") r.sort((a,b)=>(b.assists||0)-(a.assists||0));
  else if (showRating) r.sort((a,b)=>(b.avgRating||0)-(a.avgRating||0));
  else r.sort((a,b)=>(b.goals||0)-(a.goals||0));
  return r;
}

function renderTable(root, rows, sortMode, showRating) {
  const body = root.querySelector("#lbBody");
  const sorted = sortRows(rows, sortMode, showRating);

  const cols = showRating ? 6 : 4;
  body.innerHTML = sorted.map((x, i) => {
    const ratingCols = showRating ? `
      <td class="lb__cell lb__num">${(x.avgRating || 0).toFixed(2)}</td>
      <td class="lb__cell lb__num small">${x.matchesRated || 0}</td>
    ` : "";
    return `
      <tr class="lb__row">
        <td class="lb__cell lb__rank">${i+1}</td>
        <td class="lb__cell lb__player" title="${x.playerName}">${x.playerName}</td>
        <td class="lb__cell lb__num">${x.goals || 0}</td>
        <td class="lb__cell lb__num">${x.assists || 0}</td>
        ${ratingCols}
      </tr>
    `;
  }).join("") || `<tr><td colspan="${cols}" class="small" style="padding:12px">No data.</td></tr>`;
}

function isLeaderboardRouteActive() {
  const hash = window.location.hash || "#/match";
  return hash.startsWith("#/leaderboard");
}

function shouldAutoRefreshLeaderboard(seasonId) {
  if (!isLeaderboardRouteActive()) return false;
  if (!seasonId) return false;
  const cache = lsGet(lbKey(seasonId));
  const age = now() - Number(cache?.ts || 0);
  return !cache?.data?.ok || age > LB_CACHE_MAX_AGE_MS;
}

function ensureLeaderboardAutoRefreshListeners() {
  if (LB_AUTO_REFRESH_LISTENERS) return;
  LB_AUTO_REFRESH_LISTENERS = true;

  const trigger = () => {
    if (!ACTIVE_LB.refresh || !ACTIVE_LB.seasonId) return;
    if (!shouldAutoRefreshLeaderboard(ACTIVE_LB.seasonId)) return;
    ACTIVE_LB.refresh({ silent: true, reason: "auto" }).catch(() => {});
  };

  window.addEventListener("hashchange", () => {
    if (isLeaderboardRouteActive()) trigger();
  });

  window.addEventListener("focus", trigger);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) trigger();
  });
}

export async function renderLeaderboardPage(root, query, tokenFromRouter) {
  cleanupCaches();
  const token = tokenFromRouter || getRouteToken();

  ensureLeaderboardAutoRefreshListeners();

  // Leaderboard is public, including ratings view.
  await refreshMe(false);
  let showRating = localStorage.getItem(LS_SHOW_RATING) === "1";

  let sortMode = showRating ? "rating" : "goals";

  const ratingToggleHtml = `
    <label class="row" style="gap:10px; align-items:center; margin-top:12px">
      <input type="checkbox" id="toggleRating" ${showRating ? "checked" : ""} />
      <div class="small"><b>Show rating</b></div>
    </label>
  `;

  const sortRatingBtnHtml = showRating ? `<button class="btn gray" id="sortRating">Sort Rating</button>` : "";

  root.innerHTML = `
    <div class="card">
      <div class="h1">Leaderboard</div>
      <div id="seasonBlock"></div>
      <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
        <button class="btn primary" id="refresh">Refresh</button>
      </div>
      ${ratingToggleHtml}
      <div class="small" id="msg" style="margin-top:8px"></div>

      <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
        <button class="btn gray" id="sortGoals">Sort Goals</button>
        <button class="btn gray" id="sortAssists">Sort Assists</button>
        ${sortRatingBtnHtml}
      </div>
    </div>

    <div class="card">
      <div class="h1">Season Stats</div>
      <div class="lb__tableWrap">
        <table class="lb__table">
          <thead>
            <tr style="background: rgba(11,18,32,0.04)">
              <th class="lb__th lb__rank">#</th>
              <th class="lb__th lb__player">Player</th>
              <th class="lb__th lb__num">G</th>
              <th class="lb__th lb__num">A</th>
              ${ showRating ? `
                <th class="lb__th lb__num">R</th>
                <th class="lb__th lb__num">Rated</th>
              ` : "" }
            </tr>
          </thead>
          <tbody id="lbBody"></tbody>
        </table>
      </div>
    </div>
  `;

  const msg = root.querySelector("#msg");

  // seasons cache-first
  const seasonsRes = await getSeasonsCached();
  if (getRouteToken() !== token) return;
  if (!seasonsRes.ok) {
    msg.textContent = seasonsRes.error || "Failed seasons";
    return toastError(seasonsRes.error || "Failed seasons");
  }
  const { seasons, selected } = pickSelectedSeason(seasonsRes);
  let seasonId = selected;
  root.querySelector("#seasonBlock").innerHTML = seasonSelectHtml(seasons, seasonId);

  let rows = [];
  const cached = lsGet(lbKey(seasonId));
  if (cached?.data?.ok) {
    rows = cached.data.rows || [];
    msg.textContent = "Loaded from device cache.";
  } else {
    msg.textContent = "No cached data. Refreshing latest…";
  }
  renderTable(root, rows, sortMode, showRating);

  async function refreshLeaderboard(opts = {}) {
    const silent = !!opts.silent;
    const force = !!opts.force;

    const t = now();
    if (LB_REFRESH_INFLIGHT) return;
    if (!force && t - LB_LAST_REFRESH_TS < LB_REFRESH_COOLDOWN_MS) return;
    LB_LAST_REFRESH_TS = t;

    const btn = root.querySelector("#refresh");
    if (!silent && btn) {
      btn.disabled = true;
      btn.textContent = "Refreshing…";
      msg.textContent = "Loading…";
    }

    LB_REFRESH_INFLIGHT = true;
    try {
      if (!silent) lsDel(lbKey(seasonId));

      const res = await API.leaderboardSeason(seasonId);
      if (getRouteToken() !== token) return;

      if (!res.ok) {
        if (!silent) {
          msg.textContent = res.error || "Failed";
          toastError(res.error || "Failed leaderboard");
        }
        return;
      }

      lsSet(lbKey(seasonId), { ts: now(), data: res });
      rows = res.rows || [];
      renderTable(root, rows, sortMode, showRating);
      msg.textContent = silent ? "Updated just now." : "";
      if (!silent) toastSuccess("Leaderboard refreshed.");
    } finally {
      LB_REFRESH_INFLIGHT = false;
      if (!silent && btn) {
        btn.disabled = false;
        btn.textContent = "Refresh";
      }
    }
  }

  ACTIVE_LB = { root, seasonId, refresh: refreshLeaderboard };

  root.querySelector("#seasonSelect").onchange = () => {
    seasonId = root.querySelector("#seasonSelect").value;
    localStorage.setItem(LS_SELECTED_SEASON, seasonId);

    const c = lsGet(lbKey(seasonId));
    rows = c?.data?.ok ? (c.data.rows || []) : [];
    msg.textContent = rows.length ? "Loaded from device cache." : "No cached data. Refreshing latest…";
    renderTable(root, rows, sortMode, showRating);

    ACTIVE_LB.seasonId = seasonId;
    if (!rows.length || shouldAutoRefreshLeaderboard(seasonId)) {
      refreshLeaderboard({ silent: true, force: true }).catch(() => {});
    }
  };

  root.querySelector("#sortGoals").onclick = () => { sortMode = "goals"; renderTable(root, rows, sortMode, showRating); };
  root.querySelector("#sortAssists").onclick = () => { sortMode = "assists"; renderTable(root, rows, sortMode, showRating); };
  const sortRatingBtn = root.querySelector("#sortRating");
  if (sortRatingBtn) sortRatingBtn.onclick = () => { sortMode = "rating"; renderTable(root, rows, sortMode, showRating); };

  const toggle = root.querySelector("#toggleRating");
  if (toggle) {
    toggle.onchange = () => {
      showRating = !!toggle.checked;
      localStorage.setItem(LS_SHOW_RATING, showRating ? "1" : "0");
      // Re-render page quickly to update columns/buttons.
      renderLeaderboardPage(root, query, tokenFromRouter).catch(() => {});
    };
  }

  root.querySelector("#refresh").onclick = () => refreshLeaderboard({ force: true });

  // Auto-refresh on reload, empty cache, or stale cache.
  const shouldFetchNow = isReloadFor("#/leaderboard") || !cached?.data?.ok || shouldAutoRefreshLeaderboard(seasonId);
  if (shouldFetchNow) refreshLeaderboard({ silent: !isReloadFor("#/leaderboard"), force: true }).catch(() => {});
}
