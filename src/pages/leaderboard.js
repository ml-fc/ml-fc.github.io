// src/pages/leaderboard.js
import { API } from "../api/endpoints.js";
import { toastError, toastSuccess, toastInfo } from "../ui/toast.js";
import { cleanupCaches } from "../cache_cleanup.js";
import { getRouteToken } from "../router.js";
import { lsGet, lsSet, lsDel } from "../storage.js";
import { isReloadFor } from "../nav_state.js";
import { refreshMe } from "../auth.js";

const LS_SELECTED_SEASON = "mlfc_selected_season_v1";
const LS_SEASONS_CACHE = "mlfc_seasons_cache_v1";
const LS_LB_PREFIX = "mlfc_leaderboard_v2:"; // + seasonId => {ts,data}

// Admin-only preference: show/hide ratings on leaderboard
const LS_SHOW_RATING = "mlfc_lb_show_rating_v1";

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

export async function renderLeaderboardPage(root, query, tokenFromRouter) {
  cleanupCaches();
  const token = tokenFromRouter || getRouteToken();

  // Leaderboard is public, but ratings are admin-only.
  const user = await refreshMe(false);
  const isAdmin = !!user?.isAdmin;
  let showRating = false;
  if (isAdmin) {
    showRating = localStorage.getItem(LS_SHOW_RATING) === "1";
  }

  let sortMode = showRating ? "rating" : "goals";

  const ratingToggleHtml = isAdmin ? `
    <label class="row" style="gap:10px; align-items:center; margin-top:12px">
      <input type="checkbox" id="toggleRating" ${showRating ? "checked" : ""} />
      <div class="small"><b>Show rating</b> <span style="opacity:.7">(admin only)</span></div>
    </label>
  ` : "";

  const sortRatingBtnHtml = (isAdmin && showRating) ? `<button class="btn gray" id="sortRating">Sort Rating</button>` : "";

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
              ${ (isAdmin && showRating) ? `
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
    msg.textContent = "No cached data. Tap Refresh (or refresh your browser).";
  }
  renderTable(root, rows, sortMode, isAdmin && showRating);

  root.querySelector("#seasonSelect").onchange = () => {
    seasonId = root.querySelector("#seasonSelect").value;
    localStorage.setItem(LS_SELECTED_SEASON, seasonId);

    const c = lsGet(lbKey(seasonId));
    rows = c?.data?.ok ? (c.data.rows || []) : [];
    msg.textContent = rows.length ? "Loaded from device cache." : "No cached data. Tap Refresh (or refresh your browser).";
    renderTable(root, rows, sortMode, isAdmin && showRating);
  };

  root.querySelector("#sortGoals").onclick = () => { sortMode = "goals"; renderTable(root, rows, sortMode, isAdmin && showRating); };
  root.querySelector("#sortAssists").onclick = () => { sortMode = "assists"; renderTable(root, rows, sortMode, isAdmin && showRating); };
  const sortRatingBtn = root.querySelector("#sortRating");
  if (sortRatingBtn) sortRatingBtn.onclick = () => { sortMode = "rating"; renderTable(root, rows, sortMode, isAdmin && showRating); };

  const toggle = root.querySelector("#toggleRating");
  if (toggle) {
    toggle.onchange = () => {
      showRating = !!toggle.checked;
      localStorage.setItem(LS_SHOW_RATING, showRating ? "1" : "0");
      // Re-render page quickly to update columns/buttons.
      renderLeaderboardPage(root, query, tokenFromRouter).catch(() => {});
    };
  }

  async function refreshLeaderboard() {
    const btn = root.querySelector("#refresh");
    btn.disabled = true; btn.textContent = "Refreshing…";
    msg.textContent = "Loading…";

    // Refresh should clear cache and then fetch fresh.
    lsDel(lbKey(seasonId));

    const res = await API.leaderboardSeason(seasonId);

    btn.disabled = false; btn.textContent = "Refresh";
    if (getRouteToken() !== token) return;

    if (!res.ok) {
      msg.textContent = res.error || "Failed";
      return toastError(res.error || "Failed leaderboard");
    }

    lsSet(lbKey(seasonId), { ts: now(), data: res });
    rows = res.rows || [];
    renderTable(root, rows, sortMode, isAdmin && showRating);
    msg.textContent = "";
    toastSuccess("Leaderboard refreshed.");
  }

  root.querySelector("#refresh").onclick = refreshLeaderboard;

  // Auto-refresh only on browser reload (or first load with empty cache)
  if (isReloadFor("#/leaderboard") || !cached?.data?.ok) {
    // Run without blocking initial render
    refreshLeaderboard().catch(() => {});
  }
}