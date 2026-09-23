// src/pages/match.js
import { API } from "../api/endpoints.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { isReloadForMatchList, isReloadForMatchCode } from "../nav_state.js";
import { getCachedUser } from "../auth.js";
import { defaultPositions, fieldPositionCode } from "../ui/team_field.js";
import { initials, loadCanvasImage, playerPhotoHtml } from "../ui/player_photo.js";
import { getActiveWeeklyTheme } from "../themes.js";

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
  return side === "HOME"
    ? String(m?.teamHomeName || "MLFC")
    : String(m?.teamAwayName || "Opponent");
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

function publicTeamSheet(teamName, teamRows, tone = "blue", captain = "") {
  const rows = [...(teamRows || [])].sort((a, b) => String(a.playerName || "").localeCompare(String(b.playerName || "")));
  const players = rows.map((row) => String(row.playerName || "").trim()).filter(Boolean);
  const defaults = defaultPositions(players);
  const savedPositions = Object.fromEntries(rows.map(row => [String(row.playerName || "").trim(), { positionX: Number(row.positionX), positionY: Number(row.positionY) }]));
  return `<section class="digitalTeam digitalTeam--${tone}" aria-label="${escapeHtml(teamName)} team sheet">
    <header class="digitalTeam__head"><div><span>Matchday squad</span><strong>${escapeHtml(teamName)}</strong></div><b>${players.length}</b></header>
    <div class="digitalTeam__pitch digitalTeam__pitch--positioned"><span class="digitalTeam__centre" aria-hidden="true"></span>
      ${rows.map((row) => {
        const player = String(row.playerName || "").trim();
        if (!player) return "";
        const fallback = defaults[player] || { positionX: 50, positionY: 50 };
        const rawX = row.positionX == null || row.positionX === "" ? NaN : Number(row.positionX);
        const rawY = row.positionY == null || row.positionY === "" ? NaN : Number(row.positionY);
        const x = Math.max(7, Math.min(93, Number.isFinite(rawX) ? rawX : fallback.positionX));
        const y = 100 - Math.max(7, Math.min(93, Number.isFinite(rawY) ? rawY : fallback.positionY));
        return `<div class="digitalPlayer digitalPlayer--positioned${player === captain ? " digitalPlayer--captain" : ""}" style="left:${x}%;top:${y}%">${playerPhotoHtml(player, row.photoUrl, "playerPhoto playerPhoto--field")}<i aria-label="${player === captain ? "Captain" : "Player"}">${player === captain ? "C" : ""}</i><span>${escapeHtml(player)}</span><small>${escapeHtml(fieldPositionCode(savedPositions[player] || fallback))}</small></div>`;
      }).join("")}
    </div>
  </section>`;
}

function publicSharedTeamSheet(homeName, homeRows, awayName, awayRows, homeCaptain = "", awayCaptain = "") {
  const teams = [
    { name: homeName, rows: homeRows || [], tone: "blue", captain: homeCaptain, upper: false },
    { name: awayName, rows: awayRows || [], tone: "orange", captain: awayCaptain, upper: true }
  ].filter((team) => team.rows.length);
  const total = teams.reduce((sum, team) => sum + team.rows.length, 0);

  return `<section class="digitalTeam digitalTeam--shared" aria-label="Digital team sheet">
    <header class="digitalTeam__head digitalTeam__head--shared">
      ${teams.map((team) => `<div class="digitalTeam__team digitalTeam__team--${team.tone}"><span>${team.upper ? "↓" : "↑"} attacks</span><strong>${escapeHtml(team.name)}</strong><b>${team.rows.length}</b></div>`).join("")}
      <span class="srOnly">${total} players</span>
    </header>
    <div class="digitalTeam__pitch digitalTeam__pitch--positioned digitalTeam__pitch--shared"><span class="digitalTeam__centre" aria-hidden="true"></span>
      ${teams.flatMap((team) => {
        const players = team.rows.map((row) => String(row.playerName || "").trim()).filter(Boolean);
        const defaults = defaultPositions(players);
        const savedPositions = Object.fromEntries(team.rows.map(row => [String(row.playerName || "").trim(), { positionX: Number(row.positionX), positionY: Number(row.positionY) }]));
        return team.rows.map((row) => {
          const player = String(row.playerName || "").trim();
          if (!player) return "";
          const fallback = defaults[player] || { positionX: 50, positionY: 50 };
          const rawX = row.positionX == null || row.positionX === "" ? NaN : Number(row.positionX);
          const rawY = row.positionY == null || row.positionY === "" ? NaN : Number(row.positionY);
          const positionX = Math.max(7, Math.min(93, Number.isFinite(rawX) ? rawX : fallback.positionX));
          const positionY = Math.max(7, Math.min(93, Number.isFinite(rawY) ? rawY : fallback.positionY));
          const x = team.upper ? 100 - positionX : positionX;
          const y = team.upper ? 50 - positionY / 2 : 50 + positionY / 2;
          return `<div class="digitalPlayer digitalPlayer--positioned digitalPlayer--${team.tone}${player === team.captain ? " digitalPlayer--captain" : ""}" style="left:${x}%;top:${y}%">${playerPhotoHtml(player, row.photoUrl, "playerPhoto playerPhoto--field")}<i aria-label="${player === team.captain ? "Captain" : "Player"}">${player === team.captain ? "C" : ""}</i><span>${escapeHtml(player)}</span><small>${escapeHtml(fieldPositionCode(savedPositions[player] || fallback))}</small></div>`;
        });
      }).join("")}
    </div>
  </section>`;
}

function publicTeamBalance(balance, homeName, awayName) {
  if (!balance) return "";
  const considerations = Array.isArray(balance.considerations) ? balance.considerations : [];
  return `<div class="teamBalance" aria-label="Team balance">
    <div class="teamBalance__score"><strong>${Number(balance.balancePercent || 0)}%</strong><span>team balance</span></div>
    <div><b>${escapeHtml(homeName)} ${Number(balance.blueStrength || 0).toFixed(1)} · ${escapeHtml(awayName)} ${Number(balance.orangeStrength || 0).toFixed(1)}</b>
      <small>${Number(balance.ratedPlayers || 0)}/${Number(balance.playerCount || 0)} players rated · ${Number(balance.historicalMatches || 0)} past internal matches considered</small>
      ${considerations.length ? `<small><b>Considerations:</b> ${considerations.map(escapeHtml).join(" · ")}</small>` : ""}
    </div>
  </div>`;
}

async function publicTeamSheetImageFile(match, when, homeName, homeRows, awayName, awayRows, captains = []) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const theme = getActiveWeeklyTheme();
  const background = context.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, theme?.background || "#061724");
  background.addColorStop(1, theme?.panel2 || "#0e3a52");
  context.fillStyle = background;
  context.fillRect(0, 0, 1080, 1350);
  context.fillStyle = theme?.accent || "#72d7fa";
  context.font = "900 23px Arial";
  context.fillText("MANOR LAKES FC · DIGITAL TEAM SHEET", 55, 55);
  context.fillStyle = "#fff";
  context.font = "900 42px Arial";
  context.fillText(String(match.title || "MATCH").toUpperCase(), 55, 108, 970);
  context.fillStyle = "#bed2dc";
  context.font = "700 21px Arial";
  context.fillText(when, 55, 144);
  if (theme) {
    context.fillStyle = theme.accent;
    context.font = "900 17px Arial";
    context.textAlign = "right";
    context.fillText(`TEAM OF THE WEEK · ${theme.name.toUpperCase()}`, 1025, 55);
    context.textAlign = "left";
  }

  const pitch = { x: 55, y: 180, width: 970, height: 1080 };
  context.fillStyle = "#26713b";
  context.fillRect(pitch.x, pitch.y, pitch.width, pitch.height);
  context.fillStyle = "#226936";
  for (let stripe = 0; stripe < 10; stripe += 2) context.fillRect(pitch.x, pitch.y + stripe * pitch.height / 10, pitch.width, pitch.height / 10);
  context.strokeStyle = "rgba(255,255,255,.55)";
  context.lineWidth = 3;
  context.strokeRect(pitch.x, pitch.y, pitch.width, pitch.height);
  context.beginPath(); context.moveTo(pitch.x, pitch.y + pitch.height / 2); context.lineTo(pitch.x + pitch.width, pitch.y + pitch.height / 2); context.stroke();
  context.beginPath(); context.arc(540, pitch.y + pitch.height / 2, 72, 0, Math.PI * 2); context.stroke();
  context.strokeRect(pitch.x + pitch.width * .32, pitch.y, pitch.width * .36, 52);
  context.strokeRect(pitch.x + pitch.width * .32, pitch.y + pitch.height - 52, pitch.width * .36, 52);

  const teams = [
    { name: homeName, rows: homeRows || [], captain: captains[0], upper: false, color: "#72d7fa" },
    { name: awayName, rows: awayRows || [], captain: captains[1], upper: true, color: "#ff9c55" },
  ].filter(team => team.rows.length);
  const portraits = new Map(await Promise.all(teams.flatMap(team => team.rows).map(async row => [row.playerName, await loadCanvasImage(row.photoUrl)])));
  for (const team of teams) {
    const players = team.rows.map(row => String(row.playerName || "").trim()).filter(Boolean);
    const defaults = defaultPositions(players);
    context.fillStyle = team.color;
    context.font = "900 22px Arial";
    context.textAlign = "center";
    context.fillText(`${team.name.toUpperCase()} · ${players.length} · ${team.upper ? "↓" : "↑"} ATTACKS`, 540, team.upper ? 172 : 1294);
    for (const row of team.rows) {
      const name = String(row.playerName || "").trim();
      if (!name) continue;
      const fallback = defaults[name] || { positionX: 50, positionY: 50 };
      const px = row.positionX == null || row.positionX === "" ? fallback.positionX : Number(row.positionX);
      const py = row.positionY == null || row.positionY === "" ? fallback.positionY : Number(row.positionY);
      const singleTeam = teams.length === 1;
      const x = pitch.x + pitch.width * (team.upper ? 100 - Math.max(7, Math.min(93, px)) : Math.max(7, Math.min(93, px))) / 100;
      const displayY = singleTeam ? 100 - Math.max(7, Math.min(93, py)) : team.upper ? 50 - Math.max(7, Math.min(93, py)) / 2 : 50 + Math.max(7, Math.min(93, py)) / 2;
      const y = pitch.y + pitch.height * displayY / 100;
      const portrait = portraits.get(row.playerName);
      context.save(); context.beginPath(); context.arc(x, y, 30, 0, Math.PI * 2); context.clip();
      if (portrait) {
        const scale = Math.max(60 / portrait.width, 60 / portrait.height);
        context.drawImage(portrait, x - portrait.width * scale / 2, y - portrait.height * scale / 2, portrait.width * scale, portrait.height * scale);
      } else { context.fillStyle = team.color; context.fillRect(x - 30, y - 30, 60, 60); }
      context.restore();
      context.strokeStyle = "#fff"; context.lineWidth = 3; context.beginPath(); context.arc(x, y, 30, 0, Math.PI * 2); context.stroke();
      if (name === team.captain) { context.fillStyle = "#ffe16a"; context.beginPath(); context.arc(x + 22, y - 21, 12, 0, Math.PI * 2); context.fill(); context.fillStyle = "#132c3b"; context.font = "900 14px Arial"; context.fillText("C", x + 22, y - 16); }
      context.font = "900 19px Arial";
      const labelWidth = Math.min(190, Math.max(90, context.measureText(name).width + 18));
      context.fillStyle = "rgba(2,19,30,.9)"; context.fillRect(x - labelWidth / 2, y + 36, labelWidth, 29);
      context.fillStyle = "#fff"; context.fillText(name, x, y + 57, labelWidth - 12);
    }
  }
  context.textAlign = "left";
  context.fillStyle = "#bed2dc"; context.font = "700 18px Arial";
  context.fillText("Shared from the public MLFC match page", 55, 1325);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `mlfc-team-sheet-${match.publicCode}.png`, { type: "image/png" }) : null;
}

async function sharePublicTeamSheet(match, when, homeName, homeRows, awayName, awayRows, captains) {
  const file = await publicTeamSheetImageFile(match, when, homeName, homeRows, awayName, awayRows, captains);
  if (!file) throw new Error("Could not create the team-sheet image.");
  const text = `⚽ ${match.title}\n🗓️ ${when}\n\nView match: ${baseUrl()}#/match?code=${match.publicCode}`;
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: `${match.title} team sheet`, text, files: [file] });
    return "image";
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "download";
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
  const confirmed = availabilityGroups(availability).yes.length;
  const maximum = availabilityLimitForMatch(match);
  const spotsLeft = Math.max(0, maximum - confirmed);
  const internalMatch = String(match?.type || "").toUpperCase() === "INTERNAL";
  const homeMarker = internalMatch ? "🔵" : "🔴";
  const awayMarker = internalMatch ? "🟠" : "⚪";
  return [
    `⚽ *${match.title}*`,
    `${homeMarker} *${matchTeamLabel(match, "HOME")}* vs ${awayMarker} *${matchTeamLabel(match, "AWAY")}*`,
    `🗓️ ${when}`,
    `👥 ${confirmed}/${maximum} players confirmed · ${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`,
    "",
    "Availability is shown in the attached image.",
    "Update your response in the MLFC app:",
    `${baseUrl()}#/match?code=${match.publicCode}`,
  ].join("\n");
}

async function availabilityImageFile(match, availability) {
  const groups = availabilityGroups(availability);
  const maximum = availabilityLimitForMatch(match);
  const internalMatch = String(match?.type || "").toUpperCase() === "INTERNAL";
  const homeTeamName = String(match?.teamHomeName || (internalMatch ? "Blue" : "MLFC"));
  const awayTeamName = String(match?.teamAwayName || (internalMatch ? "Orange" : "Opponent"));
  const matchupLabel = `${homeTeamName} VS ${awayTeamName}`.toUpperCase();
  const available = { title: "AVAILABLE", names: groups.yes, color: "#45dc8a", maximum };
  const lowerGroups = [
    { title: "WAITING LIST", names: groups.waiting, color: "#ffe16a" },
  ];
  const allGroups = [available, ...lowerGroups];
  const photoByName = new Map((availability || []).map(row => [String(row.playerName || "").trim().toLowerCase(), row.photoUrl]));
  const portraits = new Map(await Promise.all(
    [...new Set(allGroups.flatMap(group => group.names))].map(async name => [name, await loadCanvasImage(photoByName.get(name.toLowerCase()))])
  ));
  const logo = await loadCanvasImage("./assets/icons/icon-192.png");
  // Keep the common 22-player case within WhatsApp's 4:5 message preview.
  // Secondary lists switch to two columns as they grow instead of making the
  // image increasingly tall (and therefore cropped in the chat bubble).
  const rowHeight = 80;
  const lowerColumns = lowerGroups.map(group => group.names.length > 6 ? 2 : 1);
  const availableRows = Math.max(1, Math.ceil(available.names.length / 2));
  const lowerRows = Math.max(1, ...lowerGroups.map((group, index) => Math.ceil(group.names.length / lowerColumns[index])));
  const headerHeight = 170;
  const availableHeight = 104 + availableRows * rowHeight + 24;
  const lowerHeight = 104 + lowerRows * rowHeight + 24;
  const logicalWidth = 1080;
  const logicalHeight = Math.max(1350, headerHeight + availableHeight + lowerHeight + 112);
  const renderScale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * renderScale;
  canvas.height = logicalHeight * renderScale;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(renderScale, renderScale);

  const gradient = context.createLinearGradient(0, 0, logicalWidth, logicalHeight);
  gradient.addColorStop(0, "#061724"); gradient.addColorStop(1, "#0e3a52");
  context.fillStyle = gradient; context.fillRect(0, 0, logicalWidth, logicalHeight);
  if (logo) context.drawImage(logo, 48, 34, 104, 104);
  context.fillStyle = "#72d7fa"; context.font = "900 22px Arial";
  context.fillText("MANOR LAKES FC", 178, 55);
  context.fillStyle = "#ffffff"; context.font = "900 42px Arial";
  const matchTitle = String(match.title || "MATCH").toUpperCase();
  let titleLabel = matchTitle;
  while (titleLabel.length > 1 && context.measureText(`${titleLabel}…`).width > 515) titleLabel = titleLabel.slice(0, -1);
  if (titleLabel !== matchTitle) titleLabel += "…";
  context.fillText(titleLabel, 178, 105);
  context.fillStyle = "#bed2dc"; context.font = "800 21px Arial";
  context.fillText("AVAILABILITY", 178, 140);

  context.textAlign = "right";
  context.fillStyle = "#72d7fa"; context.font = "900 19px Arial";
  context.fillText("MATCH DATE & TIME", 1038, 50);
  context.fillStyle = "#ffffff"; context.font = "900 27px Arial";
  const when = formatHumanDateTime(match.date, match.time);
  context.fillText(when, 1038, 88, 340);
  context.fillStyle = "#bed2dc"; context.font = "700 18px Arial";
  context.fillText("Update your response in the MLFC app", 1038, 124);
  context.textAlign = "left";

  context.textAlign = "center";
  context.fillStyle = "#ffffff"; context.font = "900 24px Arial";
  context.fillText(matchupLabel, logicalWidth / 2, headerHeight - 11, 500);
  context.textAlign = "left";

  const margin = 42, gap = 18, contentTop = headerHeight;
  const drawPanel = (group, x, y, width, height, columns = 1) => {
    context.fillStyle = "rgba(3,20,32,.76)"; context.fillRect(x, y, width, height);
    context.fillStyle = group.color; context.fillRect(x, y, width, 7);
    context.font = "900 24px Arial"; context.fillText(group.title, x + 22, y + 42);
    context.fillStyle = "#bed2dc"; context.font = "800 20px Arial";
    const playerCount = group.maximum
      ? `${group.names.length} / ${group.maximum} PLAYERS · ${Math.max(0, group.maximum - group.names.length)} SPOTS LEFT`
      : `${group.names.length} PLAYER${group.names.length === 1 ? "" : "S"}`;
    context.fillText(playerCount, x + 22, y + 72);
    const names = group.names.length ? group.names : ["No players"];
    const rows = Math.ceil(names.length / columns);
    const itemWidth = width / columns;
    names.forEach((name, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const itemX = x + column * itemWidth;
      const cy = y + 106 + row * rowHeight;
      const portrait = portraits.get(name);
      const portraitSize = columns > 1 && width < 600 ? 62 : 72;
      const portraitRadius = portraitSize / 2;
      const portraitX = itemX + 18 + portraitRadius;
      context.save(); context.beginPath(); context.arc(portraitX, cy, portraitRadius, 0, Math.PI * 2); context.clip();
      if (portrait) {
        const scale = Math.max(portraitSize / portrait.width, portraitSize / portrait.height);
        const photoWidth = portrait.width * scale, photoHeight = portrait.height * scale;
        context.drawImage(portrait, portraitX - photoWidth / 2, cy - photoHeight / 2, photoWidth, photoHeight);
      } else {
        context.fillStyle = "#102c38"; context.fillRect(portraitX - portraitRadius, cy - portraitRadius, portraitSize, portraitSize);
        context.fillStyle = "#d8e8ef";
        context.font = `900 ${Math.round(portraitSize * .36)}px Arial`;
        context.textAlign = "center";
        context.fillText(name === "No players" ? "–" : initials(name), portraitX, cy + Math.round(portraitSize * .13));
        context.textAlign = "left";
      }
      context.restore();
      context.strokeStyle = group.color; context.lineWidth = 4; context.beginPath(); context.arc(portraitX, cy, portraitRadius, 0, Math.PI * 2); context.stroke();
      context.fillStyle = name === "No players" ? "#78949c" : "#ffffff";
      context.font = `800 ${columns > 1 && width < 600 ? 26 : 30}px Arial`;
      const labelX = portraitX + portraitRadius + 12;
      const maxWidth = itemX + itemWidth - 14 - labelX;
      let label = name;
      while (label.length > 1 && context.measureText(`${label}…`).width > maxWidth) label = label.slice(0, -1);
      if (label !== name) label += "…";
      context.fillText(label, labelX, cy + 9);
    });
  };

  drawPanel(available, margin, contentTop, logicalWidth - margin * 2, availableHeight, 2);
  const lowerTop = contentTop + availableHeight + gap;
  const lowerWidth = logicalWidth - margin * 2;
  lowerGroups.forEach((group, index) => drawPanel(group, margin, lowerTop, lowerWidth, lowerHeight, lowerColumns[index]));
  context.fillStyle = "#bed2dc"; context.font = "700 20px Arial";
  context.fillText("Generated from the live MLFC availability list", 54, logicalHeight - 35);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `mlfc-availability-${match.publicCode}.png`, { type: "image/png" }) : null;
}

async function shareAvailability(match, availability) {
  const file = await availabilityImageFile(match, availability);
  if (!file) throw new Error("Could not create the availability image.");
  const text = whatsappAvailabilityMessage(match, availability);
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: `${match.title} availability`, text, files: [file] });
    return "image";
  }
  const downloadUrl = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = downloadUrl; link.download = file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
  window.location.assign(`https://wa.me/?text=${encodeURIComponent(text)}`);
  return "download";
}

function fitRecapCanvasText(context, value, maxWidth) {
  const original = String(value || "");
  if (context.measureText(original).width <= maxWidth) return original;
  let label = original;
  while (label.length > 1 && context.measureText(`${label}…`).width > maxWidth) label = label.slice(0, -1);
  return `${label}…`;
}

function drawRecapPortrait(context, portrait, name, x, y, radius) {
  context.save();
  context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.clip();
  if (portrait) {
    const diameter = radius * 2;
    const scale = Math.max(diameter / portrait.width, diameter / portrait.height);
    context.drawImage(portrait, x - portrait.width * scale / 2, y - portrait.height * scale / 2, portrait.width * scale, portrait.height * scale);
  } else {
    context.fillStyle = "#12384a"; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    context.fillStyle = "#ffffff"; context.font = `900 ${Math.round(radius * .72)}px Arial`; context.textAlign = "center";
    context.fillText(initials(name), x, y + Math.round(radius * .25));
  }
  context.restore();
  context.strokeStyle = "#ffe16a"; context.lineWidth = 5; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
  context.textAlign = "left";
}

async function matchRecapImageFile(match, when, { scorers = [], assisters = [], potmWinners = [], topRatings = [] } = {}) {
  const winnerRows = Math.ceil(potmWinners.length / 2);
  const potmHeight = potmWinners.length ? 105 + winnerRows * 155 : 0;
  const highlightRows = Math.max(1, scorers.length, assisters.length, topRatings.length);
  const highlightsHeight = 118 + highlightRows * 52;
  const logicalWidth = 1080;
  const logicalHeight = Math.max(1350, 570 + potmHeight + highlightsHeight + 110);
  const renderScale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * renderScale; canvas.height = logicalHeight * renderScale;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(renderScale, renderScale);

  const gradient = context.createLinearGradient(0, 0, logicalWidth, logicalHeight);
  gradient.addColorStop(0, "#061724"); gradient.addColorStop(1, "#0e3a52");
  context.fillStyle = gradient; context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.strokeStyle = "rgba(114,215,250,.20)"; context.lineWidth = 4;
  context.beginPath(); context.arc(950, 80, 235, 0, Math.PI * 2); context.stroke();

  const logo = await loadCanvasImage("./assets/icons/icon-192.png");
  if (logo) context.drawImage(logo, 54, 42, 92, 92);
  context.fillStyle = "#72d7fa"; context.font = "900 23px Arial";
  context.fillText("MANOR LAKES FC · MATCH RECAP", 170, 66);
  context.fillStyle = "#ffffff"; context.font = "900 40px Arial";
  context.fillText(fitRecapCanvasText(context, String(match.title || "MATCH").toUpperCase(), 850), 170, 112);
  context.fillStyle = "#bed2dc"; context.font = "700 21px Arial";
  context.fillText(`${when} · ${String(match.type || "MATCH").toUpperCase()}`, 170, 145, 850);

  const scoreTop = 185;
  context.fillStyle = "rgba(3,20,32,.78)"; context.fillRect(50, scoreTop, 980, 330);
  context.fillStyle = "#45dc8a"; context.fillRect(50, scoreTop, 980, 8);
  context.fillStyle = "#45dc8a"; context.font = "900 20px Arial"; context.textAlign = "center";
  context.fillText("FINAL SCORE", 540, scoreTop + 48);
  const homeName = matchTeamLabel(match, "HOME");
  const awayName = matchTeamLabel(match, "AWAY");
  context.fillStyle = "#ffffff"; context.font = "900 39px Arial";
  context.fillText(fitRecapCanvasText(context, homeName, 325), 245, scoreTop + 116);
  context.fillText(fitRecapCanvasText(context, awayName, 325), 835, scoreTop + 116);
  context.fillStyle = "#72d7fa"; context.font = "900 122px Arial";
  context.fillText(String(match.scoreHome ?? "–"), 420, scoreTop + 252);
  context.fillStyle = "#78949c"; context.font = "900 54px Arial";
  context.fillText("–", 540, scoreTop + 235);
  context.fillStyle = "#ff9b72"; context.font = "900 122px Arial";
  context.fillText(String(match.scoreAway ?? "–"), 660, scoreTop + 252);
  context.fillStyle = "#bed2dc"; context.font = "800 17px Arial";
  context.fillText("HOME", 245, scoreTop + 160); context.fillText("AWAY", 835, scoreTop + 160);
  context.textAlign = "left";

  let sectionTop = scoreTop + 365;
  if (potmWinners.length) {
    context.fillStyle = "#ffe16a"; context.font = "900 24px Arial";
    context.fillText(potmWinners.length === 1 ? "PLAYER OF THE MATCH" : "PLAYERS OF THE MATCH", 60, sectionTop + 30);
    const portraits = await Promise.all(potmWinners.map((winner) => loadCanvasImage(winner.photoUrl)));
    potmWinners.forEach((winner, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 60 + column * 490;
      const y = sectionTop + 58 + row * 155;
      context.fillStyle = "rgba(3,20,32,.70)"; context.fillRect(x, y, 460, 130);
      drawRecapPortrait(context, portraits[index], winner.playerName, x + 65, y + 65, 43);
      context.fillStyle = "#ffffff"; context.font = "900 28px Arial";
      context.fillText(fitRecapCanvasText(context, winner.playerName, 300), x + 125, y + 45);
      context.fillStyle = "#ffe16a"; context.font = "800 17px Arial";
      const voteCount = Number(winner.voteCount || 0);
      context.fillText(`${voteCount} ${voteCount === 1 ? "VOTE" : "VOTES"}`, x + 125, y + 76);
      context.fillStyle = "#bed2dc"; context.font = "800 17px Arial";
      const rating = Number(winner.ratingCount || 0) ? Number(winner.rating).toFixed(1) : "–";
      context.fillText(`${Number(winner.goals || 0)} G  ·  ${Number(winner.assists || 0)} A  ·  ${rating} RATING`, x + 125, y + 105);
    });
    sectionTop += potmHeight;
  }

  context.fillStyle = "#72d7fa"; context.font = "900 24px Arial";
  context.fillText("MATCH HIGHLIGHTS", 60, sectionTop + 30);
  const columns = [
    { title: "GOALS", color: "#45dc8a", rows: scorers.map((item) => `${item.name}  ×${item.goals}`), empty: "No goals recorded" },
    { title: "ASSISTS", color: "#72d7fa", rows: assisters.map((item) => `${item.name}  ×${item.assists}`), empty: "No assists recorded" },
    { title: "TOP RATINGS", color: "#ffe16a", rows: topRatings.map((item) => `${item.name}  ${item.rating.toFixed(1)}`), empty: "No ratings recorded" },
  ];
  const panelTop = sectionTop + 58;
  const panelWidth = 306;
  const panelGap = 22;
  const panelHeight = highlightsHeight - 58;
  columns.forEach((column, columnIndex) => {
    const x = 60 + columnIndex * (panelWidth + panelGap);
    context.fillStyle = "rgba(3,20,32,.70)"; context.fillRect(x, panelTop, panelWidth, panelHeight);
    context.fillStyle = column.color; context.fillRect(x, panelTop, panelWidth, 6);
    context.fillStyle = column.color; context.font = "900 20px Arial";
    context.fillText(column.title, x + 20, panelTop + 42);
    const rows = column.rows.length ? column.rows : [column.empty];
    rows.forEach((row, index) => {
      context.fillStyle = column.rows.length ? "#ffffff" : "#78949c";
      context.font = `${column.rows.length ? "800" : "700"} 19px Arial`;
      context.fillText(fitRecapCanvasText(context, row, panelWidth - 40), x + 20, panelTop + 88 + index * 52);
      if (index < rows.length - 1) {
        context.strokeStyle = "rgba(190,210,220,.12)"; context.lineWidth = 1;
        context.beginPath(); context.moveTo(x + 20, panelTop + 105 + index * 52); context.lineTo(x + panelWidth - 20, panelTop + 105 + index * 52); context.stroke();
      }
    });
  });

  context.fillStyle = "#bed2dc"; context.font = "700 20px Arial";
  context.fillText("Generated from the official MLFC match record", 60, logicalHeight - 43);
  context.textAlign = "right";
  context.fillText(`${homeName.toUpperCase()} vs ${awayName.toUpperCase()}`, 1020, logicalHeight - 43, 470);
  context.textAlign = "left";

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `mlfc-match-recap-${match.publicCode}.png`, { type: "image/png" }) : null;
}

async function shareMatchRecap(match, when, highlights) {
  const file = await matchRecapImageFile(match, when, highlights);
  if (!file) throw new Error("Could not create the match recap image.");
  const homeName = matchTeamLabel(match, "HOME");
  const awayName = matchTeamLabel(match, "AWAY");
  const lines = [
    `⚽ *${match.title}*`,
    `*${homeName} ${match.scoreHome} – ${match.scoreAway} ${awayName}*`,
    `🗓️ ${when}`,
  ];
  if (highlights.scorers.length) lines.push("", `Scorers: ${highlights.scorers.map((item) => `${item.name} (${item.goals})`).join(" · ")}`);
  if (highlights.assisters.length) lines.push(`Assists: ${highlights.assisters.map((item) => `${item.name} (${item.assists})`).join(" · ")}`);
  if (highlights.potmWinners.length) lines.push(`🏆 POTM: ${highlights.potmWinners.map((item) => item.playerName).join(" & ")}`);
  lines.push("", `${baseUrl()}#/match?code=${match.publicCode}`);
  const text = lines.join("\n");
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: `${match.title} match recap`, text, files: [file] });
    return "image";
  }
  const downloadUrl = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = downloadUrl; link.download = file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
  window.location.assign(`https://wa.me/?text=${encodeURIComponent(text)}`);
  return "download";
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

function profileStatusRoute(publicCode = "") {
  const returnHash = publicCode
    ? `#/match?code=${encodeURIComponent(publicCode)}`
    : "#/match";
  return `#/login?status=1&return=${encodeURIComponent(returnHash)}`;
}

function latestResultEventLine(result) {
  const events = Array.isArray(result?.events) ? result.events : [];
  const potm = Array.isArray(result?.potm) ? result.potm : [];
  // Captains can each submit the same player's totals. Collapse those reports
  // so the home banner shows one clear contribution per player.
  const contributions = new Map();
  events.forEach((event) => {
    const name = String(event?.playerName || "").trim();
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const current = contributions.get(key) || { name, goals: 0, assists: 0 };
    const goals = Number(event?.goals || 0);
    const assists = Number(event?.assists || 0);
    current.goals = Math.max(current.goals, Number.isFinite(goals) ? Math.max(0, goals) : 0);
    current.assists = Math.max(current.assists, Number.isFinite(assists) ? Math.max(0, assists) : 0);
    contributions.set(key, current);
  });
  const formatContribution = (item, stat) => {
    const count = item[stat];
    return `${escapeHtml(item.name)}${count > 1 ? ` ×${count}` : ""}`;
  };
  const goals = [...contributions.values()]
    .filter((item) => item.goals > 0)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
    .map((item) => formatContribution(item, "goals"));
  const assists = [...contributions.values()]
    .filter((item) => item.assists > 0)
    .sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name))
    .map((item) => formatContribution(item, "assists"));
  const potmWinners = potm.map((winner) => {
    const name = String(winner?.playerName || "").trim();
    if (!name) return "";
    return `<span class="nextMatch__potmWinner">
      ${playerPhotoHtml(name, winner.photoUrl, "playerPhoto playerPhoto--homePotm")}
      <span><i aria-hidden="true">🏆</i>${escapeHtml(name)}</span>
    </span>`;
  }).filter(Boolean);
  if (!goals.length && !assists.length && !potmWinners.length) return "";
  return `<div class="nextMatch__lastEvents" aria-label="Last match contributions">
    ${goals.length ? `<div class="nextMatch__contribution"><span class="nextMatch__contributionIcon" aria-hidden="true">⚽</span><span><b>Scorers</b><span>${goals.join(" · ")}</span></span></div>` : ""}
    ${assists.length ? `<div class="nextMatch__contribution"><span class="nextMatch__contributionIcon nextMatch__contributionIcon--assist" aria-hidden="true">↗</span><span><b>Assists</b><span>${assists.join(" · ")}</span></span></div>` : ""}
    ${potmWinners.length ? `<div class="nextMatch__potm"><b>POTM</b><div>${potmWinners.join("")}</div></div>` : ""}
  </div>`;
}

function potmVoteBannerHtml(vote) {
  if (!vote?.publicCode) return "";
  return `<section class="potmPrompt" aria-labelledby="potmPromptTitle">
    <span class="potmPrompt__trophy" aria-hidden="true">🏆</span>
    <div><div class="nextMatch__eyebrow">Voting is open</div><h2 id="potmPromptTitle">Choose your Player of the Match</h2><p>${escapeHtml(vote.title)} · open until Clubdesk closes voting${vote.currentVote ? ` · current vote: ${escapeHtml(vote.currentVote)}` : ""}</p></div>
    <button class="btn potmPrompt__button" type="button" data-potm-open="${escapeHtml(vote.publicCode)}">${vote.currentVote ? "Change vote" : "Vote now"}</button>
  </section>`;
}

async function openPotmFieldDialog(code, onSaved = null) {
  let modal = document.querySelector("#potmFieldDialog");
  if (modal) modal.remove();
  modal = document.createElement("dialog");
  modal.id = "potmFieldDialog";
  modal.className = "potmFieldDialog";
  modal.innerHTML = `<div class="potmFieldDialog__loading">Loading the team sheet…</div>`;
  document.body.appendChild(modal);
  modal.showModal();

  const response = await API.getPublicMatch(code);
  const potm = response?.potm;
  if (!response?.ok || !potm?.canVote) {
    modal.innerHTML = `<div class="potmFieldDialog__panel"><button class="potmFieldDialog__close" type="button" aria-label="Close">×</button><h2>Voting unavailable</h2><p>${escapeHtml(response?.error || "Voting is not open for this match.")}</p></div>`;
    modal.querySelector(".potmFieldDialog__close").onclick = () => modal.close();
    modal.addEventListener("close", () => modal.remove(), { once: true });
    return;
  }

  const meName = String(getCachedUser()?.name || "").trim().toLowerCase();
  const candidates = (potm.candidates || []).filter((candidate) => String(candidate.playerName || "").trim().toLowerCase() !== meName);
  const grouped = new Map();
  candidates.forEach((candidate) => {
    const team = String(candidate.team || "TEAM").toUpperCase();
    if (!grouped.has(team)) grouped.set(team, []);
    grouped.get(team).push(candidate);
  });
  const teams = [...grouped.keys()];
  const positions = {};
  for (const team of teams) Object.assign(positions, defaultPositions(grouped.get(team).map((item) => item.playerName)));
  const displayPositions = {};
  for (const team of teams) {
    const teamCandidates = grouped.get(team);
    const names = teamCandidates.map(item => item.playerName);
    const saved = Object.fromEntries(teamCandidates.map(item => [item.playerName, { positionX: Number(item.positionX), positionY: Number(item.positionY) }]));
    Object.assign(displayPositions, presentationPositions(names, saved));
  }
  let selected = String(potm.myVote || "");
  modal.innerHTML = `<form method="dialog" class="potmFieldDialog__panel">
    <header><div><div class="stepEyebrow">Player of the Match</div><h2>Pick a player from the field</h2><p>Tap a player, then confirm your vote.</p></div><button class="potmFieldDialog__close" value="cancel" aria-label="Close">×</button></header>
    <div class="potmFieldDialog__pitch" role="listbox" aria-label="Players in this match">
      <span class="potmFieldDialog__halfway" aria-hidden="true"></span>
      ${candidates.map((candidate) => {
        const fallback = positions[candidate.playerName] || { positionX: 50, positionY: 50 };
        const rawX = displayPositions[candidate.playerName]?.positionX;
        const rawY = displayPositions[candidate.playerName]?.positionY;
        const teamIndex = Math.max(0, teams.indexOf(String(candidate.team || "TEAM").toUpperCase()));
        const x = Math.max(9, Math.min(91, Number.isFinite(rawX) ? rawX : fallback.positionX));
        const localY = Math.max(10, Math.min(90, Number.isFinite(rawY) ? rawY : fallback.positionY));
        const y = teamIndex % 2 ? 50 - localY * .42 : 50 + localY * .42;
        const chosen = String(candidate.playerName).toLowerCase() === selected.toLowerCase();
        return `<button class="potmFieldPlayer${chosen ? " is-selected" : ""}" type="button" role="option" aria-selected="${chosen}" data-potm-player="${escapeHtml(candidate.playerName)}" style="left:${x}%;top:${y}%">${playerPhotoHtml(candidate.playerName, candidate.photoUrl, "playerPhoto playerPhoto--field")}<span>${escapeHtml(candidate.playerName)}</span></button>`;
      }).join("")}
    </div>
    <footer><span data-potm-choice>${selected ? `Selected: ${escapeHtml(selected)}` : "Select a player on the field"}</span><button class="btn primary" type="button" data-potm-confirm ${selected ? "" : "disabled"}>${potm.myVote ? "Change vote" : "Confirm vote"}</button></footer>
  </form>`;
  modal.querySelectorAll("[data-potm-player]").forEach((button) => {
    button.onclick = () => {
      selected = button.getAttribute("data-potm-player") || "";
      modal.querySelectorAll("[data-potm-player]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-selected", active);
        item.setAttribute("aria-selected", String(active));
      });
      modal.querySelector("[data-potm-choice]").textContent = `Selected: ${selected}`;
      modal.querySelector("[data-potm-confirm]").disabled = false;
    };
  });
  modal.querySelector("[data-potm-confirm]").onclick = async (event) => {
    const button = event.currentTarget;
    if (!selected) return;
    setDisabled(button, true, "Saving…");
    const saved = await API.votePotm(code, selected);
    if (!saved?.ok) {
      setDisabled(button, false);
      return toastError(saved?.error || "Could not save your vote");
    }
    lsDel(detailKey(code));
    lsDel(nextMatchCacheKey());
    modal.close();
    toastSuccess("POTM vote saved. You can change it until voting closes.");
    if (typeof onSaved === "function") await onSaved(saved.potm);
  };
  modal.addEventListener("close", () => modal.remove(), { once: true });
}

function wirePotmVoteBanner(host) {
  host.querySelector("[data-potm-open]")?.addEventListener("click", (event) => {
    const code=event.currentTarget.getAttribute("data-potm-open");
    if (code) openPotmFieldDialog(code, () => loadNextMatchDashboard(host, { force: true })).catch(() => toastError("Could not open voting."));
  });
}

function wireNextMatchLinks(host) {
  host.querySelectorAll("[data-next-open]").forEach((button) => {
    button.onclick = () => {
      const code = button.getAttribute("data-next-open");
      if (code) location.hash = `#/match?code=${encodeURIComponent(code)}`;
    };
  });
  host.querySelectorAll("[data-next-captain]").forEach((button) => {
    button.onclick = () => {
      const code = button.getAttribute("data-next-captain");
      if (code) location.hash = `#/captain?code=${encodeURIComponent(code)}&src=match`;
    };
  });
}

function renderNextMatchDashboard(host, data) {
  if (!host) return;
  const match = data?.nextMatch;
  if (!match) {
    const result = data?.latestResult;
    host.innerHTML = `
      ${potmVoteBannerHtml(data?.potmVote)}
      <section class="nextMatch nextMatch--empty${result ? " nextMatch--withResult" : ""}" aria-labelledby="nextMatchTitle">
        <div><div class="nextMatch__eyebrow">Your matchday</div><h1 id="nextMatchTitle">No fixture on deck</h1></div>
        <p>There isn’t an open match right now. The next club fixture will appear here when it is published.</p>
        ${result ? `<div class="nextMatch__lastResult">
          <span class="nextMatch__lastLabel">Last result</span>
          <div class="nextMatch__lastSummary"><div class="nextMatch__lastScore"><b>${escapeHtml(result.title)}</b><strong>${result.score?.pending ? "Score update pending" : escapeHtml(`${result.score?.home ?? "–"} — ${result.score?.away ?? "–"}`)}</strong></div>${latestResultEventLine(result)}</div>
          <button class="btn nextMatch__lastOpen" type="button" data-next-open="${escapeHtml(result.publicCode)}">Open match</button>
        </div>` : ""}
      </section>`;
    wirePotmVoteBanner(host);
    wireNextMatchLinks(host);
    return;
  }

  const availability = availabilityPresentation(match.availability);
  const assignment = match.assignment || {};
  const score = match.score || {};
  const hasScore = String(score.home ?? "") !== "" && String(score.away ?? "") !== "";
  const team = String(assignment.team || "").toUpperCase();
  const teamName = String(assignment.teamName || team);
  const fieldRole = String(assignment.fieldRole || "").toUpperCase();
  const roleLabel = assignment.isCaptain ? "Captain" : team ? "Player" : "Check back after team selection.";
  const action = match.contextualAction || null;
  const canRespond = Boolean(match.availability?.canRespond);
  const availabilityStatus = String(match.availability?.status || "NOT_RESPONDED").toUpperCase();
  const hasAvailabilityResponse = ["YES", "NO", "WAITING"].includes(availabilityStatus);
  const playerStatus = String(getCachedUser()?.playerStatus || "ACTIVE").toUpperCase();
  const statusBlocksAvailability = ["INJURED", "INACTIVE"].includes(playerStatus);
  const showResponse = canRespond && !hasAvailabilityResponse && (!action || action.type === "RESPOND");
  const result = data?.latestResult;
  const weeklyTeam = String(document.body.dataset.weeklyTeam || "");

  host.innerHTML = `
    ${potmVoteBannerHtml(data?.potmVote)}
    <section class="nextMatch" aria-labelledby="nextMatchTitle">
      <div class="nextMatch__pitch" aria-hidden="true"></div>
      <header class="nextMatch__head">
        <div>
          <div class="nextMatch__eyebrow">Your next fixture</div>
          <h1 id="nextMatchTitle">${escapeHtml(match.title)}</h1>
          <p>${escapeHtml(formatHumanDateTime(match.date, match.time))} <span aria-hidden="true">·</span> ${escapeHtml(match.type)}</p>
        </div>
        <div class="nextMatch__aside">
          <div class="nextMatch__themeMark" aria-label="${escapeHtml(weeklyTeam ? `Team of the Week: ${weeklyTeam}` : "Team of the Week")}">
            <span class="nextMatch__themeCrest" aria-hidden="true"></span>
            <span><small>Team of the Week</small><strong class="nextMatch__themeName">${escapeHtml(weeklyTeam)}</strong></span>
          </div>
          <div class="nextMatch__countdown" data-next-countdown aria-live="off">${escapeHtml(countdownLabel(match))}</div>
        </div>
      </header>

      <div class="nextMatch__stateGrid">
        <div class="nextMatch__state">
          <span class="nextMatch__label">Availability</span>
          ${statusBlocksAvailability && !hasAvailabilityResponse
            ? `<a class="statusPill statusPill--pending statusPillLink" href="${escapeHtml(profileStatusRoute(match.publicCode))}"><span aria-hidden="true">!</span>Update status</a>`
            : `<strong class="statusPill statusPill--${availability.tone}"><span aria-hidden="true">${availability.tone === "yes" ? "✓" : availability.tone === "no" ? "×" : availability.tone === "waiting" ? "↗" : "!"}</span>${escapeHtml(availability.label)}</strong>`}
          <small>${statusBlocksAvailability && !hasAvailabilityResponse ? `Your profile is ${escapeHtml(playerStatus.toLowerCase())}. Change it to Active to respond.` : escapeHtml(availability.detail)}</small>
        </div>
        ${team || availabilityStatus === "YES" ? `<div class="nextMatch__state">
          <span class="nextMatch__label">Your role</span>
          <strong>${assignment.isCaptain ? `<span class="badge nextMatch__captainTag" aria-label="Captain">C</span> ` : ""}${team ? escapeHtml(`${teamName} team${fieldRole ? ` · ${fieldRole}` : ""}`) : "Team not assigned"}</strong>
          <small>${escapeHtml(roleLabel)}</small>
        </div>` : ""}
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
        ${!assignment.isCaptain && !hasAvailabilityResponse && action && action.type !== "RESPOND" ? `<button class="btn primary nextMatch__primary" type="button" data-next-open="${escapeHtml(action.publicCode || match.publicCode)}">${escapeHtml(action.label)}</button>` : ""}
        ${!statusBlocksAvailability && !hasAvailabilityResponse && !showResponse && (!action || action.type === "RESPOND") ? `<button class="btn gray nextMatch__primary" type="button" data-next-open="${escapeHtml(match.publicCode)}">View match</button>` : ""}
        ${hasAvailabilityResponse && !canRespond ? `<button class="btn gray nextMatch__primary" type="button" data-next-open="${escapeHtml(match.publicCode)}">View match</button>` : ""}
        ${assignment.isCaptain ? `<button class="btn primary nextMatch__primary" type="button" data-next-captain="${escapeHtml(match.publicCode)}">Manage team</button>` : ""}
        ${hasAvailabilityResponse ? `<button class="btn whatsappBtn" type="button" data-next-share>Share to WhatsApp</button>` : ""}
      </footer>

      ${result ? `<div class="nextMatch__lastResult">
        <span class="nextMatch__lastLabel">Last result</span>
        <div class="nextMatch__lastSummary">
          <div class="nextMatch__lastScore"><b>${escapeHtml(result.title)}</b><strong>${result.score?.pending ? "Score update pending" : escapeHtml(`${result.score?.home ?? "–"} — ${result.score?.away ?? "–"}`)}</strong></div>
          ${latestResultEventLine(result)}
        </div>
        <button class="btn nextMatch__lastOpen" type="button" data-next-open="${escapeHtml(result.publicCode)}" aria-label="Open ${escapeHtml(result.title)}">Open match</button>
      </div>` : ""}
    </section>`;

  wirePotmVoteBanner(host);
  wireNextMatchLinks(host);

  const shareButton = host.querySelector("[data-next-share]");
  if (shareButton) shareButton.onclick = async () => {
    shareButton.disabled = true;
    shareButton.textContent = "Preparing share…";
    try {
      const detail = await API.getPublicMatch(match.publicCode);
      if (!detail?.ok || !detail.match || !Array.isArray(detail.availability)) {
        throw new Error(detail?.error || "Could not load the availability list. Try again.");
      }
      const mode = await shareAvailability(detail.match, detail.availability);
      if (mode === "download") toastInfo("Availability image downloaded. Attach it in WhatsApp.");
    } catch (error) {
      if (error?.name !== "AbortError") toastError(error?.message || "Could not prepare the WhatsApp share. Try again.");
    } finally {
      shareButton.disabled = false;
      shareButton.textContent = "Share to WhatsApp";
    }
  };

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
  if (cached?.data?.ok) renderNextMatchDashboard(host, cached.data);

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
  const shouldFetch = isReloadForMatchCode(code) || !data?.ok || !data?.potm || metaChanged || (!!data?.potm?.openedAt && !data?.potm?.closed);

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
    availability: String(a.availability||"").toUpperCase(),
    photoUrl: String(a.photoUrl||"").trim()
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

    // Waiting list button is enabled once the confirmed-player quota is reached.
    const btnWait = detail.querySelector("#btnWait");
    if (btnWait) {
      const quotaReached = yesCount >= cap;
      const allowWait = quotaReached;
      btnWait.disabled = !meName || !allowWait;
      btnWait.title = allowWait ? "" : `Waiting list unlocks when ${cap} players are available.`;
    }
  }

  const caps = data.captains || {};
  const isCaptain = !!meName && [caps.captain1, caps.captain2].some(c => String(c || "").trim().toLowerCase() === meName.toLowerCase());

  const teamsSelected = Array.isArray(data.teams) && data.teams.length > 0;
  const ratingsClosed = Number(m.ratingsLocked || 0) === 1 || String(m.ratingsLocked || "").toUpperCase() === "TRUE";
  const profileUnavailable = meName && String(me?.playerStatus||"ACTIVE").toUpperCase()!=="ACTIVE";
  const availabilityClosed = profileUnavailable || Number(m.availabilityLocked || 0) === 1 || String(m.availabilityLocked || "").toUpperCase() === "TRUE";
  // Captain assignment grants immediate access; it is independent of availability.
  const captainPageEnabled = isCaptain;
  const hideAvailability = false;
  const teamForPlayer = {};
  (data.teams || []).forEach(t=>{ const pn=String(t.playerName||'').trim(); const tm=String(t.team||'').trim(); if(pn&&tm) teamForPlayer[pn]=tm; });
  const homeTeamKey = String(m.type || "").toUpperCase() === "INTERNAL" ? "BLUE" : "MLFC";
  const awayTeamKey = String(m.type || "").toUpperCase() === "INTERNAL" ? "ORANGE" : "OPPONENT";
  const homeTeamRows = (data.teams || []).filter((team) => String(team.team || "").toUpperCase() === homeTeamKey);
  const awayTeamRows = (data.teams || []).filter((team) => String(team.team || "").toUpperCase() === awayTeamKey);
  const homePlayers = uniqueSorted(homeTeamRows.map((team) => String(team.playerName || "").trim()));
  const awayPlayers = uniqueSorted(awayTeamRows.map((team) => String(team.playerName || "").trim()));
  const scoreHome = String(m.scoreHome ?? "").trim();
  const scoreAway = String(m.scoreAway ?? "").trim();
  const hasScore = scoreHome !== "" && scoreAway !== "";
  let potm = data.potm || null;
  const potmCandidates = Array.isArray(potm?.candidates) ? potm.candidates : [];
  const potmWinnerRows = (potm?.winners || []).map((name) => {
    const candidate = potmCandidates.find((row) => String(row.playerName).toLowerCase() === String(name).toLowerCase()) || {playerName:name};
    const result = (potm?.results || []).find((row) => String(row.candidateName).toLowerCase() === String(name).toLowerCase());
    return { ...candidate, voteCount: Number(result?.voteCount || 0) };
  });

  function teamLabel(side) {
    // side: "HOME" | "AWAY"
    const t = String(m.type || "").toUpperCase();
    if (t === "INTERNAL") return side === "HOME" ? String(m.teamHomeName || "Blue") : String(m.teamAwayName || "Orange");
    return side === "HOME" ? String(m.teamHomeName || "MLFC") : String(m.teamAwayName || "Opponent");
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

  const ratingMap = new Map();
  for (const row of (Array.isArray(data.ratings) ? data.ratings : [])) {
    const name = String(row?.playerName || "").trim();
    const rating = Number(row?.rating);
    if (!name || !Number.isFinite(rating) || rating <= 0) continue;
    const key = name.toLowerCase();
    const current = ratingMap.get(key) || { name, total: 0, count: 0 };
    current.total += rating; current.count += 1;
    ratingMap.set(key, current);
  }
  const topRatings = [...ratingMap.values()]
    .map((row) => ({ name: row.name, rating: row.total / row.count, ratingCount: row.count }))
    .sort((a, b) => (b.rating - a.rating) || (b.ratingCount - a.ratingCount) || a.name.localeCompare(b.name))
    .slice(0, 3);

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
          <button class="btn primary" id="openCaptain" ${captainPageEnabled ? "" : "disabled"} title="${captainPageEnabled ? "" : "Available once you are assigned as captain."}">Open captain page</button>
        </div>
        ${captainPageEnabled ? `` : `<div class="small" style="margin-top:8px"><b>Note:</b> Captain tools unlock as soon as you are assigned.</div>`}
      ` : ``}
    </div>

    ${hasScore ? `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">
          <div class="h1">Match recap</div>
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
        ${(scorers.length || assisters.length) ? `<div class="matchTimeline" aria-label="Match contributions">
          ${scorers.map((item) => `<div class="matchTimeline__item"><span>⚽</span><div><b>${escapeHtml(item.name)}</b><small>${item.goals} ${item.goals === 1 ? "goal" : "goals"}</small></div></div>`).join("")}
          ${assisters.map((item) => `<div class="matchTimeline__item"><span>↗</span><div><b>${escapeHtml(item.name)}</b><small>${item.assists} ${item.assists === 1 ? "assist" : "assists"}</small></div></div>`).join("")}
        </div>` : ``}
        <button class="btn whatsappBtn" id="shareResult" type="button" style="margin-top:14px">Share match recap</button>
      </div>
    ` : ``}

    ${hasScore && potm?.openedAt ? `<div class="card potmCard" id="potmVoting">
      <div class="potmCard__head"><div><div class="stepEyebrow">Player of the Match</div><div class="h1">${potm.closed ? (potmWinnerRows.length ? "Match winner" : "Voting closed") : "Cast your vote"}</div></div><span class="badge">${potm.closed ? "FINAL" : "OPEN"}</span></div>
      ${potm.closed ? `
        ${potmWinnerRows.length ? `<div class="potmWinners">${potmWinnerRows.map((winner) => {
          return `<div class="potmWinner">${playerPhotoHtml(winner.playerName, winner.photoUrl, "playerPhoto playerPhoto--potm")}<span>🏆</span><div><b>${escapeHtml(winner.playerName)}</b><small>${Number(winner.voteCount || 0)} votes · ${Number(winner.goals || 0)} G · ${Number(winner.assists || 0)} A · ${Number(winner.ratingCount || 0) ? `${Number(winner.rating).toFixed(1)} rating` : "No rating"}</small></div></div>`;
        }).join("")}</div>` : `<div class="small">No votes were cast.</div>`}
      ` : potm.canVote ? `
        <div class="small">Choose any player from either team except yourself. You can change your vote until Clubdesk closes voting.</div>
        <button class="btn primary potmFieldTrigger" id="openPotmField" type="button">${potm.myVote ? "Change vote on field" : "Choose player on field"}</button>
        <div class="small" id="potmMessage">${potm.myVote ? `Your current vote: ${escapeHtml(potm.myVote)}` : "Votes stay private until voting closes."}</div>
      ` : `<div class="small">${meName ? "Only players listed in this match can vote." : "Sign in to vote if you played in this match."} Voting stays open until Clubdesk closes it.</div>`}
    </div>` : ``}

    ${teamsSelected ? `<div class="card teamSheetCard">
      <div class="teamSheetCard__head"><div><div class="stepEyebrow">Selected squads</div><div class="h1">Digital team sheet</div></div><div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end"><span class="badge">${homePlayers.length + awayPlayers.length} players</span><button class="btn whatsappBtn" id="shareTeamSheet" type="button">Share team sheet</button></div></div>
      <div class="digitalTeamGrid digitalTeamGrid--single">
        ${awayPlayers.length
          ? publicSharedTeamSheet(teamLabel("HOME"), homeTeamRows, teamLabel("AWAY"), awayTeamRows, caps.captain1, caps.captain2)
          : publicTeamSheet(teamLabel("HOME"), homeTeamRows, "blue", caps.captain1)}
      </div>
      ${publicTeamBalance(data.teamBalance, teamLabel("HOME"), teamLabel("AWAY"))}
    </div>` : ``}

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
                : (profileUnavailable
                    ? `<div class="availabilityStatusPrompt"><div class="small"><b>Your profile is ${escapeHtml(String(me.playerStatus).toLowerCase())}.</b> Change it to Active in Profile before updating availability.</div><a class="btn primary" href="${escapeHtml(profileStatusRoute(code))}">Update status</a></div>`
                    : availabilityClosed
                    ? `<div class="small"><b>Availability is closed.</b> You can still switch to <b>NO</b> or join the <b>waiting list</b> if you can't make it.</div>`
                    : (meName
                        ? `<div class="small">Logged in as <b>${meName}</b>. Tap YES/NO to post your availability. If the match is full (${cap} available), you can join the waiting list.</div>`
                        : `<div class="small">Login required to post availability.</div>`))}
              ${meName ? `` : `
                <div class="small" style="margin-top:10px">Go to <b>Login</b> tab to sign in.</div>
              `}
              ${ratingsClosed ? `` : `
                <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
                  ${profileUnavailable ? `` : `${availabilityClosed ? `` : `<button class="btn good" id="btnYes" ${meName ? "" : "disabled"}>YES</button>`}<button class="btn bad" id="btnNo" ${meName ? "" : "disabled"}>NO</button><button class="btn warn" id="btnWait" disabled>WAITING LIST</button>`}
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
    shareBtn.onclick = async () => {
      setDisabled(shareBtn, true, "Preparing…");
      try {
        const mode = await shareAvailability(m, availability);
        if (mode === "download") toastInfo("Availability image downloaded. Attach it in WhatsApp.");
      } catch (error) {
        if (error?.name !== "AbortError") toastError(error?.message || "Could not prepare the WhatsApp share.");
      } finally { setDisabled(shareBtn, false); }
    };
  }

  const shareResult = detail.querySelector("#shareResult");
  if (shareResult) shareResult.onclick = async () => {
    setDisabled(shareResult, true, "Preparing…");
    try {
      const mode = await shareMatchRecap(m, when, { scorers, assisters, potmWinners: potmWinnerRows, topRatings });
      toastInfo(mode === "image" ? "Choose WhatsApp to share the match recap." : "Match recap image downloaded. Attach it in WhatsApp.");
    } catch (error) {
      if (error?.name !== "AbortError") toastError(error?.message || "Could not prepare the match recap.");
    } finally { setDisabled(shareResult, false); }
  };

  const shareTeamSheet = detail.querySelector("#shareTeamSheet");
  if (shareTeamSheet) shareTeamSheet.onclick = async () => {
    setDisabled(shareTeamSheet, true, "Preparing…");
    try {
      const mode = await sharePublicTeamSheet(m, when, teamLabel("HOME"), homeTeamRows, teamLabel("AWAY"), awayTeamRows, [caps.captain1, caps.captain2]);
      toastInfo(mode === "image" ? "Choose an app to share the team sheet." : "Team-sheet image downloaded. Attach it to your message.");
    } catch (error) {
      if (error?.name !== "AbortError") toastError(error?.message || "Could not share the team sheet.");
    } finally { setDisabled(shareTeamSheet, false); }
  };

  const capBtn = detail.querySelector("#openCaptain");
  if (capBtn) capBtn.onclick = () => {
    if (!captainPageEnabled) return toastWarn("Captain tools unlock as soon as you are assigned.");
    location.hash = `#/captain?code=${encodeURIComponent(code)}&src=match`;
  };

  const potmButton = detail.querySelector("#openPotmField");
  if (potmButton) potmButton.onclick = async () => {
    await openPotmFieldDialog(code, async (updatedPotm) => {
      potm = updatedPotm;
      await renderMatchDetail(root, code);
    });
  };

  if (!hideAvailability) {
    renderAvailLists();
  }

  // If admin closed availability, players can still change to NO/WAITING.
  // If ratings are locked (or match isn't open), do not allow changes.
  if (hideAvailability || status !== "OPEN" || ratingsClosed) return;


  async function submit(choice) {
    if (!meName) return toastWarn("Please login first.");

    if (availabilityClosed && String(choice || "").toUpperCase() === "YES") {
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
  const existingPhotos = new Map(availability.map(a => [a.playerName.toLowerCase(), a.photoUrl]));
  availability = res.availability.map(a=>({
    playerName: String(a.playerName||"").trim(),
    availability: String(a.availability||"").toUpperCase(),
    photoUrl: String(a.photoUrl || existingPhotos.get(String(a.playerName||"").trim().toLowerCase()) || "").trim()
  })).filter(x=>x.playerName);
} else {
  // Fallback: keep local behavior if backend didn't return list
  const idx = availability.findIndex(a => a.playerName.toLowerCase() === meName.toLowerCase());
  if (idx >= 0) availability[idx].availability = choice;
  else availability.push({ playerName: meName, availability: choice, photoUrl: String(me?.photoUrl || "") });
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
    if (query.get("focus") === "potm") {
      setTimeout(() => root.querySelector("#potmVoting")?.scrollIntoView({behavior:"smooth",block:"start"}), 0);
    }
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
