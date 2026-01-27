// src/pages/admin.js
import { API } from "../api/endpoints.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { cleanupCaches } from "../cache_cleanup.js";
import { isReloadForAdminList, isReloadForAdminMatchCode, isReloadFor } from "../nav_state.js";
import { clearAuth, updateNavForUser, getCachedUser, getToken, refreshMe } from "../auth.js";

const LS_ADMIN_KEY = "mlfc_adminKey";
const LS_SELECTED_SEASON = "mlfc_selected_season_v1";
const LS_SEASONS_CACHE = "mlfc_seasons_cache_v1"; // {ts, data}

const LS_ADMIN_MATCHES_PREFIX = "mlfc_admin_matches_cache_v3:"; // + seasonId => {ts, matches}
const LS_MANAGE_CACHE_PREFIX = "mlfc_admin_manage_cache_v3:";   // + code => {ts, data}
const LS_MATCH_DETAIL_PREFIX = "mlfc_match_detail_cache_v2:";   // shared with match page
const LS_USERS_CACHE = "mlfc_admin_users_cache_v1"; // {ts, users}
   // shared with match page

const SEASONS_TTL_MS = 60 * 10000;

let MEM = {
  adminKey: null,
  seasons: [],
  selectedSeasonId: "",
  matches: [],
  editSeasonId: "",
};

function now() { return Date.now(); }
function currentHashPath() { return (location.hash || "#/match").split("?")[0]; }
function currentHashQuery() { return new URLSearchParams(location.hash.split("?")[1] || ""); }
function stillOnAdmin(routeToken) {
  return currentHashPath() === "#/admin" && window.__mlfcAdminToken === routeToken;
}

function baseUrl() { return location.href.split("#")[0]; }
function matchLink(publicCode) { return `${baseUrl()}#/match?code=${publicCode}`; }
function captainLink(publicCode) {
  // IMPORTANT: when opened from the Admin UI, pass src=admin so the Captain page
  // runs in admin mode (admin can submit both scores + rate any player).
  return `${baseUrl()}#/captain?code=${publicCode}&src=admin`;
}
function waOpenPrefill(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function lsGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function lsDel(key) { try { localStorage.removeItem(key); } catch {} }

function matchesKey(seasonId) { return `${LS_ADMIN_MATCHES_PREFIX}${seasonId}`; }
function manageKey(code) { return `${LS_MANAGE_CACHE_PREFIX}${code}`; }

function setDisabled(btn, disabled, busyText) {
  if (!btn) return;
  btn.disabled = disabled;
  if (busyText) {
    if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
    btn.textContent = disabled ? busyText : btn.dataset.origText;
  }
}


async function getUsersCached(force = false) {
  const cached = lsGet(LS_USERS_CACHE);
  if (!force && cached?.users) return cached.users;
  const res = await API.adminUsers();
  if (!res?.ok) throw new Error(res?.error || "Failed to load users");
  const users = res.users || [];
  lsSet(LS_USERS_CACHE, { ts: Date.now(), users });
  return users;
}

function uniqueSorted(arr) {
  return [...new Set(arr)].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function clearPublicMatchDetailCache(publicCode) {
  try {
    if (publicCode) localStorage.removeItem(`${LS_MATCH_DETAIL_PREFIX}${publicCode}`);
  } catch {}
}
function clearManageCache(publicCode) {
  try {
    if (publicCode) localStorage.removeItem(manageKey(publicCode));
  } catch {}
}
function clearAdminMatchesCache(seasonId) {
  try {
    if (seasonId) localStorage.removeItem(matchesKey(seasonId));
  } catch {}
}

// Robust human formatter (prevents invalid display if browser parsing differs)
function formatHumanDateTime(dateStr, timeStr) {
  const d = String(dateStr || "").trim();
  const t = String(timeStr || "").trim();
  if (!d || !t) return `${d || "Unknown date"} ${t || ""}`.trim();

  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  const hhmm = m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : t;

  const dt = new Date(`${d}T${hhmm}:00`);
  if (Number.isNaN(dt.getTime())) return `${d} ${hhmm}`;

  return dt.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getViewParams(query) {
  // views:
  // - open (default)
  // - past
  // - manage (requires code)
  const view = (query.get("view") || "open").toLowerCase();
  const code = query.get("code") || "";
  const prev = (query.get("prev") || "open").toLowerCase();
  return { view, code, prev };
}

async function loadSeasonsCached(routeToken) {
  const cached = lsGet(LS_SEASONS_CACHE);
  if (cached?.data?.ok && (now() - (cached.ts || 0)) <= SEASONS_TTL_MS) return cached.data;

  const res = await API.seasons();
  if (!stillOnAdmin(routeToken)) return { ok: false, error: "Route changed" };
  if (res.ok) lsSet(LS_SEASONS_CACHE, { ts: now(), data: res });
  return res;
}

function pickSelectedSeason(seasonsRes) {
  const seasons = seasonsRes.seasons || [];
  const current = seasonsRes.currentSeasonId || "";

  let selected = localStorage.getItem(LS_SELECTED_SEASON) || "";
  if (!seasons.some(s => s.seasonId === selected)) selected = current || seasons[0]?.seasonId || "";
  if (selected) localStorage.setItem(LS_SELECTED_SEASON, selected);

  return { seasons, selected, current };
}

function seasonsSelectHtml(seasons, selected) {
  const opts = (seasons || []).map(s =>
    `<option value="${s.seasonId}" ${s.seasonId === selected ? "selected" : ""}>${s.name}</option>`
  ).join("");
  return `
    <div class="row" style="gap:10px; align-items:center; margin-top:10px">
      <div class="small" style="min-width:64px"><b>Season</b></div>
      <select class="input" id="seasonSelect" style="flex:1">${opts}</select>
    </div>
  `;
}

// Only called when user presses Refresh (no auto calls)
async function refreshMatchesFromApi(seasonId, routeToken) {
  const res = await API.adminListMatches(seasonId);
  if (!stillOnAdmin(routeToken)) return { ok: false, error: "Route changed" };
  if (!res.ok) return res;

  MEM.matches = res.matches || [];
  lsSet(matchesKey(seasonId), { ts: now(), matches: MEM.matches });
  return { ok: true, matches: MEM.matches };
}

// Cache-first load (no API)
function loadMatchesFromLocal(seasonId) {
  const cached = lsGet(matchesKey(seasonId));
  if (cached?.matches && Array.isArray(cached.matches)) {
    MEM.matches = cached.matches;
    return true;
  }
  MEM.matches = [];
  return false;
}

function renderLogin(root) {
  root.innerHTML = `
    <details class="card" open>
      <summary style="font-weight:950">Admin Login</summary>
      <div class="small" style="margin-top:8px">Enter admin key once. It will be remembered on this device.</div>
      <input id="key" class="input" placeholder="Admin key" style="margin-top:10px" />
      <div class="row" style="margin-top:10px">
        <button id="login" class="btn primary">Login</button>
        <button id="clear" class="btn gray">Clear key</button>
      </div>
      <div id="msg" class="small" style="margin-top:10px"></div>
    </details>
  `;

  const keyEl = root.querySelector("#key");
  const msgEl = root.querySelector("#msg");
  keyEl.value = localStorage.getItem(LS_ADMIN_KEY) || "";

  root.querySelector("#clear").onclick = () => {
    localStorage.removeItem(LS_ADMIN_KEY);
    toastInfo("Admin key cleared.");
    msgEl.textContent = "Cleared.";
  };

  root.querySelector("#login").onclick = async () => {
    const adminKey = keyEl.value.trim();
    if (!adminKey) return toastWarn("Enter admin key");

    setDisabled(root.querySelector("#login"), true, "Logging…");
    msgEl.textContent = "Logging in…";

    const routeToken = (window.__mlfcAdminToken = String(Math.random()));
    const seasonsRes = await loadSeasonsCached(routeToken);

    setDisabled(root.querySelector("#login"), false);
    if (!seasonsRes.ok) {
      msgEl.textContent = seasonsRes.error || "Failed seasons";
      return toastError(seasonsRes.error || "Failed seasons");
    }

    const { seasons, selected } = pickSelectedSeason(seasonsRes);
    MEM.seasons = seasons;
    MEM.selectedSeasonId = selected;

    // Validate key by calling admin list once
    const res = await API.adminListMatches(adminKey, selected);
    if (!res.ok) {
      msgEl.textContent = res.error || "Unauthorized";
      return toastError(res.error || "Unauthorized");
    }

    localStorage.setItem(LS_ADMIN_KEY, adminKey);
    MEM.adminKey = adminKey;
    MEM.matches = res.matches || [];
    lsSet(matchesKey(selected), { ts: now(), matches: MEM.matches });

    toastSuccess("Logged in.");
    location.hash = "#/admin?view=open";
  };
}

function topNavHtml(view) {
  const openActive = view === "open" ? "primary" : "gray";
  const pastActive = view === "past" ? "primary" : "gray";
  const usersActive = view === "users" ? "primary" : "gray";
  return `
    <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
      <button class="btn ${openActive}" id="goOpen">Open matches</button>
      <button class="btn ${pastActive}" id="goPast">Past matches</button>
      <button class="btn ${usersActive}" id="goUsers">User management</button>
    </div>
  `;
}

function matchRowHtml(m, view) {
  const status = String(m.status || "").toUpperCase();
  const locked = String(m.ratingsLocked || "").toUpperCase() === "TRUE";
  const isCompleted = status === "COMPLETED";
  const isEditLocked = locked || status === "CLOSED" || isCompleted;

  // If locked/completed: disable Manage + Lock ratings
  const disableManage = isEditLocked;
  const disableLock = locked || isCompleted;

  const when = formatHumanDateTime(m.date, m.time);

  return `
    <div style="padding:10px 0; border-bottom:1px solid #eee">
      <div class="row" style="justify-content:space-between">
        <div style="min-width:0">
          <div style="font-weight:950; color: rgba(11,18,32,0.92)">${m.title}</div>
          <div class="small">${when} • ${m.type}</div>
        </div>
        <div class="row" style="gap:6px">
          <span class="badge">${m.status}</span>
          ${locked ? `<span class="badge badge--bad">LOCKED</span>` : ""}
        </div>
      </div>

      <div class="row" style="margin-top:8px; flex-wrap:wrap">
        <button class="btn gray" data-manage="${m.publicCode}" ${disableManage ? "disabled" : ""}>Manage</button>
        <button class="btn gray" data-lock="${m.matchId}" ${disableLock ? "disabled" : ""}>Lock ratings</button>
        ${isEditLocked ? `<button class="btn gray" data-unlock="${m.matchId}">Unlock match</button>` : ""}
        <button class="btn bad" data-delete-match="${m.matchId}" style="margin-left:auto">Delete</button>
      </div>
    </div>
  `;
}

function renderAdminShell(root, view) {
  root.innerHTML = `
    <div class="card" id="adminHeaderCard">
      <div class="h1">Admin</div>
      <div class="small">Season selection is shared across all tabs.</div>

      <div id="seasonBlock"></div>

      ${topNavHtml(view)}

      <div class="small" id="msg" style="margin-top:10px"></div>

      <!-- iOS PWA ("Add to Home Screen") does not always fire a true browser reload.
           Provide an explicit refresh button so admins can fetch latest server data reliably. -->
      <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
        <button class="btn gray" id="refreshAdminMatches">Refresh matches</button>
        <button class="btn gray" style="display:none;" id="clearAdminCache">Clear cache</button>
      </div>
    </div>

    <details class="card" id="seasonMgmt">
      <summary style="font-weight:950">Season management</summary>

      <div class="small" style="margin-top:8px">
        Create seasons like: <b>24 Winter</b>, <b>24-25 Summer</b>, <b>25 Winter</b>, <b>25-26 Summer</b>.
      </div>

      <input id="seasonName" class="input" placeholder="Season name (e.g., 25-26 Summer)" style="margin-top:10px" />
      <div class="row" style="margin-top:10px">
        <input id="seasonStart" class="input" type="date" style="flex:1" />
        <input id="seasonEnd" class="input" type="date" style="flex:1" />
      </div>
      <div class="row" style="margin-top:10px">
        <select id="seasonStatus" class="input" style="flex:1">
          <option value="OPEN" selected>OPEN</option>
          <option value="CLOSED">CLOSED</option>
        </select>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="createSeason">Create season</button>
        <button class="btn primary" id="updateSeason" style="display:none">Update season</button>
        <button class="btn gray" id="cancelSeasonEdit" style="display:none">Cancel</button>
      </div>

      <div class="hr"></div>
      <div class="h1">Seasons</div>
      <div id="seasonList" class="small" style="margin-top:8px"></div>
    </details>

    <details class="card" id="createMatchCard" open>
      <summary style="font-weight:950">Create match</summary>

      <input id="title" class="input" placeholder="Title" style="margin-top:10px" />
      <input id="date" class="input" type="date" style="margin-top:10px" />
      <input id="time" class="input" type="time" value="19:00" style="margin-top:10px" />
      <select id="type" class="input" style="margin-top:10px">
        <option value="INTERNAL" selected>Internal (Blue vs Orange)</option>
        <option value="OPPONENT">Against opponents (1 captain)</option>
      </select>

      <button id="createMatch" class="btn primary" style="margin-top:10px">Create</button>
      <div id="created" class="small" style="margin-top:10px"></div>
    </details>

    <div id="usersArea"></div>

    <div id="listArea"></div>
    <div id="manageArea"></div>
  `;

  // Requested: Season management collapsed by default
  root.querySelector("#seasonMgmt").open = false;
  // users render only in Users view
}

function setAdminChromeVisible(root, visible) {
  const display = visible ? "" : "none";
  const header = root.querySelector("#adminHeaderCard");
  const seasonMgmt = root.querySelector("#seasonMgmt");
  const createMatch = root.querySelector("#createMatchCard");
  if (header) header.style.display = display;
  if (seasonMgmt) seasonMgmt.style.display = display;
  if (createMatch) createMatch.style.display = display;
}

function renderListView(root, view) {
  const listArea = root.querySelector("#listArea");
  const manageArea = root.querySelector("#manageArea");

  // When list view is visible, show admin chrome
  setAdminChromeVisible(root, true);

  // Show list, hide manage (destroy manage DOM so Back returns to a clean full view)
  listArea.style.display = "block";
  manageArea.style.display = "none";
  manageArea.innerHTML = "";

  const open = (MEM.matches || []).filter(m => String(m.status || "").toUpperCase() === "OPEN");
  const past = (MEM.matches || []).filter(m => String(m.status || "").toUpperCase() !== "OPEN");

  listArea.innerHTML = `
    <div class="card">
      <div class="h1">${view === "past" ? "Past matches" : "Open matches"}</div>
      <div id="matchesList" style="margin-top:10px">
        ${
          (view === "past" ? past : open).length
            ? (view === "past" ? past : open).map(m => matchRowHtml(m, view)).join("")
            : `<div class="small">No matches.</div>`
        }
      </div>
    </div>
  `;

  bindListButtons(root, view);
}

async function openManageView(root, code, routeToken, prevView) {
  const listArea = root.querySelector("#listArea");
  const manageArea = root.querySelector("#manageArea");

  // In manage view, hide admin header / season mgmt / create match so only match management shows.
  setAdminChromeVisible(root, false);

  // Hide list, show manage (do not destroy list DOM)
  listArea.style.display = "none";
  manageArea.style.display = "block";

  // Render from cache instantly if present
  const cached = lsGet(manageKey(code));
  if (cached?.data?.ok) {
    renderManageUI(root, cached.data, routeToken, { fromCache: true, prevView });

    // Per requirement: reload match details from API only on a browser refresh.
    if (isReloadForAdminMatchCode(code)) {
      API.getPublicMatch(code)
        .then(fresh => {
          if (!stillOnAdmin(routeToken)) return;
          if (!fresh?.ok) return;
          lsSet(manageKey(code), { ts: now(), data: fresh });
          renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
        })
        .catch(() => {});
    }

    return;
  }

  // No cache: show loading, then fetch ONCE
  manageArea.innerHTML = `<div class="card"><div class="h1">Loading match…</div><div class="small">Fetching details…</div></div>`;

  const fresh = await API.getPublicMatch(code);
  if (!stillOnAdmin(routeToken)) return;
  if (!fresh.ok) {
    manageArea.innerHTML = `<div class="card"><div class="h1">Error</div><div class="small">${fresh.error}</div></div>`;
    return toastError(fresh.error || "Failed to load match");
  }
  lsSet(manageKey(code), { ts: now(), data: fresh });
  renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
}

function bindTopNav(root, routeToken) {
  // Some admin views intentionally hide the top-nav buttons. Guard against missing DOM.
  const goOpen = root.querySelector("#goOpen");
  if (goOpen) {
    goOpen.onclick = () => {
      if (!stillOnAdmin(routeToken)) return;
      location.hash = "#/admin?view=open";
    };
  }

  const goPast = root.querySelector("#goPast");
  if (goPast) {
    goPast.onclick = () => {
      if (!stillOnAdmin(routeToken)) return;
      location.hash = "#/admin?view=past";
    };
  }

  const u = root.querySelector("#goUsers");
  if (u) u.onclick = () => {
    if (!stillOnAdmin(routeToken)) return;
    location.hash = "#/admin?view=users";
  };
}

function bindSeasonSelector(root, routeToken) {
  root.querySelector("#seasonBlock").innerHTML = seasonsSelectHtml(MEM.seasons, MEM.selectedSeasonId);
  const select = root.querySelector("#seasonSelect");

  select.onchange = () => {
    if (!stillOnAdmin(routeToken)) return;

    MEM.selectedSeasonId = select.value;
    localStorage.setItem(LS_SELECTED_SEASON, MEM.selectedSeasonId);

    // cache-first load matches for season (no API)
    loadMatchesFromLocal(MEM.selectedSeasonId);

    const { view } = getViewParams(currentHashQuery());

    // If in manage and season changes, go back to open list for new season
    if (view === "manage") {
      location.hash = "#/admin?view=open";
    } else {
      renderListView(root, view);
    }
  };
}

function bindSeasonMgmt(root, routeToken) {
  const listEl = root.querySelector("#seasonList");
  const nameEl = root.querySelector("#seasonName");
  const startEl = root.querySelector("#seasonStart");
  const endEl = root.querySelector("#seasonEnd");
  const statusEl = root.querySelector("#seasonStatus");
  const createBtn = root.querySelector("#createSeason");
  const updateBtn = root.querySelector("#updateSeason");
  const cancelBtn = root.querySelector("#cancelSeasonEdit");

  function setMode(editSeasonId = "") {
    MEM.editSeasonId = editSeasonId;
    const editing = Boolean(editSeasonId);
    createBtn.style.display = editing ? "none" : "";
    updateBtn.style.display = editing ? "" : "none";
    cancelBtn.style.display = editing ? "" : "none";
    if (!editing) {
      nameEl.value = "";
      startEl.value = "";
      endEl.value = "";
      statusEl.value = "OPEN";
    }
  }

  function renderList() {
    const seasons = MEM.seasons || [];
    if (!seasons.length) {
      listEl.innerHTML = "No seasons yet.";
      return;
    }

    listEl.innerHTML = seasons
      .map((s) => {
        const isCurrent = s.seasonId === (MEM.selectedSeasonId || "");
        const badge = s.status === "OPEN" ? "badge" : "badge badge--bad";
        return `
          <div class="card" style="margin:8px 0; padding:10px">
            <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap">
              <div>
                <div style="font-weight:950">${s.name} ${isCurrent ? "<span class=\"badge\">Selected</span>" : ""}</div>
                <div class="small" style="margin-top:4px">
                  <span class="${badge}">${s.status}</span>
                  <span style="margin-left:8px">${s.startDate} → ${s.endDate}</span>
                </div>
              </div>
              <div class="row" style="gap:8px; flex-wrap:wrap">
                <button class="btn gray" data-season-edit="${s.seasonId}">Edit</button>
                <button class="btn gray" data-season-del="${s.seasonId}">Delete</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // bind edit/delete
    listEl.querySelectorAll("[data-season-edit]").forEach((btn) => {
      btn.onclick = () => {
        if (!stillOnAdmin(routeToken)) return;
        const id = btn.getAttribute("data-season-edit") || "";
        const s = (MEM.seasons || []).find((x) => x.seasonId === id);
        if (!s) return;
        nameEl.value = s.name || "";
        startEl.value = s.startDate || "";
        endEl.value = s.endDate || "";
        statusEl.value = (s.status || "OPEN").toUpperCase();
        setMode(id);
        root.querySelector("#seasonMgmt").open = true;
      };
    });
    listEl.querySelectorAll("[data-season-del]").forEach((btn) => {
      btn.onclick = async () => {
        if (!stillOnAdmin(routeToken)) return;
        const id = btn.getAttribute("data-season-del") || "";
        const s = (MEM.seasons || []).find((x) => x.seasonId === id);
        if (!s) return;
        if (!confirm(`Delete season '${s.name}'? This will delete all matches in that season.`)) return;

        setDisabled(btn, true, "Deleting…");
        const out = await API.adminDeleteSeason(id);
        setDisabled(btn, false);
        if (!out.ok) return toastError(out.error || "Failed to delete season");
        toastSuccess("Season deleted.");

        // Reload seasons list (cache bust)
        lsDel(LS_SEASONS_CACHE);
        const seasonsRes = await loadSeasonsCached(routeToken);
        if (!stillOnAdmin(routeToken)) return;
        if (!seasonsRes.ok) return toastError(seasonsRes.error || "Failed to reload seasons");

        const picked = pickSelectedSeason(seasonsRes);
        MEM.seasons = picked.seasons;
        MEM.selectedSeasonId = picked.selected;
        localStorage.setItem(LS_SELECTED_SEASON, MEM.selectedSeasonId);

        // Clear caches for the now-selected season
        clearAdminMatchesCache(MEM.selectedSeasonId);
        loadMatchesFromLocal(MEM.selectedSeasonId);

        bindSeasonSelector(root, routeToken);
        setMode("");
        renderList();
        renderListView(root, "open");
      };
    });
  }

  renderList();

  cancelBtn.onclick = () => {
    if (!stillOnAdmin(routeToken)) return;
    setMode("");
  };

  createBtn.onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;

    const btn = createBtn;
    const name = String(nameEl.value || "").trim();
    const startDate = String(startEl.value || "").trim();
    const endDate = String(endEl.value || "").trim();
    if (!name || !startDate || !endDate) return toastWarn("Enter season name + start/end date.");

    setDisabled(btn, true, "Creating…");
    const out = await API.adminCreateSeason({ name, startDate, endDate });
    setDisabled(btn, false);

    if (!out.ok) return toastError(out.error || "Failed to create season");
    toastSuccess("Season created.");

    // Reload seasons list (cache bust)
    lsDel(LS_SEASONS_CACHE);
    const seasonsRes = await loadSeasonsCached(routeToken);
    if (!stillOnAdmin(routeToken)) return;
    if (!seasonsRes.ok) return toastError(seasonsRes.error || "Failed to reload seasons");

    const picked = pickSelectedSeason(seasonsRes);
    MEM.seasons = picked.seasons;

    // Server will pick latest season as current; pickSelectedSeason respects that
    MEM.selectedSeasonId = picked.selected;
    localStorage.setItem(LS_SELECTED_SEASON, MEM.selectedSeasonId);

    // No auto API for matches; clear old season cache so user chooses Refresh when needed
    clearAdminMatchesCache(MEM.selectedSeasonId);
    loadMatchesFromLocal(MEM.selectedSeasonId);

    bindSeasonSelector(root, routeToken);
    setMode("");
    renderList();

    // show open list from cache (likely empty until Refresh)
    renderListView(root, "open");
  };

  updateBtn.onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;
    const seasonId = MEM.editSeasonId;
    if (!seasonId) return toastWarn("Choose a season to edit first.");

    const name = String(nameEl.value || "").trim();
    const startDate = String(startEl.value || "").trim();
    const endDate = String(endEl.value || "").trim();
    const status = String(statusEl.value || "OPEN").trim().toUpperCase();
    if (!name || !startDate || !endDate) return toastWarn("Enter season name + start/end date.");

    setDisabled(updateBtn, true, "Updating…");
    const out = await API.adminUpdateSeason({ seasonId, name, startDate, endDate, status });
    setDisabled(updateBtn, false);
    if (!out.ok) return toastError(out.error || "Failed to update season");
    toastSuccess("Season updated.");

    // Reload seasons list (cache bust)
    lsDel(LS_SEASONS_CACHE);
    const seasonsRes = await loadSeasonsCached(routeToken);
    if (!stillOnAdmin(routeToken)) return;
    if (!seasonsRes.ok) return toastError(seasonsRes.error || "Failed to reload seasons");

    const picked = pickSelectedSeason(seasonsRes);
    MEM.seasons = picked.seasons;
    // Keep selected season if still present
    MEM.selectedSeasonId = picked.selected;
    localStorage.setItem(LS_SELECTED_SEASON, MEM.selectedSeasonId);

    clearAdminMatchesCache(MEM.selectedSeasonId);
    loadMatchesFromLocal(MEM.selectedSeasonId);

    bindSeasonSelector(root, routeToken);
    setMode("");
    renderList();
    renderListView(root, "open");
  };
}

function bindCreateMatch(root, routeToken) {
  root.querySelector("#createMatch").onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;

    const btn = root.querySelector("#createMatch");
    setDisabled(btn, true, "Creating…");

    const payload = {
      title: root.querySelector("#title").value.trim() || "Weekly Match",
      date: root.querySelector("#date").value,
      time: root.querySelector("#time").value || "19:00",
      type: root.querySelector("#type").value,
      seasonId: MEM.selectedSeasonId
    };

    if (!payload.date) {
      setDisabled(btn, false);
      toastWarn("Please choose a match date");
      return;
    }

    const out = await API.adminCreateMatch(payload);
    setDisabled(btn, false);

    const created = root.querySelector("#created");
    if (!out.ok) {
      created.textContent = out.error || "Failed";
      return toastError(out.error || "Failed to create match");
    }

    toastSuccess("Match created.");

    // Requested: do NOT show URL here; just open the new match manage view
    created.textContent = "Created ✅ Opening match…";

    // Collapse create match section
    const details = root.querySelector("#createMatchCard");
    if (details) details.open = false;

    // Add new match into MEM + app storage immediately (NO API)
    const newMatch = {
      matchId: out.matchId,
      publicCode: out.publicCode,
      seasonId: out.seasonId || MEM.selectedSeasonId,
      title: payload.title,
      date: payload.date,
      time: payload.time,
      type: payload.type,
      status: "OPEN",
      ratingsLocked: "FALSE"
    };

    // Put new OPEN match at top
    MEM.matches = [newMatch, ...(MEM.matches || []).filter(m => String(m.matchId) !== String(newMatch.matchId))];
    lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

    // Clear any stale caches for this match code
    clearPublicMatchDetailCache(out.publicCode);
    clearManageCache(out.publicCode);

    // Navigate to manage view (prev=open)
    location.hash = `#/admin?view=manage&code=${encodeURIComponent(out.publicCode)}&prev=open`;
  };
}

function bindHeaderButtons(root, routeToken) {
  // Logout is handled from the Account page; admin chrome may not include a logout button.
  const logoutBtn = root.querySelector("#logout");
  // These buttons exist in the Admin header card.
  const refreshBtn = root.querySelector("#refreshAdminMatches");
  const clearBtn = root.querySelector("#clearAdminCache");

  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      const msg = root.querySelector("#msg");
      setDisabled(refreshBtn, true, "Refreshing…");
      if (msg) msg.textContent = "Loading latest…";
      const out = await refreshMatchesFromApi(MEM.selectedSeasonId, routeToken);
      setDisabled(refreshBtn, false);
      if (!stillOnAdmin(routeToken)) return;
      if (!out?.ok) {
        if (msg) msg.textContent = out?.error || "Failed to refresh";
        return toastError(out?.error || "Failed to refresh");
      }
      if (msg) msg.textContent = "";
      // Re-render current list view if we're on it.
      const { view } = getViewParams(currentHashQuery());
      if (view === "open" || view === "past") renderListView(root, view === "past" ? "past" : "open");
      toastSuccess("Refreshed.");
      setDisabled(refreshBtn, false, "Refresh Matches");
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      try {
        // Clear list cache for selected season + any cached manage/match details.
        clearAdminMatchesCache(MEM.selectedSeasonId);
        cleanupCaches();
      } catch {}
      toastInfo("Admin cache cleared.");
      const msg = root.querySelector("#msg");
      if (msg) msg.textContent = "Cache cleared. Tap Refresh matches to load from server.";
      MEM.matches = [];
      renderListView(root, "open");
    };
  }

  if (!logoutBtn) return;

  logoutBtn.onclick = () => {
    API.logout().catch(() => {});
    clearAuth();
    updateNavForUser(null);
    toastInfo("Logged out.");
    location.hash = "#/login";
  };
}

 async function renderUsers(root, opts = {}) {
  const area = root.querySelector("#usersArea");
  if (!area) return;
  // Any admin can change admin rights for other users.
  // The only restriction: an admin cannot remove their own admin access.
  // Backend enforces this; we mirror it here to avoid accidental lockouts.
  const me = getCachedUser() || (await refreshMe(false).catch(() => null));
  const canToggleAdmin = !!(me && me.isAdmin);
  const meNameLower = String(me?.name || "").trim().toLowerCase();
  const state = (window.__mlfcUsersState = window.__mlfcUsersState || { q: "", page: 1, pageSize: 20 });
  // Make sure Users view pulls latest at least once per page-load.
  // This also covers a browser refresh while already on the Users view.
  const firstLoadThisSession = !window.__mlfcUsersLoadedOnce;
  window.__mlfcUsersLoadedOnce = true;
  area.innerHTML = `<div class="small">Loading…</div>`;
  let users = [];
  try {
    // Users view should refresh from API on browser reload (so toggles from other devices show up).
    // Also allow callers to force refresh.
    const force = !!opts?.force || firstLoadThisSession || isReloadFor("#/admin");
    users = await getUsersCached(force);
  } catch (e) {
    area.innerHTML = `<div class="small">${String(e?.message||e)}</div>`;
    return;
  }
  const out = { ok: true, users };
  if (!out?.ok) {
    area.innerHTML = `<div class="small">${out?.error || "Failed to load users"}</div>`;
    return;
  }
   users = out.users || [];
  const q = String(state.q || "").trim().toLowerCase();
  const filtered = q ? users.filter(u => String(u.name||"").toLowerCase().includes(q) || String(u.phone||"").toLowerCase().includes(q)) : users;
  const total = filtered.length;
  const pageSize = Number(state.pageSize) || 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const showPager = pages > 1;

  area.innerHTML = `
    <div class="card" style="margin-top:0">
      <div class="row" style="gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between">
        <div style="min-width:240px; flex:1">
          <div class="small"><b>Search</b></div>
          <input id="userSearch" class="input" placeholder="Search by name/phone" value="${state.q || ""}" />
        </div>
        ${showPager ? `
          <div class="row" style="gap:10px; align-items:flex-end">
            <button class="btn gray" id="usersPrev" ${state.page<=1?"disabled":""}>Prev</button>
            <button class="btn gray" id="usersNext" ${state.page>=pages?"disabled":""}>Next</button>
          </div>
        ` : ``}
      </div>
      <div class="small" style="margin-top:8px">Showing ${pageItems.length} of ${total} users • Page ${state.page}/${pages}</div>
    </div>

    ${pageItems.length ? `
    <div style="overflow:auto">
      <table class="table" style="width:100%; border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left; padding:8px">Name</th>
            <th style="text-align:left; padding:8px">Phone</th>
            <th style="text-align:center; padding:8px">Admin</th>
            <th style="text-align:right; padding:8px">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pageItems.map(u => {
            const isSelf = meNameLower && String(u.name || "").trim().toLowerCase() === meNameLower;
            const toggleDisabled = !canToggleAdmin || isSelf;
            const toggleTitle = !canToggleAdmin
              ? "Only admins can change admin rights"
              : (isSelf ? "You cannot change your own admin access" : "Toggle admin");
            return `
            <tr style="border-top:1px solid rgba(11,18,32,0.08)">
              <td style="padding:8px; font-weight:950" data-label="Name">${u.name}</td>
              <td style="padding:8px" class="small" data-label="Phone">${u.phone || ""}</td>
              <td style="padding:8px; text-align:center" data-label="Admin">${Number(u.isAdmin)===1 ? "✅" : "—"}</td>
              <td style="padding:8px; text-align:right" data-label="Actions" class="usersActions">
                <button class="btn gray" data-toggle-admin="${encodeURIComponent(u.name)}" ${toggleDisabled ? "disabled" : ""} title="${toggleTitle}" style="padding:8px 10px; border-radius:12px">Toggle admin</button>
                <button class="btn gray" data-reset-pass="${encodeURIComponent(u.name)}" style="padding:8px 10px; border-radius:12px; margin-left:6px">Change password</button>
                <button class="btn bad" data-del-user="${encodeURIComponent(u.name)}" style="padding:8px 10px; border-radius:12px; margin-left:6px">Delete</button>
              </td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    </div>
    ` : `<div class="small">No users found.</div>`}
  `;

  const search = area.querySelector("#userSearch");
  if (search) {
    // Preserve focus + caret while we re-render on each keystroke.
    search.oninput = () => {
      const caret = search.selectionStart;
      state.q = search.value;
      state.page = 1;
      renderUsers(root, { focusSearch: true, caret });
    };
  }
  const prevBtn = area.querySelector("#usersPrev");
  const nextBtn = area.querySelector("#usersNext");
  if (prevBtn) prevBtn.onclick = () => { state.page = Math.max(1, state.page - 1); renderUsers(root); };
  if (nextBtn) nextBtn.onclick = () => { state.page = Math.min(pages, state.page + 1); renderUsers(root); };

  if (opts?.focusSearch) {
    // After re-render, restore focus and caret.
    requestAnimationFrame(() => {
      const s = area.querySelector("#userSearch");
      if (!s) return;
      s.focus();
      const pos = Number.isFinite(opts.caret) ? opts.caret : s.value.length;
      try { s.setSelectionRange(pos, pos); } catch {}
    });
  }

  area.querySelectorAll("[data-toggle-admin]").forEach(btn => {
    btn.onclick = async () => {
      if (!canToggleAdmin) return toastError("Only admins can change admin rights");
      const name = decodeURIComponent(btn.getAttribute("data-toggle-admin") || "");
      if (meNameLower && String(name || "").trim().toLowerCase() === meNameLower) {
        return toastError("You cannot change your own admin access");
      }
      const cur = users.find(x => x.name === name);
      const next = !(Number(cur?.isAdmin)===1);
      const ok = confirm(`${next ? "Grant" : "Revoke"} admin for ${name}?`);
      if (!ok) return;
      const res = await API.adminSetAdmin(name, next).catch(() => null);
      if (!res?.ok) return toastError(res?.error || "Failed");
      // Update UI immediately without requiring an additional API call.
      users = users.map(u => (u.name === name ? { ...u, isAdmin: next ? 1 : 0 } : u));
      lsSet(LS_USERS_CACHE, { ts: Date.now(), users });
      toastSuccess("Updated");
      renderUsers(root);
    };
  });

  area.querySelectorAll("[data-reset-pass]").forEach(btn => {
    btn.onclick = async () => {
      const name = decodeURIComponent(btn.getAttribute("data-reset-pass") || "");
      const pwd = prompt(`Enter a new password for ${name}`);
      if (!pwd) return;
      const res = await API.adminSetPassword(name, pwd).catch(() => null);
      if (!res?.ok) return toastError(res?.error || "Failed");
      toastSuccess("Password updated");
    };
  });

  area.querySelectorAll("[data-del-user]").forEach(btn => {
    btn.onclick = async () => {
      const name = decodeURIComponent(btn.getAttribute("data-del-user") || "");
      const ok = confirm(`Delete user ${name}? This cannot be undone.`);
      if (!ok) return;
      const res = await API.adminDeleteUser(name).catch(() => null);
      if (!res?.ok) return toastError(res?.error || "Failed");
      toastSuccess("User deleted");
      renderUsers(root);
    };
  });
}

function bindUserMgmt(root, routeToken) {
  if (!stillOnAdmin(routeToken)) return;
  renderUsers(root).catch(() => {});
}

function bindListButtons(root, view) {
  // Manage
  // IMPORTANT: Don't rely solely on hashchange to open manage.
  // If the user previously opened the same match, setting the same hash may not trigger router work
  // depending on browser behavior + replaceState usage. So we open manage directly and then update URL.
  root.querySelectorAll('[data-manage]:not([disabled])').forEach(btn => {
    btn.onclick = async () => {
      const routeToken = window.__mlfcAdminToken;
      if (!stillOnAdmin(routeToken)) return;

      const code = btn.getAttribute("data-manage");
      // Navigate using the hash so the browser back button returns to the admin list view
      // (instead of whatever tab was open before entering admin).
      location.hash = `#/admin?view=manage&code=${encodeURIComponent(code)}&prev=${encodeURIComponent(view)}`;
    };
  });

  // Lock ratings
  root.querySelectorAll('[data-lock]:not([disabled])').forEach(btn => {
    btn.onclick = async () => {
      const routeToken = window.__mlfcAdminToken;
      if (!stillOnAdmin(routeToken)) return;

      const matchId = btn.getAttribute("data-lock");
      setDisabled(btn, true, "Locking…");

      const out = await API.adminLockRatings(matchId);
      setDisabled(btn, false);

      if (!out.ok) return toastError(out.error || "Failed");
      toastSuccess("Ratings locked.");

      const found = (MEM.matches || []).find(x => String(x.matchId) === String(matchId));
      if (found?.publicCode) {
        clearPublicMatchDetailCache(found.publicCode);
        clearManageCache(found.publicCode);
      }

      // Update list cache via API only if user wants latest; but here action definitely changed state
      // so we update MEM locally (fast) and save.
      MEM.matches = (MEM.matches || []).map(m => {
        if (String(m.matchId) !== String(matchId)) return m;
        return { ...m, status: "COMPLETED", ratingsLocked: "TRUE" };
      });
      lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

      // Re-render current list without API
      renderListView(root, view);
    };
  });

  // Delete match
  root.querySelectorAll('[data-delete-match]').forEach(btn => {
    btn.onclick = async () => {
      const routeToken = window.__mlfcAdminToken;
      if (!stillOnAdmin(routeToken)) return;

      const matchId = btn.getAttribute("data-delete-match");
      const ok = window.confirm("Delete this match? This will remove teams, availability, ratings, events, and scores for the match.");
      if (!ok) return;

      setDisabled(btn, true, "Deleting…");
      const out = await API.adminDeleteMatch(matchId);
      setDisabled(btn, false);

      if (!out?.ok) return toastError(out?.error || "Failed to delete");

      const deleted = String(matchId);
      MEM.matches = (MEM.matches || []).filter(m => String(m.matchId) !== deleted);
      lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });
      toastSuccess("Match deleted");
      renderListView(root, view);
    };
  });

  // Unlock match
  root.querySelectorAll('[data-unlock]').forEach(btn => {
    btn.onclick = async () => {
      const routeToken = window.__mlfcAdminToken;
      if (!stillOnAdmin(routeToken)) return;

      const matchId = btn.getAttribute("data-unlock");
      setDisabled(btn, true, "Unlocking…");

      const out = await API.adminUnlockMatch(matchId);
      setDisabled(btn, false);

      if (!out.ok) return toastError(out.error || "Failed");
      toastSuccess("Match unlocked.");

      const found = (MEM.matches || []).find(x => String(x.matchId) === String(matchId));
      if (found?.publicCode) {
        clearPublicMatchDetailCache(found.publicCode);
        clearManageCache(found.publicCode);
      }

      // Update MEM locally immediately (no API)
      MEM.matches = (MEM.matches || []).map(m => {
        if (String(m.matchId) !== String(matchId)) return m;
        return { ...m, status: "OPEN", ratingsLocked: "FALSE" };
      });
      lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

      // Re-render list without API
      renderListView(root, view);
    };
  });
}

/* =======================
   Manage UI (FULL)
   - Opponent: set captain, show link only AFTER save + share button
   - Internal: compact table (player + Blue/Orange), remove enables buttons again,
              captains chosen via checkbox in team lists,
              Save setup + Share teams buttons AFTER lists,
              Captain links section only AFTER save
   - No close availability anywhere
   ======================= */

function renderManageUI(root, data, routeToken, { fromCache, prevView } = { fromCache: true, prevView: "open" }) {
  if (!stillOnAdmin(routeToken)) return;

  const manageArea = root.querySelector("#manageArea");
  const listArea = root.querySelector("#listArea");
  listArea.style.display = "none";
  manageArea.style.display = "block";

  const m = data.match;
  const status = String(m.status || "").toUpperCase();
  const locked = String(m.ratingsLocked || "").toUpperCase() === "TRUE";
  const availabilityLocked = Number(m.availabilityLocked || 0) === 1 || String(m.availabilityLocked || "").toUpperCase() === "TRUE";
  const isCompleted = status === "COMPLETED";
  const isEditLocked = locked || status === "CLOSED" || isCompleted;

  const type = String(m.type || "").toUpperCase();
  const availability = data.availability || [];
  const yesPlayers = uniqueSorted(availability
    .filter(a => String(a.availability).toUpperCase() === "YES")
    .map(a => String(a.playerName || "").trim())
  );

  const availByName = new Map((availability || []).map(a => [String(a.playerName || '').trim().toLowerCase(), a]));
  const playerDeclaredNo = (name) => {
    const r = availByName.get(String(name || '').trim().toLowerCase());
    return String(r?.playerDeclared || '').trim().toUpperCase() === 'NO';
  };


  const captains = data.captains || {};
  const teams = data.teams || [];

  const when = formatHumanDateTime(m.date, m.time);

  manageArea.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:flex-start">
        <div style="min-width:0">
          <div class="h1" style="margin:0">Manage: ${m.title}</div>
          <div class="small" style="margin-top:6px">${when} • ${m.type} • ${m.status}</div>
          <div class="small" style="margin-top:6px">${fromCache ? "Loaded from device cache." : "Loaded from API."}</div>
          <div class="small" style="margin-top:6px">Refresh your browser to reload latest match details.</div>
        </div>
      </div>

      <div class="small" style="margin-top:10px">Match link:</div>
      <div class="small" style="word-break:break-all">${matchLink(m.publicCode)}</div>

      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
        <button class="btn primary" id="shareMatch">Share match link</button>
        <button class="btn gray" id="refreshManage">Refresh match</button>
        ${isEditLocked ? `<button class="btn gray" id="unlockBtn">Unlock match</button>` : ""}
       
        <button class="btn primary" id="lockRatingsTop" ${locked ? "disabled" : ""}>Lock ratings</button>
      </div>

      ${locked ? `<div class="small" style="margin-top:10px">This match is locked. Manage and Lock actions are disabled in lists.</div>` : ""}
    </div>

    <div id="manageBody"></div>
  `;

  // Per requirement: no in-page Back/Refresh buttons.
  // Use browser back/forward and browser refresh when needed.

  manageArea.querySelector("#shareMatch").onclick = () => {
    waOpenPrefill(`Manor Lakes FC match link:\n${matchLink(m.publicCode)}`);
    toastInfo("WhatsApp opened.");
  };

  const refreshManageBtn = manageArea.querySelector("#refreshManage");
  if (refreshManageBtn) {
    refreshManageBtn.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      setDisabled(refreshManageBtn, true, "Refreshing…");
      try {
        // Clear caches first so we don't re-render stale data.
        clearPublicMatchDetailCache(m.publicCode);
        clearManageCache(m.publicCode);
        const fresh = await API.getPublicMatch(m.publicCode);
        if (!stillOnAdmin(routeToken)) return;
        if (!fresh?.ok) return toastError(fresh?.error || "Failed to refresh");
        lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
        renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
        toastSuccess("Refreshed.");
      } finally {
        setDisabled(refreshManageBtn, false);
      }
    };
  }

  const unlockBtn = manageArea.querySelector("#unlockBtn");
  if (unlockBtn) {
    unlockBtn.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      setDisabled(unlockBtn, true, "Unlocking…");
      const out = await API.adminUnlockMatch(m.matchId);
      setDisabled(unlockBtn, false);
      if (!out.ok) return toastError(out.error || "Failed");

      toastSuccess("Unlocked.");
      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);

      // Update MEM locally (no API)
      MEM.matches = (MEM.matches || []).map(x => String(x.matchId) === String(m.matchId)
        ? { ...x, status: "OPEN", ratingsLocked: "FALSE", availabilityLocked: "FALSE" }
        : x
      );
      lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

      // Fetch fresh match once to update manage view (explicit action just happened)
      const fresh = await API.getPublicMatch(m.publicCode);
      if (stillOnAdmin(routeToken) && fresh.ok) {
        lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
        renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
      }
    };
  }


 

  manageArea.querySelector("#lockRatingsTop").onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;

    const btn = manageArea.querySelector("#lockRatingsTop");
    setDisabled(btn, true, "Locking…");

    const out = await API.adminLockRatings(m.matchId);
    setDisabled(btn, false);
    if (!out.ok) return toastError(out.error || "Failed");

    toastSuccess("Ratings locked.");
    clearPublicMatchDetailCache(m.publicCode);
    clearManageCache(m.publicCode);

    // Update MEM locally (no API)
    MEM.matches = (MEM.matches || []).map(x => String(x.matchId) === String(m.matchId)
      ? { ...x, status: "COMPLETED", ratingsLocked: "TRUE" }
      : x
    );
    lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

    // Fetch fresh match once to update manage view
    const fresh = await API.getPublicMatch(m.publicCode);
    if (stillOnAdmin(routeToken) && fresh.ok) {
      lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
      renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
    }
  };

  const manageBody = manageArea.querySelector("#manageBody");

  /* ================= OPPONENT ================= */
  if (type === "OPPONENT") {
    const cap = String(captains.captain1 || "");
    const opts = yesPlayers.map(p => `<option value="${p}">${p}</option>`).join("");

    // Current saved squad (team=MLFC)
    let squad = uniqueSorted(teams
      .filter(t => String(t.team || "").toUpperCase() === "MLFC")
      .map(t => String(t.playerName || "").trim())
    );

    // If no saved squad yet, default to all YES players (keeps old behavior simple)
    if (!squad.length && yesPlayers.length) squad = [...yesPlayers];

    function renderSquadLists() {
      const pool = uniqueSorted(yesPlayers.filter(p => !squad.includes(p)));
      const poolEl = manageBody.querySelector("#poolList");
      const squadEl = manageBody.querySelector("#squadList");
      const poolCount = manageBody.querySelector("#poolCount");
      const squadCount = manageBody.querySelector("#squadCount");
      if (poolCount) poolCount.textContent = String(pool.length);
      if (squadCount) squadCount.textContent = String(squad.length);

      if (poolEl) {
        poolEl.innerHTML = pool.length ? pool.map(p => `
          <div class="row" style="justify-content:space-between; gap:10px; margin-top:6px">
            <div class="small" style="min-width:0">${p}</div>
            <button class="btn gray tiny" data-add-squad="${encodeURIComponent(p)}" ${isEditLocked ? "disabled" : ""}>Add</button>
          </div>
        `).join("") : `<div class="small">No available players to add.</div>`;
      }

      if (squadEl) {
        squadEl.innerHTML = squad.length ? squad.map(p => `
          <div class="row" style="justify-content:space-between; gap:10px; margin-top:6px">
            <div class="small" style="min-width:0">${p}</div>
            <button class="btn bad tiny" data-remove-squad="${encodeURIComponent(p)}" ${isEditLocked ? "disabled" : ""}>Remove</button>
          </div>
        `).join("") : `<div class="small">No squad selected yet.</div>`;
      }

      manageBody.querySelectorAll("[data-add-squad]").forEach(btn => {
        btn.onclick = () => {
          const p = decodeURIComponent(btn.dataset.addSquad || "");
          if (!p) return;
          if (!squad.includes(p)) squad = uniqueSorted([...squad, p]);
          renderSquadLists();
        };
      });
      manageBody.querySelectorAll("[data-remove-squad]").forEach(btn => {
        btn.onclick = () => {
          const p = decodeURIComponent(btn.dataset.removeSquad || "");
          squad = squad.filter(x => x !== p);
          renderSquadLists();
        };
      });
    }

    manageBody.innerHTML = `
      <details class="card" open>
        <summary style="font-weight:950">Opponent match setup</summary>

        <div class="h1">Captain</div>
        <div class="small">Select captain from available (YES) players.</div>
        <select id="captainSel" class="input" style="margin-top:10px" ${isEditLocked ? "disabled" : ""}>
          <option value="">Select captain</option>
          ${opts}
        </select>

        <div class="hr"></div>

        <div class="h1">MLFC squad</div>
        <div class="small">Pick the MLFC team list for this opponent match. Waiting list is managed via availability.</div>

        <div class="row" style="gap:14px; flex-wrap:wrap; margin-top:10px">
          <div style="flex:1; min-width:260px">
            <div class="badge">Available (YES) - <span id="poolCount">0</span></div>
            <div id="poolList" style="margin-top:10px"></div>
          </div>
          <div style="flex:1; min-width:260px">
            <div class="badge">Selected (MLFC) - <span id="squadCount">0</span></div>
            <div id="squadList" style="margin-top:10px"></div>
          </div>
        </div>

        <div class="row" style="margin-top:14px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="saveOpponent" ${isEditLocked ? "disabled" : ""}>Save setup</button>
          <button class="btn primary" id="shareSquad">Share squad</button>
          ${!isEditLocked ? (availabilityLocked ? `<button class="btn gray" id="openAvailability">Re-open availability</button>` : `<button class="btn warn" id="closeAvailability">Close availability</button>`) : ""}
        </div>

        <div class="hr"></div>

        <div class="h1">Availability (admin)</div>
        <div class="small">Add/update any player’s availability (including people without the app).</div>

        <input id="adminPlayerCombo" class="input" placeholder="Search player name" autocomplete="off" style="margin-top:10px" ${isEditLocked ? "disabled" : ""} />
        <div id="adminPlayerComboList" class="comboList" style="display:none"></div>

        <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
          <select id="adminAddAvailability" class="input" style="width:200px" ${isEditLocked ? "disabled" : ""}>
            <option value="YES" selected>YES</option>
            <option value="WAITING">WAITING</option>
            <option value="NO">NO</option>
          </select>
          <button class="btn primary" id="adminAddPlayerBtn" ${isEditLocked ? "disabled" : ""}>Save availability</button>
        </div>
        <div class="small" id="adminAddPlayerMsg" style="margin-top:10px"></div>

        <div class="hr"></div>

        <div class="h1">Ratings</div>
        <div class="small">Rate players for this match (admin can rate anyone).</div>
        <div class="row" style="margin-top:10px">
          <button class="btn primary" id="openRatingsAdmin">Give ratings</button>
        </div>

        <div class="small" id="msg" style="margin-top:10px"></div>
      </details>
    `;

    const capSel = manageBody.querySelector("#captainSel");
    capSel.value = cap || "";

    renderSquadLists();

    const openAdmin = manageBody.querySelector("#openRatingsAdmin");
    if (openAdmin) openAdmin.onclick = () => {
      location.hash = `#/captain?code=${encodeURIComponent(m.publicCode)}&src=admin`;
    };

    manageBody.querySelector("#shareSquad").onclick = () => {
      const list = squad.length ? squad.join("\n") : "(no squad selected)";
      waOpenPrefill(`Manor Lakes FC squad (${m.title}):\n\n${list}\n\nMatch link:\n${matchLink(m.publicCode)}`);
      toastInfo("WhatsApp opened.");
    };

    manageBody.querySelector("#saveOpponent").onclick = async () => {
      const btn = manageBody.querySelector("#saveOpponent");
      const msg = manageBody.querySelector("#msg");
      const selCaptain = String(capSel.value || "").trim();

      setDisabled(btn, true, "Saving…");
      msg.textContent = "Saving…";

      const out = await API.adminSetupOpponent({ matchId: m.matchId, captain: selCaptain, mlfcPlayers: squad });
      setDisabled(btn, false);

      if (!out.ok) { msg.textContent = out.error || "Failed"; return toastError(out.error || "Failed"); }
      msg.textContent = "Saved ✅";
      toastSuccess("Opponent match setup saved.");

      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);

      const fresh = await API.getPublicMatch(m.publicCode);
      if (stillOnAdmin(routeToken) && fresh.ok) {
        lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
        renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
      }
    };

    // Close/re-open availability buttons (same behavior as internal)
    const closeAvailabilityBtn = manageBody.querySelector("#closeAvailability");
    if (closeAvailabilityBtn) {
      closeAvailabilityBtn.onclick = async () => {
        if (!stillOnAdmin(routeToken)) return;
        setDisabled(closeAvailabilityBtn, true, "Closing…");
        const out = await API.adminCloseAvailability(m.matchId);
        setDisabled(closeAvailabilityBtn, false);
        if (!out.ok) return toastError(out.error || "Failed");

        toastSuccess("Availability closed.");
        clearPublicMatchDetailCache(m.publicCode);
        clearManageCache(m.publicCode);

        const fresh = await API.getPublicMatch(m.publicCode);
        if (stillOnAdmin(routeToken) && fresh.ok) {
          lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
          renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
        }
      };
    }
    const openAvailabilityBtn = manageBody.querySelector("#openAvailability");
    if (openAvailabilityBtn) {
      openAvailabilityBtn.onclick = async () => {
        if (!stillOnAdmin(routeToken)) return;
        setDisabled(openAvailabilityBtn, true, "Opening…");
        const out = await API.adminOpenAvailability(m.matchId);
        setDisabled(openAvailabilityBtn, false);
        if (!out.ok) return toastError(out.error || "Failed");

        toastSuccess("Availability re-opened.");
        clearPublicMatchDetailCache(m.publicCode);
        clearManageCache(m.publicCode);

        const fresh = await API.getPublicMatch(m.publicCode);
        if (stillOnAdmin(routeToken) && fresh.ok) {
          lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
          renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
        }
      };
    }

    // Availability admin combo logic (duplicated from internal block)
    let __adminAllPlayers = [];
    let __adminSelectedPlayer = "";

    function getComboEls() {
      return {
        input: manageBody.querySelector("#adminPlayerCombo"),
        list: manageBody.querySelector("#adminPlayerComboList"),
      };
    }
    function hideComboList() {
      const { list } = getComboEls();
      if (list) list.style.display = "none";
    }
    function renderComboList(filterText = "") {
      const { list } = getComboEls();
      if (!list) return;
      const q = String(filterText || "").trim().toLowerCase();
      const items = q ? __adminAllPlayers.filter(n => n.toLowerCase().includes(q)) : __adminAllPlayers;
      if (!items.length) {
        list.innerHTML = "";
        list.style.display = "none";
        return;
      }
      list.innerHTML = items.slice(0, 60).map(n => `<button type="button" class="comboItem" data-name="${n}">${n}</button>`).join("");
      list.style.display = "block";
      list.querySelectorAll(".comboItem").forEach(btn => {
        btn.onclick = () => {
          const name = String(btn.dataset.name || "").trim();
          __adminSelectedPlayer = name;
          const { input } = getComboEls();
          if (input) input.value = name;
          hideComboList();
        };
      });
    }

    (async () => {
      try {
        const users = await getUsersCached(false);
        __adminAllPlayers = uniqueSorted((users || []).map(u => String(u?.name || u || "").trim()).filter(Boolean));
        const { input } = getComboEls();
        if (input) {
          input.onfocus = () => renderComboList(input.value);
          input.oninput = () => {
            __adminSelectedPlayer = "";
            renderComboList(input.value);
          };
          input.onblur = () => setTimeout(hideComboList, 120);
          input.onkeydown = (e) => {
            if (e.key === "Escape") { hideComboList(); input.blur(); }
          };
        }
      } catch (e) {
        const addBtn = manageBody.querySelector("#adminAddPlayerBtn");
        if (addBtn) addBtn.disabled = true;
        const msgEl = manageBody.querySelector("#adminAddPlayerMsg");
        if (msgEl) msgEl.textContent = "Failed to load players list.";
      }
    })();

    const addBtn = manageBody.querySelector("#adminAddPlayerBtn");
    if (addBtn) {
      addBtn.onclick = async () => {
        if (!stillOnAdmin(routeToken)) return;
        const availEl = manageBody.querySelector("#adminAddAvailability");
        const msgEl = manageBody.querySelector("#adminAddPlayerMsg");

        const playerName = String(__adminSelectedPlayer || "").trim();
        const desired = String(availEl?.value || "YES").trim().toUpperCase();

        if (!playerName) return toastWarn("Search and select a player");
        if (desired === "WAITING" && yesPlayers.length < 22) {
          return toastWarn("Waiting list is only available once 22 players are marked YES.");
        }

        setDisabled(addBtn, true, "Saving…");
        if (msgEl) msgEl.textContent = "Saving…";
        try {
          const out = await API.adminSetAvailabilityFor(m.matchId, playerName, desired);
          if (!out?.ok) throw new Error(out?.error || "Failed");

          const eff = String(out.effectiveAvailability || desired).toUpperCase();
          if (eff === "WAITING") toastInfo(`${playerName} added to waiting list.`);
          else if (eff === "YES") toastSuccess(`${playerName} marked YES.`);
          else toastSuccess(`${playerName} marked NO.`);

          try {
            const searchEl = manageBody.querySelector("#adminPlayerCombo");
            if (searchEl) searchEl.value = "";
            __adminSelectedPlayer = "";
            hideComboList();
          } catch {}

          clearPublicMatchDetailCache(m.publicCode);
          clearManageCache(m.publicCode);
          const fresh = await API.getPublicMatch(m.publicCode);
          if (stillOnAdmin(routeToken) && fresh?.ok) {
            lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
            renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
            return;
          }
          if (msgEl) msgEl.textContent = "Saved.";
        } catch (e) {
          toastError(String(e?.message || e));
          if (msgEl) msgEl.textContent = String(e?.message || e);
        } finally {
          setDisabled(addBtn, false);
        }
      };
    }

    return;
  }

  /* ================= INTERNAL ================= */
  let blue = uniqueSorted(teams.filter(t => String(t.team).toUpperCase() === "BLUE").map(t => String(t.playerName || "").trim()));
  let orange = uniqueSorted(teams.filter(t => String(t.team).toUpperCase() === "ORANGE").map(t => String(t.playerName || "").trim()));
  let captainBlue = String(captains.captain1 || "");
  let captainOrange = String(captains.captain2 || "");

  // Links can be generated as soon as we know the captain names (no need to wait for Save setup).
  const blueUrl = captainBlue ? captainLink(m.publicCode) : "";
  const orangeUrl = captainOrange ? captainLink(m.publicCode) : "";
  // Sharing teams should NOT depend on captain selection.
  const hasAnyTeams = (blue.length + orange.length) > 0;

  function assignedTeam(p) {
    if (blue.includes(p)) return "BLUE";
    if (orange.includes(p)) return "ORANGE";
    return "";
  }

  function setTeam(p, team) {
    // remove from both
    blue = blue.filter(x => x !== p);
    orange = orange.filter(x => x !== p);

    if (team === "BLUE") blue = uniqueSorted([...blue, p]);
    if (team === "ORANGE") orange = uniqueSorted([...orange, p]);

    // if captain got removed, clear
    if (!blue.includes(captainBlue)) captainBlue = "";
    if (!orange.includes(captainOrange)) captainOrange = "";
  }

  function removeFromTeam(p) {
    blue = blue.filter(x => x !== p);
    orange = orange.filter(x => x !== p);
    if (captainBlue === p) captainBlue = "";
    if (captainOrange === p) captainOrange = "";
  }

  manageBody.innerHTML = `
    <details class="card" open>
      <summary style="font-weight:950">Add players to this match (Admin)</summary>

      <div class="small" style="margin-top:8px">
        Search and select an existing player to add/update their availability.
        (Only existing names are allowed.)
      </div>

      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap; align-items:center">
        <div class="comboWrap" style="flex:1; min-width:220px; position:relative">
          <input class="input" id="adminPlayerCombo" placeholder="Search & select player…" autocomplete="off" style="width:100%" />
          <div id="adminPlayerComboList" class="comboList" style="display:none"></div>
        </div>

        <select class="input" id="adminAddAvailability" style="min-width:160px">
          <option value="YES" selected>YES (Available)</option>
          <option value="NO">NO (Not available)</option>
          <option value="WAITING" ${yesPlayers.length >= 22 ? "" : "disabled"}>WAITING LIST</option>
        </select>

        <button class="btn primary" id="adminAddPlayerBtn" ${isEditLocked ? "disabled" : ""}>Add / Update</button>
</div>

      <div id="adminAddPlayerMsg" class="small" style="margin-top:10px"></div>
    </details>

    <details class="card" open>
      <summary style="font-weight:950">Internal setup</summary>

      <div class="small" style="margin-top:8px">
        Assign available players to Blue/Orange. You can change teams anytime. Tap <b>Clear</b> to unassign.
      </div>

      <div style="margin-top:12px">
        <div id="teamAssignList" class="assignList"></div>
      </div>

      <div class="hr"></div>

      <div class="row" style="gap:14px; align-items:flex-start; flex-wrap:wrap">
        <div style="flex:1; min-width:260px">
          <div class="badge assignBadge--blue">BLUE - <span id="blueCount">0</span></div>
          <div id="blueList" style="margin-top:10px"></div>
        </div>
        <div style="flex:1; min-width:260px">
          <div class="badge assignBadge--orange">ORANGE - <span id="orangeCount">0</span></div>
          <div id="orangeList" style="margin-top:10px"></div>
        </div>
      </div>

      <!-- Requested: Save + Share after lists -->
      <div class="row" style="margin-top:14px; gap:10px; flex-wrap:wrap">
        <button class="btn primary" id="saveSetup" ${isEditLocked ? "disabled" : ""}>Save setup</button>
        <button class="btn primary" id="shareTeams" ${hasAnyTeams ? "" : "disabled"}>Share teams</button>
         ${!isEditLocked ? (availabilityLocked ? `<button class="btn gray" id="openAvailability">Re-open availability</button>` : `<button class="btn warn" id="closeAvailability">Close availability</button>`) : ""}
      </div>

      <div class="hr"></div>

      <div class="h1">Ratings</div>
      <div class="small">Admin can rate all players for this match (partial submission allowed).</div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="openRatingsAdminInternal">Give ratings</button>
      </div>

      <div id="setupMsg" class="small" style="margin-top:10px"></div>
    </details>

    
  `;

  
// Populate a single "search + select" combobox (registered users).
// Mobile-friendly: one control, enforces existing names only.
let __adminAllPlayers = [];
let __adminSelectedPlayer = ""; // only set when user picks an option from the list

function getComboEls() {
  return {
    input: manageBody.querySelector("#adminPlayerCombo"),
    list: manageBody.querySelector("#adminPlayerComboList"),
  };
}

function hideComboList() {
  const { list } = getComboEls();
  if (list) list.style.display = "none";
}

function renderComboList(filterText = "") {
  const { list } = getComboEls();
  if (!list) return;

  const q = String(filterText || "").trim().toLowerCase();
  const items = q
    ? __adminAllPlayers.filter(n => n.toLowerCase().includes(q))
    : __adminAllPlayers;

  if (!items.length) {
    list.innerHTML = "";
    list.style.display = "none";
    return;
  }

  list.innerHTML = items.slice(0, 60).map(n => `
    <button type="button" class="comboItem" data-name="${n}">${n}</button>
  `).join("");

  list.style.display = "block";

  list.querySelectorAll(".comboItem").forEach(btn => {
    btn.onclick = () => {
      const name = String(btn.dataset.name || "").trim();
      __adminSelectedPlayer = name;
      const { input } = getComboEls();
      if (input) input.value = name;
      hideComboList();
    };
  });
}

(async () => {
  try {
    const users = await getUsersCached(false);
    __adminAllPlayers = uniqueSorted(
      (users || [])
        .map(u => String(u?.name || u || "").trim())
        .filter(Boolean)
    );

    const { input } = getComboEls();
    if (input) {
      input.onfocus = () => renderComboList(input.value);

      input.oninput = () => {
        __adminSelectedPlayer = "";
        renderComboList(input.value);
      };

      input.onblur = () => setTimeout(hideComboList, 120);

      input.onkeydown = (e) => {
        if (e.key === "Escape") {
          hideComboList();
          input.blur();
        }
      };
    }
  } catch (e) {
    const addBtn = manageBody.querySelector("#adminAddPlayerBtn");
    if (addBtn) addBtn.disabled = true;
    const msgEl = manageBody.querySelector("#adminAddPlayerMsg");
    if (msgEl) msgEl.textContent = "Failed to load players list.";
  }
})();

  const closeAvailabilityBtn = manageBody.querySelector("#closeAvailability");
  if (closeAvailabilityBtn) {
    closeAvailabilityBtn.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      setDisabled(closeAvailabilityBtn, true, "Closing…");
      const out = await API.adminCloseAvailability(m.matchId);
      setDisabled(closeAvailabilityBtn, false);
      if (!out.ok) return toastError(out.error || "Failed");

      toastSuccess("Availability closed.");
      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);

      // Update MEM locally (no API)
      MEM.matches = (MEM.matches || []).map(x => String(x.matchId) === String(m.matchId)
        ? { ...x, availabilityLocked: "TRUE" }
        : x
      );
      lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

      const fresh = await API.getPublicMatch(m.publicCode);
      if (stillOnAdmin(routeToken) && fresh.ok) {
        lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
        renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
      }
    };
  }
 const openAvailabilityBtn = manageBody.querySelector("#openAvailability");
  if (openAvailabilityBtn) {
    openAvailabilityBtn.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      setDisabled(openAvailabilityBtn, true, "Opening…");
      const out = await API.adminOpenAvailability(m.matchId);
      setDisabled(openAvailabilityBtn, false);
      if (!out.ok) return toastError(out.error || "Failed");

      toastSuccess("Availability re-opened.");
      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);

      // Update MEM locally (no API)
      MEM.matches = (MEM.matches || []).map(x => String(x.matchId) === String(m.matchId)
        ? { ...x, availabilityLocked: "FALSE" }
        : x
      );
      lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

      const fresh = await API.getPublicMatch(m.publicCode);
      if (stillOnAdmin(routeToken) && fresh.ok) {
        lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
        renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
      }
    };
  }

  // Add/update availability for any named player (admin only)
  const addBtn = manageBody.querySelector("#adminAddPlayerBtn");
  if (addBtn) {
    addBtn.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      const availEl = manageBody.querySelector("#adminAddAvailability");
      const msgEl = manageBody.querySelector("#adminAddPlayerMsg");

      const playerName = String(__adminSelectedPlayer || "").trim();
      const desired = String(availEl?.value || "YES").trim().toUpperCase();

      if (!playerName) return toastWarn("Search and select a player");

      // Enforce UI rule: waiting list only enabled when 22 YES.
      if (desired === "WAITING" && yesPlayers.length < 22) {
        return toastWarn("Waiting list is only available once 22 players are marked YES.");
      }

      setDisabled(addBtn, true, "Saving…");
      if (msgEl) msgEl.textContent = "Saving…";
      try {
        const out = await API.adminSetAvailabilityFor(m.matchId, playerName, desired);
        if (!out?.ok) throw new Error(out?.error || "Failed");

        const eff = String(out.effectiveAvailability || desired).toUpperCase();
        if (eff === "WAITING") toastInfo(`${playerName} added to waiting list.`);
        else if (eff === "YES") toastSuccess(`${playerName} marked YES.`);
        else toastSuccess(`${playerName} marked NO.`);

        // Clear selection/search for quick entry
        try {
          const searchEl = manageBody.querySelector("#adminPlayerCombo");
          if (searchEl) searchEl.value = "";
          __adminSelectedPlayer = "";
          hideComboList();
        } catch {}

        // Reload match so lists/teams reflect latest availability
        clearPublicMatchDetailCache(m.publicCode);
        clearManageCache(m.publicCode);
        const fresh = await API.getPublicMatch(m.publicCode);
        if (stillOnAdmin(routeToken) && fresh?.ok) {
          lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
          renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
          return;
        }
        if (msgEl) msgEl.textContent = "Saved.";
      } catch (e) {
        toastError(String(e?.message || e));
        if (msgEl) msgEl.textContent = String(e?.message || e);
      } finally {
        setDisabled(addBtn, false);
      }
    };
  }

  // Mobile-friendly assignment UI: no horizontal scrolling, and team can be changed directly.
  function renderTeamAssignList() {
    const box = manageBody.querySelector("#teamAssignList");
    if (!box) return;

    if (!yesPlayers.length) {
      box.innerHTML = `<div class="card"><div class="small">No available players yet.</div></div>`;
      return;
    }

    box.innerHTML = yesPlayers.map(p => {
      const a = assignedTeam(p);
      const badgeCls = a === "BLUE" ? "assignBadge assignBadge--blue"
        : a === "ORANGE" ? "assignBadge assignBadge--orange"
        : "assignBadge";
      const badgeText = a ? a : "UNASSIGNED";

      const blueActive = a === "BLUE" ? "primary" : "gray";
      const orangeActive = a === "ORANGE" ? "primary" : "gray";

      return `
        <div class="assignCard">
          <div class="assignCard__head">
            <div style="min-width:0">
              <div class="assignCard__name">${p} ${playerDeclaredNo(p) ? '<span title="Player marked NOT available" style="margin-left:6px">⚠️</span>' : ''}</div>
              <div class="assignCard__meta">Assigned: <b>${badgeText}</b></div>
            </div>
            <div class="${badgeCls}">${badgeText}</div>
          </div>

          <div class="assignBtns">
            <button class="btn ${blueActive} tiny" data-team-btn="BLUE" data-player="${encodeURIComponent(p)}" ${isEditLocked ? "disabled" : ""}>Blue</button>
            <button class="btn ${orangeActive} tiny" data-team-btn="ORANGE" data-player="${encodeURIComponent(p)}" ${isEditLocked ? "disabled" : ""}>Orange</button>
            <button class="btn ghost tiny" data-remove="${encodeURIComponent(p)}" ${isEditLocked ? "disabled" : ""} ${a ? "" : "disabled"}>Clear</button>
          </div>
        </div>
      `;
    }).join("");

    box.querySelectorAll("[data-team-btn]").forEach(b => {
      b.onclick = () => {
        const team = b.getAttribute("data-team-btn");
        const p = decodeURIComponent(b.getAttribute("data-player"));
        setTeam(p, team);
        renderAll();
      };
    });

    box.querySelectorAll("[data-remove]").forEach(b => {
      b.onclick = () => {
        const p = decodeURIComponent(b.getAttribute("data-remove"));
        removeFromTeam(p);
        renderAll();
      };
    });
  }

  function renderLists() {
    const blueEl = manageBody.querySelector("#blueList");
    const orangeEl = manageBody.querySelector("#orangeList");
    const blueCountEl = manageBody.querySelector("#blueCount");
    const orangeCountEl = manageBody.querySelector("#orangeCount");

    if (blueCountEl) blueCountEl.textContent = String(blue.length);
    if (orangeCountEl) orangeCountEl.textContent = String(orange.length);

    function listHtml(players, teamName) {
      if (!players.length) return `<div class="small">No players yet.</div>`;
      return players.map(p => {
        const isCap = (teamName === "BLUE" ? captainBlue === p : captainOrange === p);
        const disabled = isEditLocked ? "disabled" : "";
        return `
          <div class="teamMiniRow">
            <div class="teamMiniRow__name" title="${p}">${p}${playerDeclaredNo(p) ? ' <span title="Player marked NOT available">⚠️</span>' : ''}</div>

            <div class="teamMiniRow__cap">
              <label class="small" style="display:flex; gap:6px; align-items:center">
                <input type="checkbox" data-cap="${teamName}" data-player="${encodeURIComponent(p)}" ${isCap ? "checked" : ""} ${disabled}/>
                Captain
              </label>
            </div>

            <button class="teamMiniRow__x" data-remove="${encodeURIComponent(p)}" ${disabled} aria-label="Remove ${p}">×</button>
          </div>
        `;
      }).join("");
    }

    blueEl.innerHTML = listHtml(blue, "BLUE");
    orangeEl.innerHTML = listHtml(orange, "ORANGE");

    manageBody.querySelectorAll("[data-cap]").forEach(cb => {
      cb.onchange = () => {
        const teamName = cb.getAttribute("data-cap");
        const p = decodeURIComponent(cb.getAttribute("data-player"));
        if (cb.checked && playerDeclaredNo(p)) {
          toastWarn(`${p} marked NOT available — captain assignment allowed, but double-check.`);
        }
        if (teamName === "BLUE") captainBlue = cb.checked ? p : "";
        if (teamName === "ORANGE") captainOrange = cb.checked ? p : "";
        renderAll();
      };
    });

    manageBody.querySelectorAll("[data-remove]").forEach(btn => {
      btn.onclick = () => {
        const p = decodeURIComponent(btn.getAttribute("data-remove"));
        removeFromTeam(p);
        renderAll();
      };
    });
  }

  function renderAll() {
    blue = uniqueSorted(blue);
    orange = uniqueSorted(orange);
    renderTeamAssignList();
    renderLists();

    const shareBtn = manageBody.querySelector("#shareTeams");
    if (shareBtn) {
      const ok = (blue.length + orange.length) > 0;
      shareBtn.disabled = !ok;
    }
  }

  renderAll();

  // Admin ratings entry point (internal matches)
  const openRatingsInternal = manageBody.querySelector("#openRatingsAdminInternal");
  if (openRatingsInternal) {
    openRatingsInternal.onclick = () => {
      location.hash = `#/captain?code=${encodeURIComponent(m.publicCode)}&src=admin`;
    };
  }

  // Save setup
  manageBody.querySelector("#saveSetup").onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;
    if (isEditLocked) return toastWarn("Match is locked. Unlock to edit.");

    const msg = manageBody.querySelector("#setupMsg");
    // Requested: allow saving setup even if captains aren't selected yet.
    // Captains can be assigned later without blocking team setup.
    if (!captainBlue || !captainOrange) {
      msg.textContent = "Saving setup (captains can be selected later)…";
    }

    const btn = manageBody.querySelector("#saveSetup");
    setDisabled(btn, true, "Saving…");
    msg.textContent = "Saving…";

    const out = await API.adminSetupInternal({
      matchId: m.matchId,
      bluePlayers: blue,
      orangePlayers: orange,
      captainBlue,
      captainOrange
    });

    setDisabled(btn, false);

    if (!out.ok) {
      msg.textContent = out.error || "Failed";
      return toastError(out.error || "Failed to save setup");
    }

    msg.textContent = "Saved ✅";
    toastSuccess("Setup saved.");

    clearManageCache(m.publicCode);

    const fresh = await API.getPublicMatch(m.publicCode);
    if (stillOnAdmin(routeToken) && fresh.ok) {
      lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
      renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
    }
  };

  // Share teams (after saved)
  const shareTeamsBtn = manageBody.querySelector("#shareTeams");
  shareTeamsBtn.onclick = () => {
    const ok = (blue.length + orange.length) > 0;
    if (!ok) return toastWarn("Assign players to Blue/Orange first.");

    setDisabled(shareTeamsBtn, true, "Opening…");

  const lines = [];
  lines.push(`Match: ${m.title}`);
  lines.push(`When: ${when}`);
  lines.push(`Type: INTERNAL`);
  lines.push(`Link: ${matchLink(m.publicCode)}`);
  lines.push("");
  lines.push(`⚠️ Shared from Admin portal. Please do NOT edit or re-share this message.`);
  lines.push(`Post your availability from your Match home screen.`);
  lines.push("");
  lines.push(`Captain remains anonymous.`);
  lines.push(`Captain for each match will receive notification. Please check and provide genuine ratings.`);
  lines.push("");

  // Do NOT reveal captain names in the shared message
  lines.push(`BLUE Team`);
  blue.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  lines.push("");
  lines.push(`ORANGE Team`);
  orange.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  lines.push("");

  waOpenPrefill(lines.join("\n"));
  toastInfo("WhatsApp opened.");

  setTimeout(() => setDisabled(shareTeamsBtn, false), 900);
  };

  const so = manageBody.querySelector("#shareOrangeCap");
  if (so) so.onclick = () => { waOpenPrefill(`Captain link:\n${captainLink(m.publicCode)}`); toastInfo("WhatsApp opened."); };
}

/* =======================
   Main entry
   ======================= */

export async function renderAdminPage(root, query) {
  cleanupCaches();

  const routeToken = (window.__mlfcAdminToken = String(Math.random()));

  let me = getCachedUser();
  // Only hit /me on hard reload of admin page or when cache is empty
  if (!me && getToken()) {
    const force = isReloadFor("#/admin");
    me = await refreshMe(force).catch(() => null);
  }
  if (!me?.isAdmin) {
    root.innerHTML = `
      <div class="card">
        <div class="h1">Admin</div>
        <div class="small">You are not an admin. Login as an admin user to access this page.</div>
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="goLogin">Login</button>
          <button class="btn gray" id="goMatches">Go to matches</button>
        </div>
      </div>
    `;
    root.querySelector("#goLogin").onclick = () => (location.hash = "#/login");
    root.querySelector("#goMatches").onclick = () => (location.hash = "#/match");
    return;
  }

  // seasons cache-first
  const seasonsRes = await loadSeasonsCached(routeToken);
  if (!stillOnAdmin(routeToken)) return;

  if (!seasonsRes.ok) {
    toastError(seasonsRes.error || "Failed to load seasons");
    root.innerHTML = `<div class="card"><div class="h1">Admin</div><div class="small">Failed to load seasons.</div></div>`;
    return;
  }

  const picked = pickSelectedSeason(seasonsRes);
  MEM.seasons = picked.seasons;
  MEM.selectedSeasonId = localStorage.getItem(LS_SELECTED_SEASON) || picked.selected;

  // matches cache-first (no API)
  loadMatchesFromLocal(MEM.selectedSeasonId);

  const { view, code, prev } = getViewParams(query);

  if (view === "users") {
    root.innerHTML = `
      <div class="pageHeader">
        <div class="h1" style="margin:0">User management</div>
      </div>
      <div class="card" id="usersArea"></div>
    `;
    await renderUsers(root);
    return;
  }

  renderAdminShell(root, view);

  bindTopNav(root, routeToken);
  bindSeasonSelector(root, routeToken);
  bindSeasonMgmt(root, routeToken);
  bindCreateMatch(root, routeToken);
  bindHeaderButtons(root, routeToken);
  // Users view is rendered on demand
  if (view === "users") {
    bindUserMgmt(root, routeToken);
  }

  const msg = root.querySelector("#msg");
  msg.textContent = MEM.matches.length
    ? "Loaded from device cache. Refresh your browser to fetch the latest."
    : "No cached matches for this season yet. Refresh your browser to load from server.";

  // Per requirement: fetch admin matches from API ONLY on browser refresh (or first time with empty cache).
  const viewNow = view;
  const hasCache = !!lsGet(matchesKey(MEM.selectedSeasonId));
  const shouldReloadFetch = (viewNow === "open" || viewNow === "past") && (isReloadForAdminList() || !hasCache);
  if (shouldReloadFetch) {
    msg.textContent = "Loading latest…";
    const out = await refreshMatchesFromApi(MEM.selectedSeasonId, routeToken);
    if (!stillOnAdmin(routeToken)) return;
    if (!out.ok) {
      msg.textContent = out.error || "Failed to load";
    } else {
      msg.textContent = "";
    }
  }

  // Render view without API
  if (view === "users") {
    // Hide list/manage areas while in Users
    const la = root.querySelector("#listArea");
    const ma = root.querySelector("#manageArea");
    if (la) la.style.display = "none";
    if (ma) ma.style.display = "none";
    setAdminChromeVisible(root, true);
    // season mgmt + create match stay visible on admin header; users render below
    return;
  }

  if (view === "manage" && code) {
    await openManageView(root, code, routeToken, prev || "open");
  } else {
    renderListView(root, (view === "past") ? "past" : "open");
  }
}