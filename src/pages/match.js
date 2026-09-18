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
const LS_NEXT_MATCH_PREFIX = "mlfc_next_match_cache_v1:";     // player name -> {ts,data}

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
let MATCH_OPEN_AUTO_REFRESH_INSTALLED = false;
let MATCH_OPEN_REFRESH_INFLIGHT = false;
let MATCH_OPEN_LAST_REFRESH_TS = 0;
let NEXT_MATCH_COUNTDOWN_TIMER = null;

const MATCH_OPEN_CACHE_MAX_AGE_MS = 60 * 1000;
const MATCH_OPEN_REFRESH_COOLDOWN_MS = 15 * 1000;

function matchTeamLabel(m, side) {
  const t = String(m?.type || "").toUpperCase();
  if (t === "INTERNAL") return side === "HOME"
    ? String(m?.teamHomeName || "Blue")
    : String(m?.teamAwayName || "Orange");
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

function shouldRefreshOpenMatches(seasonId, { force = false } = {}) {
  if (force) return true;
  if (!isMatchRouteActive()) return false;
  if (!ACTIVE_MATCH.pageRoot || !ACTIVE_MATCH.listRoot) return false;

  const listEl = ACTIVE_MATCH.pageRoot.querySelector("#matchListView");
  if (!listEl || listEl.style.display === "none") return false;

  const cache = lsGet(openKey(seasonId));
  const age = now() - Number(cache?.ts || 0);
  return !cache?.matches || age > MATCH_OPEN_CACHE_MAX_AGE_MS;
}

async function refreshOpenMatches(root, seasons, seasonId, { force = false } = {}) {
  if (MATCH_OPEN_REFRESH_INFLIGHT) return;
  if (!shouldRefreshOpenMatches(seasonId, { force })) return;

  const t = now();
  if (!force && t - MATCH_OPEN_LAST_REFRESH_TS < MATCH_OPEN_REFRESH_COOLDOWN_MS) return;

  MATCH_OPEN_REFRESH_INFLIGHT = true;
  MATCH_OPEN_LAST_REFRESH_TS = t;
  try {
    const res = await API.publicOpenMatches(seasonId);
    if (!res?.ok) return;

    lsSet(openKey(seasonId), { ts: now(), matches: res.matches || [] });
    if (!isMatchRouteActive()) return;

    const activeSeason = ACTIVE_MATCH?.seasonId;
    const listVisible = ACTIVE_MATCH.pageRoot?.querySelector("#matchListView")?.style?.display !== "none";
    if (!listVisible || activeSeason !== seasonId) return;

    renderMatchList(root, seasonId, res.matches || []);
    injectSeasonSelector(root, seasons || ACTIVE_MATCH.seasons || [], seasonId);
    prefetchOpenMatchDetails(res.matches || []);
  } catch {
    // silent background refresh
  } finally {
    MATCH_OPEN_REFRESH_INFLIGHT = false;
  }
}

function ensureMatchOpenLifecycleRefresh() {
  if (MATCH_OPEN_AUTO_REFRESH_INSTALLED) return;
  MATCH_OPEN_AUTO_REFRESH_INSTALLED = true;

  const trigger = (force = false) => {
    const root = ACTIVE_MATCH.pageRoot;
    const seasonId = ACTIVE_MATCH.seasonId;
    if (!root || !seasonId) return;
    refreshOpenMatches(root, ACTIVE_MATCH.seasons || [], seasonId, { force }).catch(() => {});
  };

  window.addEventListener("hashchange", () => {
    if (isMatchRouteActive()) trigger(false);
  });

  window.addEventListener("focus", () => trigger(false));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) trigger(false);
  });

  // A restored connection is a meaningful refresh point. There is deliberately
  // no interval here: background polling wastes Worker/D1 quota while the app is
  // idle, whereas route entry, foregrounding, reconnect and push cover changes.
  window.addEventListener("online", () => trigger(false));
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
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

// Matchday order follows kick-off time. Creation order is irrelevant to players.
function openMatchSortKey(m) {
  const d = normalizeDateStr(m?.date);
  const t = normalizeTimeStr(m?.time);
  const dt = new Date(`${d}T${t}:00`).getTime();
  return { type: "dt", v: Number.isNaN(dt) ? Number.MAX_SAFE_INTEGER : dt };
}

function isUpcomingFixture(match, referenceTime = Date.now()) {
  const kickoff = openMatchSortKey(match).v;
  const hasFinalScore = String(match?.scoreHome ?? "").trim() !== "" &&
    String(match?.scoreAway ?? "").trim() !== "";
  return !hasFinalScore && kickoff !== Number.MAX_SAFE_INTEGER && kickoff >= referenceTime;
}

// Find the next scheduled match.
function getLatestOpenCode(openMatches) {
  const list = (Array.isArray(openMatches) ? openMatches : []).filter((match) => isUpcomingFixture(match));
  list.sort((a, b) => openMatchSortKey(a).v - openMatchSortKey(b).v);
  return list[0]?.publicCode || "";
}

// Prefetch details for all open matches and store in localStorage cache.
// Runs in background; never blocks UI.
function prefetchOpenMatchDetails(openMatches) {
  // To reduce Cloudflare free-tier API usage, only prefetch on a browser reload of the match list.
  if (!isReloadForMatchList()) return;
  const list = Array.isArray(openMatches) ? openMatches.slice(0, 3) : [];
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
      <label class="field__label" for="seasonSelect" style="min-width:64px">Season</label>
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

function nextMatchCacheKey() {
  const name = String(getCachedUser()?.name || "player").trim().toLowerCase();
  return `${LS_NEXT_MATCH_PREFIX}${name}`;
}

function matchDateTime(match) {
  const date = normalizeDateStr(match?.date);
  const time = normalizeTimeStr(match?.time) || "00:00";
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function countdownLabel(match) {
  const fixtureTime = matchDateTime(match);
  if (!fixtureTime) return "Date to be confirmed";
  const difference = fixtureTime.getTime() - Date.now();
  if (difference <= 0) return "Matchday is here";
  const minutes = Math.max(1, Math.ceil(difference / 60000));
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Starts in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} to kick-off`;
}

function availabilityPresentation(availability) {
  const status = String(availability?.status || "NOT_RESPONDED").toUpperCase();
  if (status === "YES") return { label: "Available", tone: "yes", detail: "You’re on the availability list." };
  if (status === "NO") return { label: "Not available", tone: "no", detail: "You’ve told the club you can’t play." };
  if (status === "WAITING") {
    const position = Number(availability?.waitingPosition || 0);
    return { label: "Waiting list", tone: "waiting", detail: position ? `You’re number ${position} in the queue.` : "You’re in the queue." };
  }
  return { label: "Response needed", tone: "pending", detail: "Let the club know if you can play." };
}

function renderNextMatchDashboard(host, data) {
  if (!host) return;
  const match = data?.nextMatch;
  if (!match) {
    host.innerHTML = `
      <section class="nextMatch nextMatch--empty" aria-labelledby="nextMatchTitle">
        <div><div class="nextMatch__eyebrow">Your matchday</div><h1 id="nextMatchTitle">No fixture on deck</h1></div>
        <p>There isn’t an open match right now. The next club fixture will appear here when it is published.</p>
      </section>`;
    return;
  }

  const availability = availabilityPresentation(match.availability);
  const assignment = match.assignment || {};
  const score = match.score || {};
  const hasScore = String(score.home ?? "") !== "" && String(score.away ?? "") !== "";
  const team = String(assignment.team || "").toUpperCase();
  const teamName = String(assignment.teamName || team);
  const captainTeamName = String(match.teamNames?.[String(assignment.captainTeam || team).toUpperCase() === "ORANGE" ? "away" : "home"] || teamName);
  const captainLabel = assignment.isCaptain ? `Captain · ${captainTeamName}` : "";
  const action = match.contextualAction || null;
  const canRespond = Boolean(match.availability?.canRespond);
  const availabilityStatus = String(match.availability?.status || "NOT_RESPONDED").toUpperCase();
  const hasAvailabilityResponse = ["YES", "NO", "WAITING"].includes(availabilityStatus);
  const showResponse = canRespond && !hasAvailabilityResponse && (!action || action.type === "RESPOND");
  const result = data?.latestResult;

  host.innerHTML = `
    <section class="nextMatch" aria-labelledby="nextMatchTitle">
      <div class="nextMatch__pitch" aria-hidden="true"></div>
      <header class="nextMatch__head">
        <div>
          <div class="nextMatch__eyebrow">Your next fixture</div>
          <h1 id="nextMatchTitle">${escapeHtml(match.title)}</h1>
          <p>${escapeHtml(formatHumanDateTime(match.date, match.time))} <span aria-hidden="true">·</span> ${escapeHtml(match.type)}</p>
        </div>
        <div class="nextMatch__countdown" data-next-countdown aria-live="off">${escapeHtml(countdownLabel(match))}</div>
      </header>

      <div class="nextMatch__stateGrid">
        <div class="nextMatch__state">
          <span class="nextMatch__label">Availability</span>
          <strong class="statusPill statusPill--${availability.tone}"><span aria-hidden="true">${availability.tone === "yes" ? "✓" : availability.tone === "no" ? "×" : availability.tone === "waiting" ? "↗" : "!"}</span>${escapeHtml(availability.label)}</strong>
          <small>${escapeHtml(availability.detail)}</small>
        </div>
        <div class="nextMatch__state">
          <span class="nextMatch__label">Your role</span>
          <strong>${team ? escapeHtml(`${teamName} team`) : "Team not assigned"}</strong>
          <small>${captainLabel ? escapeHtml(captainLabel) : team ? "Player" : "Check back after team selection."}</small>
        </div>
        <div class="nextMatch__state">
          <span class="nextMatch__label">Match status</span>
          <strong>${hasScore ? escapeHtml(`${score.home || "–"} — ${score.away || "–"}`) : "Fixture open"}</strong>
          <small>${hasScore ? (score.complete ? "Final score" : "Score entry in progress") : "Awaiting kick-off"}</small>
        </div>
      </div>

      <footer class="nextMatch__actions">
        ${showResponse ? `
          <div class="quickResponse" role="group" aria-label="Set your availability">
            <button class="btn quickResponse__yes" type="button" data-next-response="YES"><span aria-hidden="true">✓</span> Yes, I can play</button>
            <button class="btn quickResponse__no" type="button" data-next-response="NO"><span aria-hidden="true">×</span> No, I’m unavailable</button>
          </div>` : ""}
        ${hasAvailabilityResponse && canRespond ? `<button class="btn primary nextMatch__primary" type="button" data-next-open="${escapeHtml(match.publicCode)}">Update availability</button>` : ""}
        ${!hasAvailabilityResponse && action && action.type !== "RESPOND" ? `<button class="btn primary nextMatch__primary" type="button" data-next-open="${escapeHtml(action.publicCode || match.publicCode)}">${escapeHtml(action.label)}</button>` : ""}
        ${!hasAvailabilityResponse && !showResponse && (!action || action.type === "RESPOND") ? `<button class="btn gray nextMatch__primary" type="button" data-next-open="${escapeHtml(match.publicCode)}">View match</button>` : ""}
        ${hasAvailabilityResponse && !canRespond ? `<button class="btn gray nextMatch__primary" type="button" data-next-open="${escapeHtml(match.publicCode)}">View match</button>` : ""}
      </footer>

      ${result ? `<div class="nextMatch__lastResult"><span>Last result</span><b>${escapeHtml(result.title)}</b><strong>${escapeHtml(`${result.score?.home ?? "–"} — ${result.score?.away ?? "–"}`)}</strong></div>` : ""}
    </section>`;

  host.querySelectorAll("[data-next-open]").forEach((button) => {
    button.onclick = () => {
      const code = button.getAttribute("data-next-open");
      if (code) location.hash = `#/match?code=${encodeURIComponent(code)}`;
    };
  });

  host.querySelectorAll("[data-next-response]").forEach((button) => {
    button.onclick = async () => {
      const choice = button.getAttribute("data-next-response");
      const buttons = [...host.querySelectorAll("[data-next-response]")];
      buttons.forEach((item) => { item.disabled = true; });
      button.textContent = "Saving…";
      const response = await API.setAvailability(match.publicCode, choice);
      if (!response?.ok) {
        buttons.forEach((item) => { item.disabled = false; });
        button.innerHTML = choice === "YES" ? '<span aria-hidden="true">✓</span> Yes, I can play' : '<span aria-hidden="true">×</span> No, I’m unavailable';
        toastError(response?.error || "Your availability could not be saved. Try again.");
        return;
      }
      lsDel(nextMatchCacheKey());
      lsDel(detailKey(match.publicCode));
      toastSuccess(choice === "YES" ? "You’re marked as available." : "You’re marked as unavailable.");
      await loadNextMatchDashboard(host, { force: true });
    };
  });

  if (NEXT_MATCH_COUNTDOWN_TIMER) clearInterval(NEXT_MATCH_COUNTDOWN_TIMER);
  NEXT_MATCH_COUNTDOWN_TIMER = setInterval(() => {
    if (!document.body.contains(host) || !isMatchRouteActive()) {
      clearInterval(NEXT_MATCH_COUNTDOWN_TIMER);
      NEXT_MATCH_COUNTDOWN_TIMER = null;
      return;
    }
    const countdown = host.querySelector("[data-next-countdown]");
    if (countdown) countdown.textContent = countdownLabel(match);
  }, 60000);
}

async function loadNextMatchDashboard(host, { force = false } = {}) {
  if (!host) return;
  const key = nextMatchCacheKey();
  const cached = lsGet(key);
  const fresh = cached?.data?.ok && now() - Number(cached.ts || 0) < 2 * 60 * 1000;
  if (cached?.data?.ok) renderNextMatchDashboard(host, cached.data);
  if (!force && fresh) return;

  const response = await API.myNextMatch();
  if (!document.body.contains(host)) return;
  if (response?.ok) {
    lsSet(key, { ts: now(), data: response });
    renderNextMatchDashboard(host, response);
    return;
  }
  if (cached?.data?.ok) return;
  host.innerHTML = `
    <section class="nextMatch nextMatch--error" role="status">
      <div><div class="nextMatch__eyebrow">Your matchday</div><h1>Next fixture unavailable</h1></div>
      <p>${escapeHtml(response?.error || "Check your connection, then try again.")}</p>
      <button class="btn gray" type="button" data-next-retry>Try again</button>
    </section>`;
  host.querySelector("[data-next-retry]")?.addEventListener("click", () => loadNextMatchDashboard(host, { force: true }));
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
          <button class="btn gray iconButton" id="metaCloseBtn" aria-label="Dismiss update notice">×</button>
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

  const open = (openMatches || []).filter((match) => isUpcomingFixture(match)).sort((a, b) => {
    const ak = openMatchSortKey(a);
    const bk = openMatchSortKey(b);

    return ak.v - bk.v;
  });
  const latestCode = getLatestOpenCode(open);

  list.innerHTML = `
    <div id="nextMatchDashboard" class="nextMatchHost" aria-live="polite">
      <section class="nextMatch nextMatch--loading" aria-label="Loading your next fixture">
        <div class="nextMatch__eyebrow">Your matchday</div><div class="nextMatch__skeleton"></div>
      </section>
    </div>
    <div class="card matchBoard">
      <div class="matchBoard__header">
        <div>
          <div class="matchCentreIntro__eyebrow">Match centre · Live schedule</div>
          <div class="h1">Upcoming fixtures</div>
        </div>
        <span class="matchBoard__count">${open.length} ${open.length === 1 ? "fixture" : "fixtures"}</span>
      </div>
      <div class="matchBoard__toolbar"><div id="seasonBlock"></div><div id="banner"></div></div>
      ${
        open.length
          ? open.map(m=>`
            <article class="fixtureRow">
              <div class="fixtureDate" aria-hidden="true"><b>${escapeHtml(new Date(`${normalizeDateStr(m.date)}T12:00:00`).toLocaleDateString(undefined,{day:"2-digit"}))}</b><span>${escapeHtml(new Date(`${normalizeDateStr(m.date)}T12:00:00`).toLocaleDateString(undefined,{month:"short"}))}</span></div>
              <div class="fixtureRow__body">
                <div class="fixtureRow__badges">
                ${m.publicCode === latestCode ? `<span class="badge badge--next">NEXT</span>` : ""}
                <span class="badge" data-captain-badge="${escapeHtml(m.publicCode)}" style="background:#111827;color:#fff; display:${ACTIVE_MATCH.captainCodes?.includes?.(m.publicCode) ? "inline-flex" : "none"}">CAPTAIN</span>
                </div>
                <div class="fixtureRow__title">${escapeHtml(m.title || "Match")}</div>
                <div class="small fixtureRow__meta">${escapeHtml(formatHumanDateTime(m.date,m.time))} <span aria-hidden="true">·</span> ${escapeHtml(m.type)}</div>
                ${formatResultLabel(m) ? `<div class="fixtureRow__result"><span>Full time</span><b>${escapeHtml(formatResultLabel(m))}</b></div>` : `<div class="fixtureRow__status"><span aria-hidden="true">●</span> Availability open</div>`}
              </div>
              <button class="btn primary fixtureRow__open" data-open="${escapeHtml(m.publicCode)}" aria-label="View ${escapeHtml(m.title || "match")}">View match</button>
            </article>
          `).join("")
          : `<div class="emptyState"><b>No open matches</b><span>New fixtures will appear here when the club desk publishes them.</span></div>`
      }
    </div>

    <div class="matchSidebar">
      <details class="card matchHistory" id="pastSection">
        <summary>Results & match history</summary>
        <div class="small" style="margin-top:8px">Load completed fixtures from this season.</div>
        <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap"><button class="btn gray" id="refreshPast">Load history</button></div>
        <div id="pastArea" style="margin-top:10px"></div>
      </details>
    </div>

  `;

  loadNextMatchDashboard(list.querySelector("#nextMatchDashboard")).catch(() => {});

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
const cap = availabilityLimitForMatch(m);
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
    const m = data.match;              // <-- must be first


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
    if (t === "INTERNAL") return side === "HOME" ? String(m.teamHomeName || "Blue") : String(m.teamAwayName || "Orange");
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
    // Two captains may report the same event row. Match statistics count the
    // largest submitted value once rather than doubling it.
    if (Number.isFinite(g)) scorerMap[n].goals = Math.max(scorerMap[n].goals, Math.max(0, Math.floor(g)));
    if (Number.isFinite(a)) scorerMap[n].assists = Math.max(scorerMap[n].assists, Math.max(0, Math.floor(a)));
    if (!scorerMap[n].team && teamForPlayer[n]) scorerMap[n].team = teamForPlayer[n];
  }
  const scorers = Object.entries(scorerMap)
    .filter(([_, v]) => (v.goals || 0) > 0)
    .sort((a, b) => (b[1].goals - a[1].goals) || a[0].localeCompare(b[0]))
    .map(([name, v]) => ({ name, goals: v.goals, assists: v.assists, team: v.team || "" }));
  const assisters = Object.entries(scorerMap)
    .filter(([_, v]) => (v.assists || 0) > 0)
    .sort((a, b) => (b[1].assists - a[1].assists) || a[0].localeCompare(b[0]))
    .map(([name, v]) => ({ name, assists: v.assists }));

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
          <b>Home:</b> ${escapeHtml(teamLabel("HOME"))} &nbsp; • &nbsp; <b>Away:</b> ${escapeHtml(teamLabel("AWAY"))}
        </div>

        ${scorers.length ? `
          <div class="small" style="margin-top:10px"><b>Scorers</b></div>
          <div class="small" style="margin-top:6px">
            ${
              Object.keys(scorersByTeam).length > 1
                ? Object.entries(scorersByTeam)
                    .map(([team, list]) => `<div style="margin-top:6px"><b>${escapeHtml(team)}:</b> ${list.map(s => `${escapeHtml(s.name)} (${s.goals})`).join(" • ")}</div>`)
                    .join("")
                : `${scorers.map(s => `${escapeHtml(s.name)} (${s.goals})`).join(" • ")}`
            }
          </div>
        ` : ``}
        ${assisters.length ? `<div class="small" style="margin-top:10px"><b>Assists:</b> ${assisters.map(s => `${escapeHtml(s.name)} (${s.assists})`).join(" • ")}</div>` : ``}
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
      if (y) y.disabled = false;
      if (n) n.disabled = false;
      renderAvailLists();
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
    setTimeout(()=>{ if (y) y.disabled=false; if (n) n.disabled=false; renderAvailLists(); }, 900);
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

  const { seasons, selected } = pickSelectedSeason(seasonsRes);
  const seasonId = selected;

  const openCached = lsGet(openKey(seasonId));
  const openMatches = openCached?.matches || [];

  // Render immediately from cache.
  renderMatchList(root, seasonId, openMatches);
  injectSeasonSelector(root, seasons, seasonId);

  const needInitial = !openMatches.length;
  const staleOpenCache = (now() - Number(openCached?.ts || 0)) > MATCH_OPEN_CACHE_MAX_AGE_MS;
  const shouldReloadFetch = isReloadForMatchList() || needInitial || staleOpenCache;
  if (shouldReloadFetch) {
    refreshOpenMatches(root, seasons, seasonId, { force: true }).catch(() => {});
  }

  // Save active refs for activation meta checks
  ACTIVE_MATCH.seasons = seasons;
  ACTIVE_MATCH.pageRoot = root;
  ACTIVE_MATCH.listRoot = root.querySelector('#matchListView');
  ACTIVE_MATCH.seasonId = seasonId;
  ensureMatchOpenLifecycleRefresh();
  // Meta check only on initial load / tab enter (backend-friendly)
  setTimeout(() => scheduleMatchMetaCheck("load"), 0);

  // Prefetch details for all cached open matches immediately (background)
  prefetchOpenMatchDetails(openMatches);

}
