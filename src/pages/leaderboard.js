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
// v3 restores a 10-game qualification line while keeping the full roster visible.
const LS_MINIMUM_MATCHES = "mlfc_lb_minimum_matches_v3";
const DEFAULT_MINIMUM_MATCHES = 10;

const LB_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
const LB_REFRESH_COOLDOWN_MS = 20 * 1000;

let ACTIVE_LB = { root: null, seasonId: "", refresh: null };
let LB_AUTO_REFRESH_LISTENERS = false;
let LB_LAST_REFRESH_TS = 0;
let LB_REFRESH_INFLIGHT = false;

function now(){ return Date.now(); }
function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
}

function lbKey(seasonId){ return `${LS_LB_PREFIX}${seasonId}`; }

function savedMinimumMatches() {
  const value = Number.parseInt(localStorage.getItem(LS_MINIMUM_MATCHES) || "", 10);
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : DEFAULT_MINIMUM_MATCHES;
}

function playerMatches(row) {
  // Older cached/API rows only expose matchesRated. Prefer matchesPlayed as soon
  // as the leaderboard endpoint supplies the full appearance count.
  return Math.max(0, Number(row?.matchesPlayed ?? row?.matchesRated ?? 0) || 0);
}

function seasonSelectHtml(seasons, selectedId) {
  const opts = (seasons||[]).map(s =>
    `<option value="${s.seasonId}" ${s.seasonId===selectedId?"selected":""}>${s.name}</option>`
  ).join("");
  return `
    <div class="row" style="gap:10px; align-items:center; margin-top:10px">
      <label class="field__label" for="seasonSelect" style="min-width:64px">Season</label>
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
  else if (mode === "potm") r.sort((a,b)=>(b.potmAwards||0)-(a.potmAwards||0) || (b.goals||0)-(a.goals||0));
  else if (showRating) r.sort((a,b)=>(b.avgRating||0)-(a.avgRating||0));
  else r.sort((a,b)=>(b.goals||0)-(a.goals||0));
  return r;
}

function renderTable(root, rows, sortMode, showRating, minimumMatches, searchQuery = "") {
  const body = root.querySelector("#lbBody");
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleRows = (rows || []).filter(row => !normalizedQuery || String(row?.playerName || "").toLocaleLowerCase().includes(normalizedQuery));
  const eligibleRows = visibleRows.filter(row => playerMatches(row) >= minimumMatches);
  const remainingRows = minimumMatches > 0 ? visibleRows.filter(row => playerMatches(row) < minimumMatches) : [];
  const sortedEligible = sortRows(eligibleRows, sortMode, showRating);
  const sortedRemaining = sortRows(remainingRows, sortMode, showRating);

  const cols = showRating ? 6 : 5;
  const maxGoals = Math.max(0, ...eligibleRows.map(x => Number(x.goals || 0)));
  const maxAssists = Math.max(0, ...eligibleRows.map(x => Number(x.assists || 0)));
  const ratedRows = eligibleRows.filter(x => Number(x.matchesRated || 0) > 0);
  const maxRating = Math.max(0, ...ratedRows.map(x => Number(x.avgRating || 0)));
  const playerRow = (x, rank, isEligible) => {
    const awards = [
      isEligible && maxGoals > 0 && Number(x.goals || 0) === maxGoals ? `<span class="playerAward playerAward--boot" title="Golden Boot — top scorer" aria-label="Golden Boot — top scorer">●</span>` : "",
      isEligible && maxAssists > 0 && Number(x.assists || 0) === maxAssists ? `<span class="playerAward" title="Top assists" aria-label="Top assists">🎯</span>` : "",
      isEligible && Number(x.matchesRated || 0) > 0 && Number(x.avgRating || 0) === maxRating ? `<span class="playerAward" title="Top rated" aria-label="Top rated">⭐</span>` : "",
      Number(x.potmAwards || 0) > 0 ? `<span class="playerAward" title="${Number(x.potmAwards)} Player of the Match award${Number(x.potmAwards) === 1 ? "" : "s"}" aria-label="Player of the Match awards">🏆</span>` : "",
    ].join("");
    const ratingCols = showRating ? `
      <td class="lb__cell lb__num lb__rating"><strong>${Number(x.matchesRated || 0) ? Number(x.avgRating || 0).toFixed(2) : "—"}</strong><small>${Number(x.matchesRated || 0)} rated</small></td>
    ` : "";
    return `
      <tr class="lb__row${isEligible ? "" : " lb__row--remaining"}">
        <td class="lb__cell lb__rank">${isEligible ? `<span>${rank}</span>` : `<span aria-label="Not yet ranked">—</span>`}</td>
        <td class="lb__cell lb__player"><div class="lb__playerIdentity"><button class="playerLink" data-player="${encodeURIComponent(x.playerName)}" title="View ${esc(x.playerName)} season history">${esc(x.playerName)}</button><span class="playerAwards">${awards}</span></div><small>${playerMatches(x)} ${playerMatches(x) === 1 ? "game" : "games"}</small></td>
        <td class="lb__cell lb__num">${x.goals || 0}</td>
        <td class="lb__cell lb__num">${x.assists || 0}</td>
        <td class="lb__cell lb__num">${x.potmAwards || 0}</td>
        ${ratingCols}
      </tr>
    `;
  };
  const rankedHtml = sortedEligible.map((row, index) => playerRow(row, index + 1, true)).join("");
  const remainingHtml = sortedRemaining.length ? `<tr class="lb__divider"><td colspan="${cols}"><div><span>Below ${minimumMatches} games</span><b>${sortedRemaining.length} remaining</b></div></td></tr>${sortedRemaining.map(row => playerRow(row, "", false)).join("")}` : "";
  body.innerHTML = rankedHtml + remainingHtml || `<tr><td colspan="${cols}" class="lb__empty">${normalizedQuery ? `No players match “${esc(searchQuery.trim())}”.` : "No players have been recorded this season."}</td></tr>`;

  const summary = root.querySelector("#eligibilitySummary");
  if (summary) {
    summary.textContent = normalizedQuery
      ? `${visibleRows.length} ${(visibleRows.length === 1 ? "player" : "players")} found`
      : minimumMatches
      ? `${eligibleRows.length} ranked · ${(rows || []).length} players total`
      : `${(rows || []).length} ${(rows || []).length === 1 ? "player" : "players"} · full season roster`;
  }
}

function renderPlayerHistory(dialog, data) {
  const matches = data.matches || [];
  const goals = matches.reduce((n, m) => n + Number(m.goals || 0), 0);
  const assists = matches.reduce((n, m) => n + Number(m.assists || 0), 0);
  const rated = matches.filter(m => m.rating != null && Number(m.ratingCount || 0) > 0);
  const avg = rated.length ? rated.reduce((n, m) => n + Number(m.rating || 0), 0) / rated.length : null;
  dialog.innerHTML = `
    <div class="playerSheet">
      <div class="playerSheet__head"><div><div class="small">Season player card</div><div class="h1">${esc(data.playerName)}</div></div><button class="btn gray" data-close-history aria-label="Close player history">Close</button></div>
      <div class="playerSummary">
        <div><b>${matches.length}</b><span>Played</span></div><div><b>${goals}</b><span>Goals</span></div><div><b>${assists}</b><span>Assists</span></div><div><b>${matches.reduce((n,m)=>n+Number(m.potmAward||0),0)}</b><span>POTM</span></div><div><b>${avg == null ? "—" : avg.toFixed(2)}</b><span>Rating</span></div>
      </div>
      <div class="playerMatchList">${matches.map(m => {
        const score = String(m.scoreHome ?? "").trim() !== "" && String(m.scoreAway ?? "").trim() !== "" ? `${esc(m.scoreHome)}–${esc(m.scoreAway)}` : "—";
        return `<div class="playerMatch"><div><b>${esc(m.title || "Match")}${Number(m.potmAward) ? " 🏆" : ""}</b><span>${esc(m.date || "")} · ${esc(m.team || m.type || "")}</span></div><div class="playerMatch__score">${score}</div><div class="playerMatch__stats"><span>${Number(m.goals || 0)} G</span><span>${Number(m.assists || 0)} A</span><span>${m.rating == null ? "—" : Number(m.rating).toFixed(1)} R</span><span>${Number(m.potmVotes || 0)} votes</span></div></div>`;
      }).join("") || `<div class="emptyState"><b>No matches yet</b><span>This player has no recorded season history.</span></div>`}</div>
    </div>`;
  dialog.querySelector("[data-close-history]").onclick = () => dialog.close();
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
  let minimumMatches = savedMinimumMatches();
  let searchQuery = "";

  let sortMode = showRating ? "rating" : "goals";

  const ratingToggleHtml = `<label class="ladderToggle"><input type="checkbox" id="toggleRating" ${showRating ? "checked" : ""} /><span>Ratings</span></label>`;

  const sortRatingBtnHtml = showRating ? `<button class="btn gray" id="sortRating">Rating</button>` : "";

  root.innerHTML = `
    <div class="card ladderControls">
      <div class="ladderControls__head"><div><div class="stepEyebrow">Season competition</div><div class="h1">Ladder</div></div><button class="btn gray ladderRefresh" id="refresh" aria-label="Refresh ladder">↻ <span>Refresh</span></button></div>
      <div class="ladderControls__season" id="seasonBlock"></div>
      <div class="ladderFilterBar">
        <div class="ladderSearch"><label class="visuallyHidden" for="playerSearch">Search players</label><span aria-hidden="true">⌕</span><input class="input" id="playerSearch" type="search" placeholder="Search players" autocomplete="off" /></div>
        <label class="ladderMinimum" for="minimumMatches"><span class="visuallyHidden">Minimum games to rank</span><select class="input" id="minimumMatches" name="minimumMatches" aria-describedby="minimumMatchesHelp"><option value="0" ${minimumMatches === 0 ? "selected" : ""}>All</option><option value="1" ${minimumMatches === 1 ? "selected" : ""}>1+ games</option><option value="3" ${minimumMatches === 3 ? "selected" : ""}>3+ games</option><option value="5" ${minimumMatches === 5 ? "selected" : ""}>5+ games</option><option value="10" ${minimumMatches === 10 ? "selected" : ""}>10+ games</option></select></label>
        <div class="ladderMetrics">
          <div class="ladderSort" role="group" aria-label="Sort ladder">
            <button class="btn gray" id="sortGoals">Goals</button>
            <button class="btn gray" id="sortAssists">Assists</button>
            <button class="btn gray" id="sortPotm">POTM</button>
            ${sortRatingBtnHtml}
          </div>
          ${ratingToggleHtml}
        </div>
      </div>
      <span class="visuallyHidden" id="minimumMatchesHelp">Players who meet this minimum are ranked first. Everyone else remains visible below the qualification line.</span>
      <div class="small" id="msg" style="margin-top:8px"></div>
    </div>

    <div class="card ladderBoard">
      <div class="ladderBoard__head"><div><div class="stepEyebrow">Player standings</div><div class="h1">Season leaders</div></div><div class="ladderBoard__count" id="eligibilitySummary" aria-live="polite"></div></div>
      <div class="lb__tableWrap">
        <table class="lb__table">
          <thead>
            <tr>
              <th class="lb__th lb__rank">#</th>
              <th class="lb__th lb__player">Player</th>
              <th class="lb__th lb__num">G</th>
              <th class="lb__th lb__num">A</th>
              <th class="lb__th lb__num">POTM</th>
              ${ showRating ? `
                <th class="lb__th lb__num">Rating</th>
              ` : "" }
            </tr>
          </thead>
          <tbody id="lbBody"></tbody>
        </table>
      </div>
    </div>
    <dialog id="playerHistoryDialog" class="playerDialog" aria-label="Player season history"></dialog>
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
  const renderCurrentTable = () => renderTable(root, rows, sortMode, showRating, minimumMatches, searchQuery);
  renderCurrentTable();

  root.querySelector("#lbBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-player]");
    if (!button) return;
    const playerName = decodeURIComponent(button.dataset.player || "");
    const dialog = root.querySelector("#playerHistoryDialog");
    dialog.innerHTML = `<div class="playerSheet"><div class="h1">${esc(playerName)}</div><div class="small">Loading season history…</div></div>`;
    dialog.showModal();
    const out = await API.playerHistory(seasonId, playerName);
    if (!out?.ok) { dialog.close(); return toastError(out?.error || "Could not load player history"); }
    renderPlayerHistory(dialog, out);
  });

  async function refreshLeaderboard(opts = {}) {
    const silent = !!opts.silent;
    const force = !!opts.force;
    const notify = !!opts.notify;

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
      renderCurrentTable();
      msg.textContent = silent ? "Updated just now." : "";
      if (notify) toastSuccess("Leaderboard refreshed.");
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
    renderCurrentTable();

    ACTIVE_LB.seasonId = seasonId;
    if (!rows.length || shouldAutoRefreshLeaderboard(seasonId)) {
      refreshLeaderboard({ silent: true, force: true }).catch(() => {});
    }
  };

  root.querySelector("#sortGoals").onclick = () => { sortMode = "goals"; renderCurrentTable(); };
  root.querySelector("#sortAssists").onclick = () => { sortMode = "assists"; renderCurrentTable(); };
  root.querySelector("#sortPotm").onclick = () => { sortMode = "potm"; renderCurrentTable(); };
  const sortRatingBtn = root.querySelector("#sortRating");
  if (sortRatingBtn) sortRatingBtn.onclick = () => { sortMode = "rating"; renderCurrentTable(); };

  root.querySelector("#playerSearch").oninput = event => {
    searchQuery = event.target.value;
    renderCurrentTable();
  };

  const minimumMatchesInput = root.querySelector("#minimumMatches");
  minimumMatchesInput.onchange = () => {
    const nextValue = Number(minimumMatchesInput.value);
    minimumMatches = nextValue;
    localStorage.setItem(LS_MINIMUM_MATCHES, String(minimumMatches));
    renderCurrentTable();
  };

  const toggle = root.querySelector("#toggleRating");
  if (toggle) {
    toggle.onchange = () => {
      showRating = !!toggle.checked;
      localStorage.setItem(LS_SHOW_RATING, showRating ? "1" : "0");
      // Re-render page quickly to update columns/buttons.
      renderLeaderboardPage(root, query, tokenFromRouter).catch(() => {});
    };
  }

  root.querySelector("#refresh").onclick = () => refreshLeaderboard({ force: true, notify: true });

  // Auto-refresh on reload, empty cache, or stale cache.
  const shouldFetchNow = isReloadFor("#/leaderboard") || !cached?.data?.ok || shouldAutoRefreshLeaderboard(seasonId);
  if (shouldFetchNow) refreshLeaderboard({ silent: !isReloadFor("#/leaderboard"), force: true }).catch(() => {});
}
