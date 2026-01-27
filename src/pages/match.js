// src/pages/match.js
import { API } from "../api/endpoints.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { isReloadForMatchList, isReloadForMatchCode } from "../nav_state.js";
import { getCachedUser } from "../auth.js";

const LS_SEASONS_CACHE = "mlfc_seasons_cache_v1";
const LS_SELECTED_SEASON = "mlfc_selected_season_v1";

const LS_OPEN_CACHE_PREFIX = "mlfc_open_matches_cache_v2:";   // seasonId -> {ts,matches}
const LS_PAST_CACHE_PREFIX = "mlfc_past_matches_cache_v2:";   // seasonId -> {ts,page,pageSize,total,hasMore,matches}
const SS_MATCH_LIST_UI = "mlfc_match_list_ui_v1"; // session-only: {pastOpen, scrollY}
const LS_MATCH_DETAIL_PREFIX = "mlfc_match_detail_cache_v2:"; // code -> {ts,data}
const LS_MATCH_META_PREFIX = "mlfc_matches_meta_v2:";         // seasonId -> {ts,fingerprint,latestCode}
const LS_PLAYERS_CACHE = "mlfc_players_cache_v2";             // {ts,players:[name...]}

const PLAYERS_TTL_MS = 6 * 60 * 60 * 1000;

// Prevent banner/meta re-check from immediately re-rendering / hiding updates
let SUPPRESS_META_ONCE = false;

// Router does not re-render a route if its hash is unchanged.
// When users switch away and back to the Match tab, we still need to check
// for new matches (meta banner). We keep references to the last rendered
// match list root and re-check meta on tab activation.
let ACTIVE_MATCH = { pageRoot: null, listRoot: null, seasonId: "", seasons: [], captainCodes: [] };
let MATCH_META_LAST_CHECK = 0;
let MATCH_META_LISTENERS_INSTALLED = false;

function matchTeamLabel(m, side) {
  const t = String(m?.type || "").toUpperCase();
  if (t === "INTERNAL") return side === "HOME" ? "BLUE" : "ORANGE";
  return side === "HOME" ? "MLFC" : "OPPONENT";
}

function formatResultLabel(m) {
  const a = String(m?.scoreHome ?? "").trim();
  const b = String(m?.scoreAway ?? "").trim();
  if (a === "" || b === "") return "";
  return `${matchTeamLabel(m, "HOME")} ${a} - ${b} ${matchTeamLabel(m, "AWAY")}`;
}

function isMatchRouteActive() {
  const hash = window.location.hash || "#/match";
  return hash.startsWith("#/match");
}

function scheduleMatchMetaCheck(reason = "") {
  // Backend-protection: only check meta when the Match tab is (re)entered.
  // Avoid calling frequently (no polling, no focus spam).
  const t = now();
  const cooldown = reason === "load" || reason === "tab" ? 0 : 15000;
  if (t - MATCH_META_LAST_CHECK < cooldown) return;
  MATCH_META_LAST_CHECK = t;

  if (!ACTIVE_MATCH.pageRoot || !ACTIVE_MATCH.listRoot || !ACTIVE_MATCH.seasonId) return;
  if (!isMatchRouteActive()) return;

  // Only check when list view is visible
  const listEl = ACTIVE_MATCH.pageRoot.querySelector("#matchListView");
  if (!listEl || listEl.style.display === "none") return;

  checkMetaAndShowBanner(ACTIVE_MATCH.pageRoot, ACTIVE_MATCH.seasonId)
    .catch(() => {});
}

function ensureMatchMetaActivationListeners() {
  if (MATCH_META_LISTENERS_INSTALLED) return;
  MATCH_META_LISTENERS_INSTALLED = true;

  // Runs when user navigates to #/match (tab click). Router may skip re-render
  // if the hash is unchanged, but hashchange still fires when the user switches tabs.
  window.addEventListener("hashchange", () => {
    // Only treat this as a "tab enter" when the match route is active.
    if (isMatchRouteActive()) setTimeout(() => scheduleMatchMetaCheck("tab"), 0);
  });
}


function now() { return Date.now(); }
function lsGet(k){ try{return JSON.parse(localStorage.getItem(k)||"null");}catch{return null;} }
function lsSet(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch{} }
function lsDel(k){ try{localStorage.removeItem(k);}catch{} }

function openKey(seasonId){ return `${LS_OPEN_CACHE_PREFIX}${seasonId}`; }
function pastKey(seasonId){ return `${LS_PAST_CACHE_PREFIX}${seasonId}`; }

function ssGet(key){ try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } }
function ssSet(key, val){ try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {} }

function saveMatchListUiState(root) {
  try {
    const past = root.querySelector("#pastSection");
    ssSet(SS_MATCH_LIST_UI, {
      pastOpen: !!past?.open,
      scrollY: Number(window.scrollY || 0),
    });
  } catch {}
}

function restoreMatchListUiState(root) {
  try {
    const s = ssGet(SS_MATCH_LIST_UI);
    if (!s) return;
    const past = root.querySelector("#pastSection");
    if (past && typeof s.pastOpen === "boolean") past.open = s.pastOpen;
    if (Number.isFinite(s.scrollY)) {
      // Restore after the DOM has been painted.
      setTimeout(() => window.scrollTo(0, s.scrollY), 0);
    }
  } catch {}
}
function detailKey(code){ return `${LS_MATCH_DETAIL_PREFIX}${code}`; }
function metaKey(seasonId){ return `${LS_MATCH_META_PREFIX}${seasonId}`; }

function baseUrl(){ return location.href.split("#")[0]; }

function setDisabled(btn, disabled, busyText) {
  if (!btn) return;
  btn.disabled = disabled;

  // Remember original label the first time we show a busy label.
  if (busyText && !btn.dataset.origText) btn.dataset.origText = btn.textContent;

  // If busyText supplied, toggle label based on disabled.
  if (busyText) {
    btn.textContent = disabled ? busyText : (btn.dataset.origText || btn.textContent);
    return;
  }

  // If caller re-enables without passing busyText, still restore original.
  if (!disabled && btn.dataset.origText) {
    btn.textContent = btn.dataset.origText;
  }
}

function uniqueSorted(arr){ return [...new Set(arr)].filter(Boolean).sort((a,b)=>a.localeCompare(b)); }

// Handle both normalized and Sheets Date-string formats
function normalizeDateStr(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function normalizeTimeStr(timeStr) {
  const s = String(timeStr || "").trim();
  if (!s) return "";
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h,m]=s.split(":");
    return `${String(h).padStart(2,"0")}:${m}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function formatHumanDateTime(dateStr, timeStr) {
  const d = normalizeDateStr(dateStr);
  const t = normalizeTimeStr(timeStr);
  if (!d || !t) return `${d||"Unknown date"} ${t||""}`.trim();
  const dt = new Date(`${d}T${t}:00`);
  if (Number.isNaN(dt.getTime())) return `${d} ${t}`;
  return dt.toLocaleString(undefined, {
    weekday:"short", year:"numeric", month:"short", day:"numeric",
    hour:"numeric", minute:"2-digit"
  });
}

// Prefer createdAt (newest first). Fallback to match datetime (soonest first) if missing.
function openMatchSortKey(m) {
  const created = new Date(m?.createdAt || "").getTime();
  if (!Number.isNaN(created) && created > 0) return { type: "created", v: created };
  const d = normalizeDateStr(m?.date);
  const t = normalizeTimeStr(m?.time);
  const dt = new Date(`${d}T${t}:00`).getTime();
  return { type: "dt", v: Number.isNaN(dt) ? 0 : dt };
}

// Find newest match (for LATEST tag)
function getLatestOpenCode(openMatches) {
  const list = Array.isArray(openMatches) ? openMatches : [];
  let best = null;
  for (const m of list) {
    const k = openMatchSortKey(m);
    if (!best) { best = { code: m.publicCode, key: k }; continue; }
    // createdAt wins always; else compare dt
    if (k.type === "created" && best.key.type !== "created") { best = { code: m.publicCode, key: k }; continue; }
    if (k.type === "created" && best.key.type === "created" && k.v > best.key.v) { best = { code: m.publicCode, key: k }; continue; }
    if (k.type === "dt" && best.key.type === "dt" && k.v > best.key.v) { best = { code: m.publicCode, key: k }; continue; }
  }
  return best?.code || "";
}

// Prefetch details for all open matches and store in localStorage cache.
// Runs in background; never blocks UI.
function prefetchOpenMatchDetails(openMatches) {
  // To reduce Cloudflare free-tier API usage, only prefetch on a browser reload of the match list.
  if (!isReloadForMatchList()) return;
  const list = Array.isArray(openMatches) ? openMatches : [];
  const toFetch = list.filter(m => {
    const code = m?.publicCode;
    if (!code) return false;
    const cached = lsGet(detailKey(code));
    return !(cached?.data?.ok);
  });

  if (!toFetch.length) return;

  Promise.all(
    toFetch.map(m =>
      API.getPublicMatch(m.publicCode)
        .then(res => {
          if (res?.ok) {
            lsSet(detailKey(m.publicCode), { ts: now(), data: res });
          }
        })
        .catch(() => {})
    )
  );
}

function seasonsSelectHtml(seasons, selected) {
  const opts = (seasons||[]).map(s => `<option value="${s.seasonId}" ${s.seasonId===selected?"selected":""}>${s.name}</option>`).join("");
  return `
    <div class="row" style="gap:10px; align-items:center; margin-top:10px">
      <div class="small" style="min-width:64px"><b>Season</b></div>
      <select class="input" id="seasonSelect" style="flex:1">${opts}</select>
    </div>
  `;
}


function injectSeasonSelector(root, seasons, seasonId) {
  const seasonBlock = root.querySelector("#seasonBlock");
  if (!seasonBlock) return;

  seasonBlock.innerHTML = seasonsSelectHtml(seasons, seasonId);

  const sel = root.querySelector("#seasonSelect");
  if (!sel) return;

  sel.onchange = () => {
    const sid = sel.value;
    localStorage.setItem(LS_SELECTED_SEASON, sid);

    const c = lsGet(openKey(sid));
    renderMatchList(root, sid, c?.matches || []);
    injectSeasonSelector(root, seasons, sid);
    prefetchOpenMatchDetails(c?.matches || []);

    // Update active season + meta check
    ACTIVE_MATCH.seasonId = sid;
    ACTIVE_MATCH.listRoot = root.querySelector("#matchListView");
    setTimeout(() => scheduleMatchMetaCheck("load"), 0);

    // If this season has no cached open matches yet, fetch once to populate.
    if (!c || !Array.isArray(c.matches)) {
      API.publicOpenMatches(sid)
        .then(res => {
          if (!res?.ok) return;
          lsSet(openKey(sid), { ts: now(), matches: res.matches || [] });
          if (isMatchRouteActive() && ACTIVE_MATCH.seasonId === sid) {
            renderMatchList(root, sid, res.matches || []);
            injectSeasonSelector(root, seasons, sid);
            prefetchOpenMatchDetails(res.matches || []);
          }
        })
        .catch(() => {});
    }
  };
}


const DEFAULT_AVAILABILITY_LIMIT = 22;

function availabilityLimitForMatch(match) {
  const n = Math.floor(Number(match?.availabilityLimit || DEFAULT_AVAILABILITY_LIMIT));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_AVAILABILITY_LIMIT;
  return Math.min(n, 100);
}

function availabilityGroups(av) {
  const byTs = (a, b) => {
    const ta = String(a?.timestamp || "");
    const tb = String(b?.timestamp || "");
    return ta.localeCompare(tb);
  };

  // Keep YES / WAITING list ordering by timestamp (first come, first served).
  const yes = av
    .filter((x) => x.availability === "YES")
    .slice()
    .sort(byTs)
    .map((x) => x.playerName)
    .filter(Boolean);

  const waiting = av
    .filter((x) => x.availability === "WAITING")
    .slice()
    .sort(byTs)
    .map((x) => x.playerName)
    .filter(Boolean);

  // NO is informational only; alphabetical is fine.
  const no = uniqueSorted(av.filter((x) => x.availability === "NO").map((x) => x.playerName));

  return { yes, no, waiting };
}

function whatsappAvailabilityMessage(match, availability) {
  const when = formatHumanDateTime(match.date, match.time);
  const { yes, no, waiting } = availabilityGroups(availability);

  const lines = [];
  lines.push(`match details : ${match.title}`);
  lines.push(`time : ${when}`);
  lines.push(`type : ${match.type}`);
  lines.push(`status : ${match.status}`);
  lines.push("");
  // WhatsApp formatting:
  // - *text* => bold
  // - keep a blank line between headings and lists for readability
  lines.push("*AVAILABILITY*");
  lines.push("");
  (yes.length ? yes : ["-"]).forEach((n, i) => lines.push(`${i + 1}. ${n}`));
  lines.push("");

  lines.push("*NOT AVAILABLE*");
  lines.push("");
  (no.length ? no : ["-"]).forEach((n, i) => lines.push(`${i + 1}. ${n}`));
  lines.push("");

  lines.push("*WAITING LIST*");
  lines.push("");
  (waiting.length ? waiting : ["-"]).forEach((n, i) => lines.push(`${i + 1}. ${n}`));
  lines.push("");
  lines.push(`link : ${baseUrl()}#/match?code=${match.publicCode}`);
  return lines.join("\n");
}

function renderShell(root){
  root.innerHTML = `
    <div id="matchListView"></div>
    <div id="matchDetailView" style="display:none"></div>
  `;
}

async function loadSeasons() {
  const cached = lsGet(LS_SEASONS_CACHE)?.data;
  if (cached?.ok) return cached;

  const res = await API.seasons();
  if (res.ok) lsSet(LS_SEASONS_CACHE, { ts: now(), data: res });
  return res;
}

function pickSelectedSeason(seasonsRes) {
  const seasons = seasonsRes.seasons || [];
  const current = seasonsRes.currentSeasonId || seasons[0]?.seasonId || "";
  const hadStored = !!localStorage.getItem(LS_SELECTED_SEASON);
  let selected = localStorage.getItem(LS_SELECTED_SEASON) || "";
  if (!seasons.some(s=>s.seasonId===selected)) selected = current;
  if (selected) localStorage.setItem(LS_SELECTED_SEASON, selected);
  const defaulted = !hadStored;
  return { seasons, selected, defaulted };
}

async function getPlayersCached() {
  const cached = lsGet(LS_PLAYERS_CACHE);
  // requested: always use cached list; refresh only on Refresh Open button OR manual refresh button
  if (cached?.players?.length) return cached.players;

  // fallback: if missing cache, fetch once
  const res = await API.players();
  if (res.ok) {
    const list = uniqueSorted((res.players || []).map(p => p.name));
    lsSet(LS_PLAYERS_CACHE, { ts: now(), players: list });
    return list;
  }
  return cached?.players || [];
}

// Force refresh players and store in app cache
async function refreshPlayersCache() {
  const res = await API.players();
  if (!res.ok) {
    toastError(res.error || "Failed to refresh players");
    return null;
  }
  const list = uniqueSorted((res.players || []).map(p => p.name));
  lsSet(LS_PLAYERS_CACHE, { ts: now(), players: list });
  toastSuccess("Players refreshed");
  return list;
}

function renderBanner(root, html) {
  const el = root.querySelector("#banner");
  if (!el) return;
  el.innerHTML = html || "";
}

async function checkMetaAndShowBanner(pageRoot, seasonId) {
  // Check meta when Match tab is active (throttled); used for update banner + captain tags.
  const listRoot = pageRoot.querySelector("#matchListView");
  if (!listRoot) return;

  const prev = lsGet(metaKey(seasonId));
  const res = await API.publicMatchesMeta(seasonId);

  if (!res || res.ok !== true) {
    renderBanner(listRoot, "");
    return;
  }

  ACTIVE_MATCH.captainCodes = Array.isArray(res.captainCodes) ? res.captainCodes : [];

  // Update CAPTAIN badges in-place so they show up immediately after a hard refresh
  // (the match list is rendered from cache before meta returns).
  try {
    const codes = new Set(ACTIVE_MATCH.captainCodes || []);
    listRoot.querySelectorAll("[data-captain-badge]").forEach(el => {
      const c = el.getAttribute("data-captain-badge") || "";
      el.style.display = codes.has(c) ? "inline-flex" : "none";
    });
  } catch {}

  const next = { ts: now(), fingerprint: res.fingerprint || "", latestCode: res.latestCode || "" };
  lsSet(metaKey(seasonId), next);

  if (!next.fingerprint) { renderBanner(listRoot, ""); return; }

  const openCache = lsGet(openKey(seasonId));
  const openCodes = (openCache?.matches || []).map(m => m.publicCode);

  // If we *just* refreshed open matches (common on app load / hard refresh),
  // and the latest code is already present, don't show the banner.
  // This fixes a race where the meta call can land before open-matches,
  // leaving the update banner visible even though the list already updated.
  const openWasJustRefreshed = !!(openCache?.ts && (now() - openCache.ts) < 5000);
  const openAlreadyHasLatest = !next.latestCode || openCodes.includes(next.latestCode);

  // When fingerprint changes or latestCode isn't in our cached open list, show update banner
  let isNew =
    !prev?.fingerprint ||
    prev.fingerprint !== next.fingerprint ||
    (next.latestCode && !openCodes.includes(next.latestCode));

  // Race fix: if open matches were refreshed moments ago and already include latestCode,
  // suppress the banner (even if meta fingerprint changed or prev was empty).
  if (isNew && openWasJustRefreshed && openAlreadyHasLatest) {
    isNew = false;
  }

  if (!isNew) { renderBanner(listRoot, ""); return; }

  // Mark open list as potentially stale so clicking Open can refresh from API if needed.
  ACTIVE_MATCH.openListStale = true;

  renderBanner(listRoot, `
    <div class="card" style="border:1px solid rgba(16,185,129,0.35); background: rgba(16,185,129,0.10)">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div style="min-width:0">
          <div style="font-weight:950">Match updates available</div>
          <div class="small">Tap Update to refresh open matches list (scores/captains may have changed).</div>
        </div>
        <div class="row" style="gap:10px; align-items:center">
          <button class="btn primary" id="metaUpdateBtn">Update</button>
          ${next.latestCode ? `<button class="btn gray" id="metaOpenBtn">Open</button>` : ""}
          <button class="btn gray" id="metaCloseBtn" title="Dismiss" style="padding:8px 10px; border-radius:12px">×</button>
        </div>
      </div>
    </div>
  `);

  const closeBtn = listRoot.querySelector("#metaCloseBtn");
  if (closeBtn) closeBtn.onclick = () => { renderBanner(listRoot, ""); };

  const up = listRoot.querySelector("#metaUpdateBtn");
  if (up) up.onclick = async () => {
    // Hide banner immediately so it can't "stick"
    renderBanner(listRoot, "");

    up.disabled = true; up.textContent = "Updating…";

    // Prevent banner/meta re-check from immediately re-rendering / hiding updates
    SUPPRESS_META_ONCE = true;

    const out = await API.publicOpenMatches(seasonId);

    up.disabled = false; up.textContent = "Update";
    if (!out || out.ok !== true) return toastError(out?.error || "Failed to update");

    // Update cache
    lsSet(openKey(seasonId), { ts: now(), matches: out.matches || [] });
    ACTIVE_MATCH.openListStale = false;

    // Update meta cache too so banner won't immediately reappear
    const prevMeta = lsGet(metaKey(seasonId));
    lsSet(metaKey(seasonId), {
      ts: now(),
      fingerprint: prevMeta?.fingerprint || next.fingerprint,
      latestCode: next.latestCode
    });

    // Refresh UI (IMPORTANT: use pageRoot, not listRoot)
    renderMatchList(pageRoot, seasonId, out.matches || []);
    injectSeasonSelector(pageRoot, ACTIVE_MATCH.seasons || [], seasonId);

    // Prefetch details for speed
    prefetchOpenMatchDetails(out.matches || []);

    toastSuccess("Open matches updated.");
  };

  const op = listRoot.querySelector("#metaOpenBtn");
  if (op) op.onclick = () => {
    location.hash = `#/match?code=${encodeURIComponent(next.latestCode)}`;
  };
}


function renderMatchList(root, seasonId, openMatches) {
  const list = root.querySelector("#matchListView");
  const detail = root.querySelector("#matchDetailView");
  list.style.display = "block";
  detail.style.display = "none";

  const latestCode = getLatestOpenCode(openMatches);

  const open = (openMatches || []).slice().sort((a, b) => {
    const ak = openMatchSortKey(a);
    const bk = openMatchSortKey(b);

    if (ak.type === "created" && bk.type === "created") return bk.v - ak.v;
    if (ak.type === "created" && bk.type !== "created") return -1;
    if (ak.type !== "created" && bk.type === "created") return 1;

    return ak.v - bk.v;
  });

  list.innerHTML = `
    <div class="card">
      <div class="h1">Matches</div>
      <div class="small">Open matches load from cache. Refresh your browser to fetch the latest (or tap Update in the banner).</div>

      <div id="seasonBlock"></div>

      <div id="banner" style="margin-top:10px"></div>
    </div>

    <div class="card">
      <div class="h1">Open matches</div>
      ${
        open.length
          ? open.map(m=>`
            <div style="padding:10px 0; border-bottom:1px solid rgba(11,18,32,0.10)">
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
                <div style="font-weight:950">${m.title}</div>
                ${m.publicCode === latestCode ? `<span class="badge" style="background:#16a34a;color:#fff">LATEST</span>` : ""}
                <span class="badge" data-captain-badge="${m.publicCode}" style="background:#111827;color:#fff; display:${ACTIVE_MATCH.captainCodes?.includes?.(m.publicCode) ? "inline-flex" : "none"}">CAPTAIN</span>
              </div>
              <div class="small">${formatHumanDateTime(m.date,m.time)} • ${m.type} • ${m.status}</div>
              ${formatResultLabel(m) ? `<div class="small" style="margin-top:4px"><b>Result:</b> ${formatResultLabel(m)}</div>` : ``}
              <div class="row" style="margin-top:8px">
                <button class="btn primary" data-open="${m.publicCode}">Open</button>
              </div>
            </div>
          `).join("")
          : `<div class="small">No open matches.</div>`
      }
    </div>

    <details class="card" id="pastSection">
      <summary style="font-weight:950">Past matches</summary>
      <div class="small" style="margin-top:8px">Past matches only load when you tap Refresh Past.</div>
      <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
        <button class="btn primary" id="refreshPast">Refresh Past</button>
      </div>
      <div id="pastArea" style="margin-top:10px"></div>
    </details>
  `;

  list.querySelectorAll("[data-open]").forEach(btn=>{
    btn.onclick = async () => {
      const code = btn.getAttribute("data-open");
      if (!code) return;

      // If meta says our open list is stale (score/captain changes), refresh once before opening.
      if (ACTIVE_MATCH.openListStale) {
        try {
          const out = await API.publicOpenMatches(seasonId);
          if (out?.ok) {
            lsSet(openKey(seasonId), { ts: now(), matches: out.matches || [] });
            ACTIVE_MATCH.openListStale = false;
          }
        } catch {}
      }

      // Remember UI state so that when user returns, Past section stays open and scroll position is kept.
      saveMatchListUiState(root);
      location.hash = `#/match?code=${encodeURIComponent(code)}`;
    };
  });

  // Per requirement: no Refresh Open / Clear cache buttons here.
  // Latest open matches are fetched only on browser reload (or via meta banner Update).

  list.querySelector("#refreshPast").onclick = async () => {
    const btn = list.querySelector("#refreshPast");
    setDisabled(btn,true,"Refreshing…");
    const res = await API.publicPastMatches(seasonId, 1, 20);
    setDisabled(btn,false);
    if (!res.ok) return toastError(res.error||"Failed");
    lsSet(pastKey(seasonId), { ts: now(), ...res });
    renderPastArea(root, seasonId);
    toastSuccess("Past matches refreshed.");
  };

  renderPastArea(root, seasonId);

  // Remember/restore list view UI state (Past open/closed, scroll position) when returning from a match.
  restoreMatchListUiState(root);

  if (SUPPRESS_META_ONCE) {
    SUPPRESS_META_ONCE = false;
    renderBanner(list, ""); // ensure banner disappears after update
  } else {
    checkMetaAndShowBanner(root, seasonId).catch(()=>{});

  }
}

function renderPastArea(root, seasonId) {
  const pastArea = root.querySelector("#pastArea");
  if (!pastArea) return;

  const cache = lsGet(pastKey(seasonId));
  const items = cache?.matches || [];
  pastArea.innerHTML = items.length
    ? items.map(m=>`
        <div style="padding:10px 0; border-bottom:1px solid rgba(11,18,32,0.10)">
          <div style="font-weight:950">${m.title}</div>
          <div class="small">${formatHumanDateTime(m.date,m.time)} • ${m.type} • ${m.status}</div>
          ${formatResultLabel(m) ? `<div class="small" style="margin-top:4px"><b>Result:</b> ${formatResultLabel(m)}</div>` : ``}
          <div class="row" style="margin-top:8px">
            <button class="btn gray" data-open="${m.publicCode}">View</button>
          </div>
        </div>
      `).join("")
    : `<div class="small">No past matches cached yet.</div>`;

  pastArea.querySelectorAll("[data-open]").forEach(btn=>{
    btn.onclick=()=>{
      saveMatchListUiState(root);
      location.hash = `#/match?code=${encodeURIComponent(btn.getAttribute("data-open"))}`;
    };
  });
}

async function renderMatchDetail(root, code) {
  const detail = root.querySelector("#matchDetailView");
  const list = root.querySelector("#matchListView");
  list.style.display = "none";
  detail.style.display = "block";

  const cached = lsGet(detailKey(code))?.data;
  let data = cached;

  // If match meta fingerprint changed since we cached this detail, force a refetch.
  let metaChanged = false;
  try {
    const sid = cached?.match?.seasonId || ACTIVE_MATCH.seasonId || lsGet(LS_SELECTED_SEASON);
    const currentFp = sid ? lsGet(metaKey(sid))?.fingerprint : "";
    const cachedFp = lsGet(detailKey(code))?.metaFingerprint;
    if (currentFp && cachedFp && currentFp !== cachedFp) metaChanged = true;
  } catch {}

  // Fetch match details only on browser reload of this match, or if not cached.
  const shouldFetch = isReloadForMatchCode(code) || !data?.ok || metaChanged;

  if (shouldFetch) {
    if (!data?.ok) {
      detail.innerHTML = `<div class="card"><div class="h1">Loading…</div><div class="small">Fetching match…</div></div>`;
    }

    const res = await API.getPublicMatch(code);
    if (!res.ok) {
      detail.innerHTML = `<div class="card"><div class="h1">Error</div><div class="small">${res.error}</div></div>`;
      return toastError(res.error||"Failed");
    }
    data = res;
    // Remember current meta fingerprint so we can detect changes later.
    let fp = "";
    try {
      const sid = data?.match?.seasonId || ACTIVE_MATCH.seasonId || lsGet(LS_SELECTED_SEASON);
      fp = sid ? String(lsGet(metaKey(sid))?.fingerprint || "") : "";
    } catch {}
    lsSet(detailKey(code), { ts: now(), data, metaFingerprint: fp });
  }

  const m = data.match;
  const when = formatHumanDateTime(m.date, m.time);
  const status = String(m.status||"").toUpperCase();
  const me = getCachedUser();
  const meName = String(me?.name || "").trim();
  const meIsAdmin = !!me?.isAdmin;

  let availability = (data.availability || []).map(a=>({
    playerName: String(a.playerName||"").trim(),
    availability: String(a.availability||"").toUpperCase()
  })).filter(x=>x.playerName);

  function renderAvailLists() {
    const g = availabilityGroups(availability);
    const cap = availabilityLimitForMatch(m);
    const yesCount = Math.min(g.yes.length, cap);

    const yesHdr = detail.querySelector("#yesHdr");
    if (yesHdr) yesHdr.textContent = `Available (${yesCount}/${cap})`;

    detail.querySelector("#yesList").innerHTML = g.yes.map(p=>`<li>${p}</li>`).join("") || "<li>-</li>";
    detail.querySelector("#noList").innerHTML = g.no.map(p=>`<li>${p}</li>`).join("") || "<li>-</li>";
    detail.querySelector("#waitList").innerHTML = g.waiting.map(p=>`<li>${p}</li>`).join("") || "<li>-</li>";

    // Waiting list button is only enabled once quota is reached.
    // Exception: after admin closes availability, people can still opt into the waiting list.
    const btnWait = detail.querySelector("#btnWait");
    if (btnWait) {
      const quotaReached = yesCount >= cap;
      const allowWait = quotaReached || adminClosed;
      btnWait.disabled = !meName || !allowWait;
      btnWait.title = allowWait ? "" : `Waiting list unlocks when ${cap} players are available.`;
    }
  }

  const caps = data.captains || {};
  const isCaptain = !!meName && [caps.captain1, caps.captain2].some(c => String(c || "").trim().toLowerCase() === meName.toLowerCase());

  const teamsSelected = Array.isArray(data.teams) && data.teams.length > 0;
  // Availability should NOT auto-close when captains are selected.
  // Instead, admin can explicitly close availability (match.availabilityLocked=1), and ratings lock will also close it.
  const adminClosed = Number(m.availabilityLocked || 0) === 1;
  const ratingsClosed = Number(m.ratingsLocked || 0) === 1 || String(m.ratingsLocked || "").toUpperCase() === "TRUE";
  const availabilityClosed = adminClosed || ratingsClosed;
  // Captains should only proceed once availability is explicitly closed (admin button / ratings lock).
  const captainPageEnabled = !!availabilityClosed;
  // Availability visibility should depend only on availabilityClosed (admin button / ratings lock),
  // NOT on whether captains/teams have been selected.
  const hideAvailability = false;
  const teamForPlayer = {};
  (data.teams || []).forEach(t=>{ const pn=String(t.playerName||'').trim(); const tm=String(t.team||'').trim(); if(pn&&tm) teamForPlayer[pn]=tm; });
  const scoreHome = String(m.scoreHome ?? "").trim();
  const scoreAway = String(m.scoreAway ?? "").trim();
  const hasScore = scoreHome !== "" && scoreAway !== "";

  function teamLabel(side) {
    // side: "HOME" | "AWAY"
    const t = String(m.type || "").toUpperCase();
    if (t === "INTERNAL") return side === "HOME" ? "BLUE" : "ORANGE";
    return side === "HOME" ? "MLFC" : "OPPONENT";
  }

  function resultInline() {
    if (!hasScore) return "";
    return `${teamLabel("HOME")} ${scoreHome} - ${scoreAway} ${teamLabel("AWAY")}`;
  }

  // Build scorers list from events (if backend provided it)
  const events = Array.isArray(data.events) ? data.events : [];
  const scorerMap = {};
  for (const e of events) {
    const n = String(e?.playerName || "").trim();
    const g = Number(e?.goals ?? 0);
    const a = Number(e?.assists ?? 0);
    if (!n) continue;
    if (!scorerMap[n]) scorerMap[n] = { goals: 0, assists: 0, team: teamForPlayer[n] || "" };
    if (Number.isFinite(g)) scorerMap[n].goals += Math.max(0, Math.floor(g));
    if (Number.isFinite(a)) scorerMap[n].assists += Math.max(0, Math.floor(a));
    if (!scorerMap[n].team && teamForPlayer[n]) scorerMap[n].team = teamForPlayer[n];
  }
  const scorers = Object.entries(scorerMap)
    .filter(([_, v]) => (v.goals || 0) > 0)
    .sort((a, b) => (b[1].goals - a[1].goals) || a[0].localeCompare(b[0]))
    .map(([name, v]) => ({ name, goals: v.goals, assists: v.assists, team: v.team || "" }));

  // Group scorers by team when possible
  const scorersByTeam = {};
  for (const s of scorers) {
    const t = String(s.team || "").trim().toUpperCase() || "UNKNOWN";
    if (!scorersByTeam[t]) scorersByTeam[t] = [];
    scorersByTeam[t].push(s);
  }


  detail.innerHTML = `
    <div class="card">
      <div style="font-weight:950; font-size:18px">${m.title}</div>
      <div class="small" style="margin-top:6px">${when} • ${m.type} • ${m.status}</div>
      <div class="small" id="detailMsg" style="margin-top:10px">Refresh your browser to reload match details from the server.</div>
      ${isCaptain ? `
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          ${isCaptain ? `<span class="badge">CAPTAIN</span>` : ``}
          <button class="btn primary" id="openCaptain" ${captainPageEnabled ? "" : "disabled"} title="${captainPageEnabled ? "" : "Captain page unlocks after availability is closed by admin."}">Open captain page</button>
        </div>
        ${captainPageEnabled ? `` : `<div class="small" style="margin-top:8px"><b>Note:</b> Captain page will unlock after admin closes availability.</div>`}
      ` : ``}
    </div>

    ${hasScore ? `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">
          <div class="h1">Match result</div>
          <div class="small"><b>${resultInline()}</b></div>
        </div>

        <div class="small" style="margin-top:8px">
          <b>Home:</b> ${m.type === "INTERNAL" ? "BLUE" : "MLFC"} &nbsp; • &nbsp; <b>Away:</b> ${m.type === "INTERNAL" ? "ORANGE" : "OPPONENT"}
        </div>

        ${scorers.length ? `
          <div class="small" style="margin-top:10px"><b>Scorers</b></div>
          <div class="small" style="margin-top:6px">
            ${
              Object.keys(scorersByTeam).length > 1
                ? Object.entries(scorersByTeam)
                    .map(([team, list]) => `<div style="margin-top:6px"><b>${team}:</b> ${list.map(s => `${s.name} (${s.goals})`).join(" • ")}</div>`)
                    .join("")
                : `${scorers.map(s => `${s.name} (${s.goals})`).join(" • ")}`
            }
          </div>
        ` : ``}
      </div>
    ` : ``}

    ${hideAvailability ? `` : `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center">
          <div class="h1">Availability</div>
          <div class="row" style="gap:10px; align-items:center">
            <button class="btn primary" id="shareBtn">Share</button>
          </div>
        </div>

        ${
          status === "OPEN"
            ? `
              ${ratingsClosed
                ? `<div class="small"><b>Availability is closed.</b></div>`
                : (adminClosed
                    ? `<div class="small"><b>Availability is closed.</b> You can still switch to <b>NO</b> or join the <b>waiting list</b> if you can't make it.</div>`
                    : (meName
                        ? `<div class="small">Logged in as <b>${meName}</b>. Tap YES/NO to post your availability. If the match is full (${cap} available), you can join the waiting list.</div>`
                        : `<div class="small">Login required to post availability.</div>`))}
              ${meName ? `` : `
                <div class="small" style="margin-top:10px">Go to <b>Login</b> tab to sign in.</div>
              `}
              ${ratingsClosed ? `` : `
                <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
                  ${adminClosed ? `` : `<button class="btn good" id="btnYes" ${meName ? "" : "disabled"}>YES</button>`}
                  <button class="btn bad" id="btnNo" ${meName ? "" : "disabled"}>NO</button>
                  <button class="btn warn" id="btnWait" disabled>WAITING LIST</button>
                </div>

                <div class="small" id="saveMsg" style="margin-top:10px"></div>
              `}
            `
            : `<div class="small">This match is not open.</div>`
        }

        <div class="hr"></div>

        <div class="small"><b id="yesHdr">Available</b></div>
        <ol id="yesList" class="list"></ol>

        <div class="small" style="margin-top:10px"><b>Not available</b></div>
        <ol id="noList" class="list"></ol>

        <div class="small" style="margin-top:10px"><b>Waiting list</b></div>
        <ol id="waitList" class="list"></ol>
      </div>
    `}
  `;

  const shareBtn = detail.querySelector("#shareBtn");
  if (shareBtn) {
    shareBtn.onclick = () => {
      const msg = whatsappAvailabilityMessage(m, availability);
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
      toastInfo("WhatsApp opened.");
    };
  }

  const capBtn = detail.querySelector("#openCaptain");
  if (capBtn) capBtn.onclick = () => {
    if (!captainPageEnabled) return toastWarn("Captain page unlocks after availability is closed by admin.");
    location.hash = `#/captain?code=${encodeURIComponent(code)}&src=match`;
  };

  if (!hideAvailability) {
    renderAvailLists();
  }

  // If admin closed availability, players can still change to NO/WAITING.
  // If ratings are locked (or match isn't open), do not allow changes.
  if (hideAvailability || status !== "OPEN" || ratingsClosed) return;


  async function submit(choice) {
    if (!meName) return toastWarn("Please login first.");

    if (adminClosed && String(choice || "").toUpperCase() === "YES") {
      return toastWarn("Availability is closed — you can only set NO or WAITING.");
    }

    const y = detail.querySelector("#btnYes");
    const n = detail.querySelector("#btnNo");
    const w = detail.querySelector("#btnWait");
    if (y) y.disabled = true;
    if (n) n.disabled = true;
    if (w) w.disabled = true;

    const saveMsg = detail.querySelector("#saveMsg");
    saveMsg.textContent = "Saving…";

    const res = await API.setAvailability(code, choice);

    if (!res.ok) {
      saveMsg.textContent = res.error || "Failed";
      toastError(res.error || "Failed to post availability");
      y.disabled = false; n.disabled = false; renderAvailLists();
      return;
    }

    // Only update UI lists after backend save succeeds.
// Reload list from server so we always reflect latest (others may submit at the same time).
if (Array.isArray(res.availability)) {
  availability = res.availability.map(a=>({
    playerName: String(a.playerName||"").trim(),
    availability: String(a.availability||"").toUpperCase()
  })).filter(x=>x.playerName);
} else {
  // Fallback: keep local behavior if backend didn't return list
  const idx = availability.findIndex(a => a.playerName.toLowerCase() === meName.toLowerCase());
  if (idx >= 0) availability[idx].availability = choice;
  else availability.push({ playerName: meName, availability: choice });
}
renderAvailLists();


    const effective = String(res.effectiveAvailability || choice || "").toUpperCase();
    saveMsg.textContent = "Saved ✅";
    toastSuccess(`Saved: ${effective}`);

    const merged = { ...data, availability };
    lsSet(detailKey(code), { ts: now(), data: merged });

    // const msg = whatsappAvailabilityMessage(m, availability);
    // window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    // toastInfo("WhatsApp opened (tap Send).");

    // Re-enable buttons, but keep Waiting List rule enforced.
    setTimeout(()=>{ y.disabled=false; n.disabled=false; renderAvailLists(); }, 900);
  }

  const btnYes = detail.querySelector("#btnYes");
  const btnNo = detail.querySelector("#btnNo");
  const btnWait = detail.querySelector("#btnWait");
  if (btnYes) btnYes.onclick = () => submit("YES");
  if (btnNo) btnNo.onclick = () => submit("NO");
  if (btnWait) btnWait.onclick = () => submit("WAITING");
}

export async function renderMatchPage(root, query) {
  ensureMatchMetaActivationListeners();
  renderShell(root);

  const code = query.get("code");
  if (code) {
    await renderMatchDetail(root, code);
    return;
  }

  const seasonsRes = await loadSeasons();
  if (!seasonsRes.ok) {
    toastError(seasonsRes.error || "Failed to load seasons");
    return;
  }

  const { seasons, selected, defaulted } = pickSelectedSeason(seasonsRes);
  const seasonId = selected;

  const openCached = lsGet(openKey(seasonId));
  const openMatches = openCached?.matches || [];

  // Render immediately from cache.
  renderMatchList(root, seasonId, openMatches);
  injectSeasonSelector(root, seasons, seasonId);

  // Re-fetch open matches ONLY when the user does a browser reload.
  // (Or when cache is empty for the first time.)
  const needInitial = !openMatches.length;
  // Reload open matches from API ONLY if the browser reload happened on the list view
  // (not when navigating back from a match detail).
  // If user never selected a season, default to latest season and fetch open matches once.
  // Also fetch when cache is empty, or when browser reload happened on list.
  const shouldReloadFetch = isReloadForMatchList() || needInitial;
  if (shouldReloadFetch) {
    // If we already rendered cached data, refresh in the background.
    // If no cache, this will populate the list once it returns.
    API.publicOpenMatches(seasonId)
      .then(res => {
        if (!res?.ok) return;
        lsSet(openKey(seasonId), { ts: now(), matches: res.matches || [] });
        // Only update UI if we're still on list view for this season.
        if (!isMatchRouteActive()) return;
        const currentListVisible = root.querySelector("#matchListView")?.style?.display !== "none";
        const currentSeason = ACTIVE_MATCH?.seasonId || seasonId;
        if (currentListVisible && currentSeason === seasonId) {
          renderMatchList(root, seasonId, res.matches || []);
          injectSeasonSelector(root, seasons, seasonId);
          prefetchOpenMatchDetails(res.matches || []);
        }
      })
      .catch(() => {});
  }

  // Save active refs for activation meta checks
  ACTIVE_MATCH.seasons = seasons;
  ACTIVE_MATCH.pageRoot = root;
  ACTIVE_MATCH.listRoot = root.querySelector('#matchListView');
  ACTIVE_MATCH.seasonId = seasonId;
  // Meta check only on initial load / tab enter (backend-friendly)
  setTimeout(() => scheduleMatchMetaCheck("load"), 0);

  // Prefetch details for all cached open matches immediately (background)
  prefetchOpenMatchDetails(openMatches);

}