import { FIELD_POSITIONS, mountTeamField, positionMap, positionRows, fieldPositionCode } from "../ui/team_field.js";
// src/pages/captain.js
import { API } from "../api/endpoints.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { lsGet, lsSet } from "../storage.js";
import { getCachedUser, refreshMe } from "../auth.js";
import { getActiveWeeklyTheme } from "../themes.js";
import { loadCanvasImage } from "../ui/player_photo.js";

const LS_CAPTAIN_ROSTER_PREFIX = "mlfc_captain_roster_v1:"; // + code + captain
const LS_CAPTAIN_TEAMS_PREFIX = "mlfc_captain_teams_v1:";   // + code
const LS_CAPTAIN_RATINGS_DRAFT_PREFIX = "mlfc_captain_ratings_draft_v1:";
const LS_CAPTAIN_FIELD_DRAFT_PREFIX = "mlfc_captain_field_draft_v1:";
const LS_CAPTAIN_GUIDE_PREFIX = "mlfc_captain_guide_seen_v1:";
let CAPTAIN_COMMAND_SCROLL_HANDLER = null;

function rosterKey(code, captain){ return `${LS_CAPTAIN_ROSTER_PREFIX}${code}:${captain.toLowerCase()}`; }
function teamsKey(code){ return `${LS_CAPTAIN_TEAMS_PREFIX}${code}`; }
function ratingsDraftKey(code, actor){ return `${LS_CAPTAIN_RATINGS_DRAFT_PREFIX}${code}:${actor.toLowerCase()}`; }
function fieldDraftKey(code, actor){ return `${LS_CAPTAIN_FIELD_DRAFT_PREFIX}${code}:${actor.toLowerCase()}`; }
function captainGuideKey(code, actor){ return `${LS_CAPTAIN_GUIDE_PREFIX}${code}:${actor.toLowerCase()}`; }

function installCaptainCommandScrollBehavior(root) {
  if (CAPTAIN_COMMAND_SCROLL_HANDLER) {
    window.removeEventListener("scroll", CAPTAIN_COMMAND_SCROLL_HANDLER);
    window.removeEventListener("resize", CAPTAIN_COMMAND_SCROLL_HANDLER);
    window.removeEventListener("hashchange", CAPTAIN_COMMAND_SCROLL_HANDLER);
  }
  const command = root?.querySelector(".captainCommand");
  if (!command) return;

  let scheduled = false;
  let compact = false;
  let handler = null;
  const setCompact = (nextCompact) => {
    if (nextCompact === compact) return;
    if (nextCompact) {
      const styles = getComputedStyle(command);
      const outerHeight = command.getBoundingClientRect().height
        + Number.parseFloat(styles.marginTop || "0")
        + Number.parseFloat(styles.marginBottom || "0");
      root.style.setProperty("--captain-command-space", `${Math.ceil(outerHeight)}px`);
    }
    compact = nextCompact;
    root.classList.toggle("hasCompactCaptainCommand", compact);
    command.classList.toggle("isCompact", compact);
    document.body.classList.toggle("hasCompactCaptainCommand", compact);
  };
  const syncCompactBounds = () => {
    const bounds = root.getBoundingClientRect();
    const edge = window.innerWidth <= 819 ? 4 : 0;
    command.style.setProperty("--captain-command-left", `${Math.max(0, bounds.left - edge)}px`);
    command.style.setProperty("--captain-command-width", `${Math.min(window.innerWidth, bounds.width + edge * 2)}px`);
  };
  const update = () => {
    scheduled = false;
    if (!document.body.contains(command)) {
      window.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
      window.removeEventListener("hashchange", handler);
      document.body.classList.remove("hasCompactCaptainCommand");
      if (CAPTAIN_COMMAND_SCROLL_HANDLER === handler) CAPTAIN_COMMAND_SCROLL_HANDLER = null;
      return;
    }
    const routeActive = String(window.location.hash || "").split("?")[0] === "#/captain" && root.offsetParent !== null;
    const nextCompact = routeActive && (compact ? window.scrollY > 72 : window.scrollY > 140);
    if (nextCompact) syncCompactBounds();
    setCompact(nextCompact);
  };
  handler = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };
  CAPTAIN_COMMAND_SCROLL_HANDLER = handler;
  window.addEventListener("scroll", handler, { passive:true });
  window.addEventListener("resize", handler, { passive:true });
  window.addEventListener("hashchange", handler);
  update();
}

function setDisabled(btn, disabled, busyText) {
  if (!btn) return;
  btn.disabled = disabled;
  if (busyText) {
    if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
    btn.textContent = disabled ? busyText : btn.dataset.origText;
  }
}

function uniqueSorted(arr) {
  return [...new Set(arr)].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function formatHumanDateTime(dateStr, timeStr) {
  const d = String(dateStr || "").trim();
  const t = String(timeStr || "").trim();
  if (!d || !t) return `${d || "Unknown date"} ${t || ""}`.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  const hhmm = m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : t;
  const dt = new Date(`${d}T${hhmm}:00`);
  if (Number.isNaN(dt.getTime())) return `${d} ${hhmm}`;
  return dt.toLocaleString(undefined, {
    weekday:"short", year:"numeric", month:"short", day:"numeric",
    hour:"numeric", minute:"2-digit"
  });
}

function normalizeAvail(list) {
  return (list || []).map(a => ({
    playerName: String(a.playerName || "").trim(),
    availability: String(a.availability || "").toUpperCase()
  })).filter(x => x.playerName);
}

function initialRosterFromAvailability(avail) {
  const yes = avail.filter(a => a.availability === "YES").map(a => a.playerName);
  // Waiting list players are not confirmed, so we do NOT auto-add them to the roster.
  return uniqueSorted([...yes]);
}

function clampInt(x, min=0, max=99) {
  const raw = String(x ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function clampHalfRating(x, min=1, max=10) {
  const raw = String(x ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || Math.round(n * 2) !== n * 2) return null;
  return n;
}

function safeUpper(x){ return String(x || "").trim().toUpperCase(); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
}

function canvasBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function captainTeamImageFile(match, when, team, positions) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  const weeklyTheme = getActiveWeeklyTheme();
  const teamKey = safeUpper(team.team);
  const teamPalette = teamKey === "ORANGE"
    ? { background:"#351304", panel:"#8a3205", accent:"#fb923c", player:"#f97316", playerText:"#fff7ed" }
    : { background:"#071b3d", panel:"#123d7a", accent:"#60a5fa", player:"#2563eb", playerText:"#eff6ff" };
  const background = context.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, teamPalette.background);
  background.addColorStop(1, teamPalette.panel);
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = teamPalette.accent;
  context.fillRect(0, 0, canvas.width, 18);
  context.fillStyle = "#fff";
  context.font = "900 34px Arial";
  context.fillText("MANOR LAKES FC · TEAM SHEET", 60, 76);
  context.font = "900 52px Arial";
  context.fillText(String(team.label || "MLFC").toUpperCase(), 60, 145);
  context.fillStyle = "#b8ced9";
  context.font = "700 25px Arial";
  context.fillText(String(match.title || "Match"), 60, 190);
  context.fillText(when, 60, 228);
  if (weeklyTheme) {
    context.fillStyle = weeklyTheme.accent;
    context.font = "900 18px Arial";
    context.textAlign = "right";
    context.fillText(`TEAM OF THE WEEK · ${weeklyTheme.name.toUpperCase()}`, 1020, 76);
    context.textAlign = "left";
  }

  // Captain sheets show one team from its own goal towards the attacking end.
  // Saved positionY values follow that convention: GK ~= 94 (bottom), ST ~= 8 (top).
  const pitch = { x: 55, y: 300, width: 970, height: 900 };
  const weeklyCrest = await loadCanvasImage(weeklyTheme?.crest);
  const grass = context.createLinearGradient(0, pitch.y, 0, pitch.y + pitch.height);
  grass.addColorStop(0, "#25834b");
  grass.addColorStop(1, "#105c32");
  context.fillStyle = grass;
  context.fillRect(pitch.x, pitch.y, pitch.width, pitch.height);
  if (weeklyCrest) {
    const crestSize = Math.min(pitch.width * .58, pitch.height * .58);
    context.save();
    context.globalAlpha = .1;
    context.drawImage(weeklyCrest, pitch.x + (pitch.width - crestSize) / 2, pitch.y + (pitch.height - crestSize) / 2, crestSize, crestSize);
    context.restore();
  }
  context.strokeStyle = "rgba(255,255,255,.55)";
  context.lineWidth = 4;
  context.strokeRect(pitch.x + 18, pitch.y + 18, pitch.width - 36, pitch.height - 36);

  // Halfway line and the visible half of the centre circle mark the attacking end.
  context.beginPath();
  context.moveTo(pitch.x + 18, pitch.y + 18);
  context.lineTo(pitch.x + pitch.width - 18, pitch.y + 18);
  context.stroke();
  context.beginPath();
  context.arc(pitch.x + pitch.width / 2, pitch.y + 18, 92, 0, Math.PI);
  context.stroke();

  // Defensive penalty area, six-yard box and goal are always at the bottom.
  const goalLineY = pitch.y + pitch.height - 18;
  context.strokeRect(pitch.x + pitch.width * .22, goalLineY - 180, pitch.width * .56, 180);
  context.strokeRect(pitch.x + pitch.width * .35, goalLineY - 82, pitch.width * .3, 82);
  context.fillStyle = "rgba(255,255,255,.8)";
  context.beginPath();
  context.arc(pitch.x + pitch.width / 2, goalLineY - 125, 6, 0, Math.PI * 2);
  context.fill();
  const goal = { x:pitch.x + pitch.width / 2 - 105, y:goalLineY, width:210, height:34 };
  context.strokeStyle = "rgba(255,255,255,.9)";
  context.strokeRect(goal.x, goal.y, goal.width, goal.height);
  context.lineWidth = 2;
  for (let x = goal.x + 35; x < goal.x + goal.width; x += 35) {
    context.beginPath(); context.moveTo(x, goal.y); context.lineTo(x, goal.y + goal.height); context.stroke();
  }

  context.fillStyle = teamPalette.accent;
  context.font = "900 21px Arial";
  context.textAlign = "center";
  context.fillText("ATTACKING  ↑", pitch.x + pitch.width / 2, pitch.y - 17);

  const rows = positionRows([team], positions);
  const resolved = Object.fromEntries(rows.map(row => [row.playerName, row]));
  for (const player of team.players) {
    const position = resolved[player] || { positionX: 50, positionY: 50 };
    const x = pitch.x + 55 + Number(position.positionX) / 100 * (pitch.width - 110);
    const y = pitch.y + 65 + Number(position.positionY) / 100 * (pitch.height - 195);
    context.fillStyle = teamPalette.player;
    context.beginPath();
    context.arc(x, y, 34, 0, Math.PI * 2);
    context.fill();
    if (player === team.captain) {
      context.strokeStyle = "#ffe16a";
      context.lineWidth = 7;
      context.stroke();
    }
    const role = fieldPositionCode(position);
    if (role) {
      context.fillStyle = "#fff";
      context.beginPath(); context.arc(x - 25, y - 23, 14, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#08283b";
      context.font = "900 11px Arial";
      context.textAlign = "center";
      context.fillText(role, x - 25, y - 19);
    }
    context.fillStyle = teamPalette.playerText;
    context.font = "900 24px Arial";
    context.textAlign = "center";
    context.fillText(player === team.captain ? "C" : "•", x, y + 8);
    context.font = "900 22px Arial";
    const labelWidth = Math.min(230, Math.max(110, context.measureText(player).width + 28));
    context.fillStyle = "rgba(2,14,22,.88)";
    context.fillRect(x - labelWidth / 2, y + 43, labelWidth, 38);
    context.fillStyle = "#fff";
    context.fillText(player, x, y + 70, labelWidth - 16);
  }
  context.textAlign = "left";
  context.fillStyle = "#b8ced9";
  context.font = "700 20px Arial";
  context.fillText(`${team.players.length} players · Generated from MLFC`, 60, 1320);
  const blob = await canvasBlob(canvas);
  return blob ? new File([blob], `mlfc-${team.team.toLowerCase()}-team-${match.publicCode}.png`, { type: "image/png" }) : null;
}

// Some API calls accept a "scope" so the backend can validate permissions.
// Captain flow defaults to CAPTAIN; when an admin opens the captain page from
// the admin UI (e.g. #/captain?code=...&src=admin) we send ADMIN.
function getScopeFromHash() {
  try {
    const hash = String(window.location.hash || "");
    const qs = hash.includes("?") ? hash.split("?").slice(1).join("?") : "";
    const p = new URLSearchParams(qs);
    const src = (p.get("src") || "").toLowerCase();
    return src === "admin" ? "ADMIN" : "CAPTAIN";
  } catch {
    return "CAPTAIN";
  }
}

export async function renderCaptainPage(root, query) {
  const code = query.get("code");

  // IMPORTANT: don't rely only on cached user, because admin status might change after login.
  let me = getCachedUser();
  try {
    const fresh = await refreshMe(true); // force server truth (if available)
    if (fresh) me = fresh;
  } catch {}

  const captain = String(me?.name || "").trim();
  const isAdmin = !!me?.isAdmin;
  const src = (query.get("src") || "match").toLowerCase();
  const adminMode = isAdmin && src === "admin";

  if (!code) {
    root.innerHTML = `<div class="card"><div class="h1">Captain</div><div class="small">Missing code.</div></div>`;
    return;
  }
  if (!captain) {
    root.innerHTML = `<div class="card"><div class="h1">Captain</div><div class="small">Please login first.</div></div>`;
    return;
  }

  root.innerHTML = `<div class="card"><div class="h1">Loading…</div><div class="small">Fetching match…</div></div>`;

  const data = await API.getPublicMatch(code);
  if (!data.ok) {
    root.innerHTML = `<div class="card"><div class="h1">Error</div><div class="small">${data.error}</div></div>`;
    toastError(data.error || "Failed to load match");
    return;
  }

  const m = data.match;
  const type = safeUpper(m.type);
  const homeTeamName = escapeHtml(type === "INTERNAL" ? String(m.teamHomeName || "Blue") : "MLFC");
  const awayTeamName = escapeHtml(type === "INTERNAL" ? String(m.teamAwayName || "Orange") : "Opponent");
  const visibleTeamName = (team) => safeUpper(team) === "BLUE" ? homeTeamName : safeUpper(team) === "ORANGE" ? awayTeamName : team;
  const status = safeUpper(m.status);
  const locked = String(m.ratingsLocked || "").toUpperCase() === "TRUE" || Number(m.ratingsLocked) === 1;
  const when = formatHumanDateTime(m.date, m.time);
  const kickOff = new Date(`${String(m.date || "").slice(0, 10)}T${String(m.time || "00:00").slice(0, 5)}:00`).getTime();
  const hasStarted = Number.isFinite(kickOff) && kickOff <= Date.now();

  if (locked || status === "COMPLETED") {
    root.innerHTML = `
      <div class="card">
        <div class="h1">${m.title}</div>
        <div class="small">${when} • ${m.type}</div>
        <div class="small" style="margin-top:10px">Ratings are locked.</div>
      </div>
    `;
    return;
  }

  if (status !== "OPEN") {
    root.innerHTML = `
      <div class="card">
        <div class="h1">${m.title}</div>
        <div class="small">${when} • ${m.type}</div>
        <div class="small" style="margin-top:10px">This match is not open for scoring or ratings.</div>
      </div>
    `;
    return;
  }

  const capRow = data.captains || {};
  const assigned = [capRow.captain1, capRow.captain2]
    .some(c => String(c || "").trim().toLowerCase() === captain.toLowerCase());
  if (!adminMode && !assigned) {
    root.innerHTML = `<div class="card"><div class="h1">Captain</div><div class="small">You are not assigned as captain for this match.</div></div>`;
    return;
  }

  const avail = normalizeAvail(data.availability || []);
  const postedPlayers = uniqueSorted(avail.map(a => a.playerName));

  const playersRes = await API.players();
  let allPlayers = playersRes.ok ? uniqueSorted((playersRes.players || []).map(p => p.name)) : [];
  let playersRefresh = null;
  const refreshAllPlayers = async () => {
    if (playersRefresh) return playersRefresh;
    playersRefresh = API.players().then((result) => {
      if (result?.ok) allPlayers = uniqueSorted((result.players || []).map(player => player.name));
      return result;
    }).finally(() => { playersRefresh = null; });
    return playersRefresh;
  };

  const cachedRoster = lsGet(rosterKey(code, captain));
  let roster = cachedRoster?.roster && Array.isArray(cachedRoster.roster)
    ? uniqueSorted(cachedRoster.roster)
    : initialRosterFromAvailability(avail);

  const cachedTeams = lsGet(teamsKey(code));
  let teamMap = (cachedTeams?.teamMap && typeof cachedTeams.teamMap === "object") ? cachedTeams.teamMap : {};
  const savedMatchRoster = uniqueSorted((data.teams || [])
    .filter(t => type === "OPPONENT" ? safeUpper(t.team) === "MLFC" : true)
    .map(t => String(t.playerName || "").trim()));

  (data.teams || []).forEach(t => {
    const p = String(t.playerName || "").trim();
    const tm = safeUpper(t.team);
    if (p && tm) teamMap[p] = tm;
  });

  // Admin ratings must always use the teams saved for this match. Falling back to
  // availability creates editable rows that the API correctly rejects as unassigned.
  // Captain flow can still start from availability / cached roster while setup is active.
  // The saved team sheet is authoritative for opponent matches. Using YES
  // availability or a stale device draft here can expose players who were not
  // selected and omit players whom the API requires the captain to rate.
  if (adminMode || type === "OPPONENT") roster = savedMatchRoster;

  if (!adminMode && type === "INTERNAL" && !roster.some(x => x.toLowerCase() === captain.toLowerCase())) {
    roster = uniqueSorted([...roster, captain]);
  }

  roster.forEach(p => { if (!teamMap[p]) teamMap[p] = "BLUE"; });

  const capt = data.captains || {};
  let captainTeam = "";
  if (type === "INTERNAL") {
    const c1 = String(capt.captain1 || "").trim();
    const c2 = String(capt.captain2 || "").trim();
    if (c1 && c1.toLowerCase() === captain.toLowerCase()) captainTeam = "BLUE";
    else if (c2 && c2.toLowerCase() === captain.toLowerCase()) captainTeam = "ORANGE";
    else {
      const tm = safeUpper(teamMap[captain]);
      if (tm === "BLUE" || tm === "ORANGE") captainTeam = tm;
    }
  }

  const opponentTeam = (type === "INTERNAL" && captainTeam)
    ? (captainTeam === "BLUE" ? "ORANGE" : "BLUE")
    : "";

  const scoreHomePresent = String(m.scoreHome ?? "").trim() !== "";
  const scoreAwayPresent = String(m.scoreAway ?? "").trim() !== "";
  const relevantScorePresent = !adminMode && type === "INTERNAL" && captainTeam
    ? (captainTeam === "BLUE" ? scoreAwayPresent : scoreHomePresent)
    : scoreHomePresent && scoreAwayPresent;
  // Ratings open after kick-off once this captain/admin has a saved score.
  let ratingsEnabled = hasStarted && relevantScorePresent;

  function isOpponentPlayer(playerName) {
    if (adminMode) return true;
    if (type !== "INTERNAL") return true;
    if (!captainTeam) return true;
    const tm = safeUpper(teamMap[playerName]);
    if (!tm) return true;
    return tm !== captainTeam;
  }

  function saveRosterLocal() { lsSet(rosterKey(code, captain), { ts: Date.now(), roster }); }
  function saveTeamsLocal() { lsSet(teamsKey(code), { ts: Date.now(), teamMap }); }
  saveRosterLocal();
  saveTeamsLocal();

  const drafts = {}; // { [playerName]: { rating, goals, assists } }

  // Prefill drafts from backend if ratings/events already exist.
  const ratingMap = {};
  const ratingCoverage = new Map();
  (data.ratings || []).forEach(r => {
    const key = String(r.playerName || "").trim().toLowerCase();
    if (key) ratingCoverage.set(key, true);
  });
  function ratingDutyStatus() {
    const required = roster.filter(isOpponentPlayer);
    const completed = required.filter(playerName => ratingCoverage.has(playerName.toLowerCase())).length;
    return { required:required.length, completed, complete:required.length > 0 && completed === required.length };
  }
  const initialDutyStatus = ratingDutyStatus();
  const stepButtonsHtml = `<button type="button" data-step-dot="1">1 <b>Score</b></button><button type="button" data-step-dot="2">2 <b>Roster</b></button><button type="button" data-step-dot="3" ${ratingsEnabled && roster.length ? "" : "disabled"}>3 <b>Ratings</b></button>`;
  const availabilityByPlayer = new Map(avail.map(item => [item.playerName.toLowerCase(), item.availability]));
  const teamAvailabilityList = (team) => {
    const players = roster.filter(player => safeUpper(teamMap[player]) === team && availabilityByPlayer.get(player.toLowerCase()) !== "NO");
    if (!players.length) return `<div class="captainAvailability__empty">No players assigned.</div>`;
    return players.map(player => {
      const availability = availabilityByPlayer.get(player.toLowerCase()) || "";
      const status = availability === "YES" ? "Available" : availability === "WAITING" ? "Waiting" : availability === "NO" ? "Unavailable" : adminMode ? "Admin added" : "Added";
      const tone = availability === "YES" ? "yes" : availability === "NO" ? "no" : availability === "WAITING" ? "waiting" : "added";
      return `<div class="captainAvailability__player"><span>${escapeHtml(player)}</span><small class="is-${tone}">${status}</small></div>`;
    }).join("");
  };
  const unavailablePlayers = avail.filter(item => item.availability === "NO").map(item => item.playerName);
  const waitingPlayers = avail.filter(item => item.availability === "WAITING").map(item => item.playerName);
  const responseList = (players, label, tone) => players.length
    ? players.map(player => `<div class="captainAvailability__player"><span>${escapeHtml(player)}</span><small class="is-${tone}">${label}</small></div>`).join("")
    : `<div class="captainAvailability__empty">None</div>`;
  // A match may contain submissions from both captains and an admin. Prefill
  // only the current user's own draft; showing somebody else's latest values
  // makes a resubmission look like it belongs to the current user.
  const currentActor = captain.toLowerCase();
  (data.ratings || []).filter(r => String(r.givenBy || "").trim().toLowerCase() === currentActor)
    .slice().sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")))
    .forEach(r => { const p = String(r.playerName||"").trim(); if (p) ratingMap[p] = String(r.rating ?? ""); });
  const eventMap = {};
  (data.events || []).filter(e => String(e.givenBy || "").trim().toLowerCase() === currentActor)
    .slice().sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")))
    .forEach(e => {
      const p = String(e.playerName||"").trim();
      if (!p) return;
      eventMap[p] = { goals: String(e.goals ?? ""), assists: String(e.assists ?? "") };
    });

  // Initialize drafts for any roster player we already have data for.
  roster.forEach(p => {
    drafts[p] = drafts[p] || {};
    if (drafts[p].rating == null || drafts[p].rating === "") drafts[p].rating = ratingMap[p] ?? "";
    if (drafts[p].goals == null || drafts[p].goals === "") drafts[p].goals = eventMap[p]?.goals ?? "";
    if (drafts[p].assists == null || drafts[p].assists === "") drafts[p].assists = eventMap[p]?.assists ?? "";
  });
  const localRatingsDraft = lsGet(ratingsDraftKey(code, captain));
  if (localRatingsDraft?.drafts && typeof localRatingsDraft.drafts === "object") {
    roster.forEach(p => {
      if (!localRatingsDraft.drafts[p]) return;
      drafts[p] = { ...drafts[p], ...localRatingsDraft.drafts[p] };
    });
  }

  function saveRatingsDraft() {
    lsSet(ratingsDraftKey(code, captain), { ts: Date.now(), drafts });
    const indicator = root.querySelector("#ratingsDraftState");
    if (indicator) indicator.textContent = "Unsaved ratings · draft saved on this device";
  }

  const hint = adminMode
    ? `<span style="opacity:.75">• Admin mode: enter and save both sides.</span>`
    : (!adminMode && type === "INTERNAL" && captainTeam)
    ? `<span style="opacity:.75">• You can only put <b>opponent</b> score.</span>`
    : "";

  root.innerHTML = `
    <style>
      #rosterTableWrap { display:block; }
      #rosterMobileWrap { display:none; }
      @media (max-width: 640px) {
        #rosterTableWrap { display:none; }
        #rosterMobileWrap { display:block; }
      }
      .muted { color: rgba(11,18,32,0.65); }
      .scoreGrid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px; }
      .scoreBox { border:1px solid rgba(11,18,32,0.10); border-radius:14px; padding:10px; }
      .scoreLabel { font-size:12px; color: rgba(11,18,32,0.65); }
      .scoreValue { font-size:22px; font-weight:950; margin-top:6px; }
      .rosterCard {
        border: 1px solid rgba(11,18,32,0.10);
        border-radius: 14px;
        padding: 12px;
        margin-top: 10px;
        background: rgba(255,255,255,0.6);
      }
      .rosterGrid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
      .teamPills { display:flex; gap:8px; justify-content:flex-start; flex-wrap:wrap; }
      .teamPills .btn { padding: 8px 10px; border-radius: 12px; }
      .tinyBtn { padding: 6px 8px !important; border-radius: 10px !important; font-size: 12px !important; }
      .pill { display:inline-block; padding: 4px 10px; border-radius:999px; background: rgba(11,18,32,0.06); font-weight:950; }
      .inlineNote { margin-top:6px; }
      .captainHeading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .captainInfoButton { width:42px; height:42px; flex:0 0 42px; border:1px solid rgba(11,18,32,.13); border-radius:50%; background:#fff; color:#0b4961; font:950 20px/1 Georgia,serif; box-shadow:0 5px 16px rgba(11,73,97,.12); cursor:pointer; }
      .captainInfoButton:focus-visible { outline:3px solid #72d7fa; outline-offset:3px; }
      .captainGuide { border:0; padding:0; width:min(92vw,560px); border-radius:24px; color:#10232d; box-shadow:0 24px 80px rgba(2,14,22,.35); }
      .captainGuide::backdrop { background:rgba(2,14,22,.68); backdrop-filter:blur(3px); }
      .captainGuide__sheet { padding:24px; background:linear-gradient(145deg,#f7fcfe 0%,#eaf7fb 100%); }
      .captainGuide__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      .captainGuide__mark { display:grid; place-items:center; width:52px; height:52px; border-radius:16px; background:#0b4961; color:#ffe16a; font:950 25px/1 Georgia,serif; transform:rotate(-3deg); }
      .captainGuide__list { display:grid; gap:10px; margin:20px 0; padding:0; list-style:none; counter-reset:duty; }
      .captainGuide__list li { counter-increment:duty; display:grid; grid-template-columns:32px 1fr; gap:10px; align-items:start; padding:12px; border-radius:14px; background:rgba(255,255,255,.72); }
      .captainGuide__list li::before { content:counter(duty); display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:#0b4961; color:#fff; font-weight:900; }
      .captainGuide__note { padding:12px 14px; border-left:4px solid #f0b429; background:#fff8dc; border-radius:4px 12px 12px 4px; }
      .ratingProgress--pending { outline:2px solid #dc2626; outline-offset:-2px; }
      .ratingProgress--inProgress { outline:2px solid #eab308; outline-offset:-2px; }
      .ratingProgress--complete { outline:2px solid #16a34a; outline-offset:-2px; }
      .ratingProgressBadge { display:inline-flex; align-items:center; margin-left:8px; padding:3px 7px; border-radius:999px; font-size:10px; font-weight:900; line-height:1; vertical-align:middle; }
      .ratingProgressBadge--pending { background:#fee2e2; color:#991b1b; }
      .ratingProgressBadge--inProgress { background:#fef9c3; color:#854d0e; }
      .ratingProgressBadge--complete { background:#dcfce7; color:#166534; }
      .captainRosterAdd { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:end; margin-top:10px; }
      .captainRosterAdd__player,.captainRosterAdd__options { grid-column:1/-1; }
      .captainRosterAdd__options { display:flex; align-items:end; gap:8px; min-width:0; }
      .captainRosterAdd__options .field { flex:1 1 120px; }
      .captainRosterAdd .field { min-width:0; }
      .captainRosterAdd__button { width:auto !important; min-width:92px; padding-inline:14px; white-space:nowrap; }
      .captainPlayerResults { display:grid; gap:2px; max-height:190px; margin-top:4px; padding:4px; overflow:auto; border:1px solid #bdcbd4; border-radius:5px; background:#fff; box-shadow:0 8px 20px rgba(6,39,62,.12); }
      .captainPlayerResults[hidden] { display:none; }
      .captainPlayerResult { width:100%; min-height:38px; padding:7px 9px; border:0; border-radius:3px; color:#17344a; background:#f3f7f8; font-family:inherit; font-size:13px; font-weight:800; line-height:1.2; text-align:left; cursor:pointer; }
      .captainPlayerResult:hover,.captainPlayerResult:focus-visible { background:#dff1f7; outline:2px solid #72d7fa; }
      .captainPlayerResults__empty { padding:9px; color:#607783; font-size:12px; }
      .captainRosterSearch { margin-top:10px; }
      .captainRosterSearch .input { width:100%; }
      .captainAvailability { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:10px; }
      .captainAvailability__group { min-width:0; padding:7px; border:1px solid #d4dfe4; border-radius:5px; background:#f7fafb; }
      .captainAvailability__group--blue { border-top:4px solid #2563eb; }
      .captainAvailability__group--orange { border-top:4px solid #f97316; }
      .captainAvailability__group--unavailable { grid-column:1/-1; border-top:4px solid #c62828; }
      .captainAvailability__group h3 { margin:0 0 5px; color:#17344a; font-size:11px; }
      .captainAvailability__player { display:flex; align-items:center; justify-content:space-between; gap:4px; padding:4px 0; border-top:1px solid #e1e8ec; font-size:11px; font-weight:800; }
      .captainAvailability__player span { min-width:0; overflow-wrap:anywhere; }
      .captainAvailability__player small { flex:0 0 auto; padding:2px 4px; border-radius:3px; font-size:8px; font-weight:900; text-transform:uppercase; }
      .captainAvailability__player small.is-yes { color:#12603d; background:#dcfce7; }
      .captainAvailability__player small.is-no { color:#991b1b; background:#fee2e2; }
      .captainAvailability__player small.is-waiting { color:#854d0e; background:#fef3c7; }
      .captainAvailability__player small.is-added { color:#63308d; background:#f0e3ff; }
      .captainAvailability__empty { color:#607783; font-size:11px; }
    </style>

    <div class="card captainCommand">
      <div class="captainHeading"><div class="h1">${m.title}</div>${adminMode ? "" : `<button class="captainInfoButton" id="openCaptainGuide" type="button" aria-label="How captain ratings and boosts work" aria-haspopup="dialog">i</button>`}</div>
      <div class="row captainCommand__context">
        <span class="badge">${m.type}</span>
        <span class="badge">${m.status}</span>
      </div>
      <div class="small captainCommand__context" style="margin-top:10px">${when}</div>
      <div class="small captainCommand__context" style="margin-top:6px">${adminMode ? `<b>Admin scoring mode</b> · You can enter both sides and rate any player.` : `<b>Captain:</b> ${captain}${type === "INTERNAL" && captainTeam ? ` • <b>Your team:</b> ${captainTeam}` : ""}`}</div>
      ${(!adminMode && type === "INTERNAL" && captainTeam) ? `<div class="small inlineNote captainCommand__context">You can only rate/update <b>opponent</b> players.</div>` : ""}
      <div class="row captainCommand__context" style="margin-top:12px; gap:10px; flex-wrap:wrap">
        <button class="btn gray" id="openMatch">${adminMode ? "Back to match management" : "Open match"}</button>
      </div>
      <button class="btn primary captainWizardLauncher${!adminMode && hasStarted && !initialDutyStatus.complete ? " isDue" : ""}" id="openRatingWizard" type="button" aria-haspopup="dialog"><span>Open rating wizard</span><small id="ratingWizardProgress">${initialDutyStatus.completed}/${initialDutyStatus.required} rated</small></button>
    </div>

    ${adminMode ? "" : `<dialog class="captainGuide" id="captainGuide" aria-labelledby="captainGuideTitle"><div class="captainGuide__sheet"><div class="captainGuide__head"><div><div class="small stepEyebrow">Captain match duty</div><div class="h1" id="captainGuideTitle">Rate the opposition</div></div><div class="captainGuide__mark" aria-hidden="true">C</div></div><ol class="captainGuide__list"><li><div><b>Save as you go</b><br><span class="small">You can submit some players now and return later for the rest. Use 1–10 in 0.5 steps.</span></div></li><li><div><b>Record goals and assists</b><br><span class="small">When all players are entered, their goals must add up to the opponent score.</span></div></li><li><div><b>Use Boost with care</b><br><span class="small">Boost one FC Card attribute from PAC, SHO, PAS, DRI, DEF or PHY. Choose −3× to +3×, or leave it as None.</span></div></li></ol><p class="captainGuide__note"><b>Finish before your next availability response.</b> Red players are pending; yellow players have details entered but still need a valid rating. An admin can complete any remaining players.</p><button class="btn primary" id="closeCaptainGuide" type="button" style="width:100%;margin-top:16px">Got it</button></div></dialog>`}

    <div class="card"><div class="h1">Team positions</div><div class="small inlineNote">Update your own team on the half-field at any time before the match is completed and locked, including while entering ratings.</div><div id="captainField"></div>${adminMode ? "" : `<div class="field" style="margin-top:12px"><label class="field__label" for="captainShareMessage">Captain’s message (optional)</label><textarea id="captainShareMessage" class="input" rows="3" maxlength="500" placeholder="Add a message for the team…"></textarea></div>`}<div class="row" style="gap:10px; flex-wrap:wrap"><button class="btn primary" id="saveField">Save positions</button>${adminMode ? "" : `<button class="btn whatsappBtn" id="shareCaptainTeam" type="button">Share my team PNG</button>`}</div></div>
    <dialog class="captainWizard" id="captainRatingWizard" aria-labelledby="captainWizardTitle"><div class="captainWizard__sheet"><header class="captainWizard__head"><div><div class="small stepEyebrow">${adminMode ? "Admin match update" : "Captain match duty"}</div><div class="h1" id="captainWizardTitle">Complete match ratings</div></div><button class="captainWizard__close" id="closeRatingWizard" type="button" aria-label="Close rating wizard">×</button></header><div class="matchSteps captainWizard__steps" aria-label="Rating wizard progress">${stepButtonsHtml}</div><div class="captainWizard__body">
    <div class="card" id="stepScore">
      <div class="small stepEyebrow">Step 1 of 3</div><div class="h1">Update score</div>
      <div class="small">
        ${type === "INTERNAL" ? `Enter ${homeTeamName} vs ${awayTeamName} score.` : "Enter MLFC vs Opponent score."} ${hint}
      </div>
      ${hasStarted ? "" : `<div class="small inlineNote">Score entry unlocks at kick-off: ${when}.</div>`}

      ${
        (type === "INTERNAL" && captainTeam && !adminMode) ? `
          <div class="scoreGrid">
            <div class="scoreBox">
              <div class="scoreLabel">${visibleTeamName(captainTeam)} score (read-only)</div>
              <div class="scoreValue" id="homeScoreLabel">—</div>
              <div class="small muted">This will be filled when the other captain submits their opponent score.</div>
            </div>
            <div class="scoreBox">
              <div class="scoreLabel">Opponent (${visibleTeamName(opponentTeam)}) score (editable)</div>
              <input id="oppScoreInput" class="input" type="number" min="0" inputmode="numeric" aria-label="${opponentTeam} score" placeholder="Opponent score" style="margin-top:8px" />
              <div class="small muted">You can only edit opponent score</div>
            </div>
          </div>
        ` : `
          <div class="row" style="margin-top:10px">
            <div class="field" style="flex:1"><label class="field__label" for="scoreA">${type === "INTERNAL" ? homeTeamName : "MLFC"} score</label><input id="scoreA" class="input" type="number" min="0" inputmode="numeric" /></div>
            <div class="field" style="flex:1"><label class="field__label" for="scoreB">${type === "INTERNAL" ? awayTeamName : "Opponent"} score</label><input id="scoreB" class="input" type="number" min="0" inputmode="numeric" /></div>
          </div>
        `
      }

      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="submitScore" ${hasStarted ? "" : "disabled"}>${adminMode ? "Save both scores" : "Submit score"}</button>
      </div>
      <div class="small" id="scoreMsg" style="margin-top:10px"></div>
    </div>

    <div class="card" id="stepRoster" style="display:none">
      <div id="rosterSetup">
      <div class="small stepEyebrow">Step 2 of 3</div><div class="h1">Confirm roster</div>
      <div class="small">${adminMode
        ? (roster.length
          ? "Ratings use the teams saved for this match."
          : "No saved teams found. Go back to match management, assign players to both teams, and save setup before rating.")
        : type === "OPPONENT"
          ? "This is the saved MLFC team sheet. Ask an admin to change the selected squad."
          : "Roster starts from confirmed YES availability. Add more players if someone joins late."}</div>

      <details class="card" style="margin-top:10px" open>
        <summary style="font-weight:950">Teams and availability (${postedPlayers.length} responses)</summary>
        <div class="captainAvailability">
          <section class="captainAvailability__group captainAvailability__group--blue"><h3>${type === "INTERNAL" ? homeTeamName : "MLFC"} team</h3><div data-team-availability="${type === "INTERNAL" ? "BLUE" : "MLFC"}">${teamAvailabilityList(type === "INTERNAL" ? "BLUE" : "MLFC")}</div></section>
          ${type === "INTERNAL" ? `<section class="captainAvailability__group captainAvailability__group--orange"><h3>${awayTeamName} team</h3><div data-team-availability="ORANGE">${teamAvailabilityList("ORANGE")}</div></section>` : ""}
          <section class="captainAvailability__group captainAvailability__group--unavailable"><h3>Unavailable (${unavailablePlayers.length})${waitingPlayers.length ? ` · Waiting (${waitingPlayers.length})` : ""}</h3>${responseList(unavailablePlayers, "Unavailable", "no")}${waitingPlayers.length ? responseList(waitingPlayers, "Waiting", "waiting") : ""}</section>
        </div>
      </details>

      <div class="captainRosterAdd${adminMode ? " hasTeam" : ""}">
        <div class="field captainRosterAdd__player">
          <label class="field__label" for="addFromAll">Player</label>
          <input id="addFromAll" class="input" type="search" autocomplete="off" aria-label="Search for a player to add" aria-controls="addPlayerResults" aria-expanded="false" placeholder="Search player to add…" ${type === "OPPONENT" || !hasStarted ? "disabled" : ""} />
          <div id="addPlayerResults" class="captainPlayerResults" role="listbox" aria-label="Matching players" hidden></div>
        </div>
        <div class="captainRosterAdd__options">
          ${adminMode ? `<div class="field"><label class="field__label" for="addPlayerTeam">Team</label><select id="addPlayerTeam" class="input" ${type === "OPPONENT" || !hasStarted ? "disabled" : ""}><option value="BLUE">${homeTeamName}</option><option value="ORANGE">${awayTeamName}</option></select></div>` : ""}
          <div class="field"><label class="field__label" for="addPlayerPosition">Available position</label><select id="addPlayerPosition" class="input" ${type === "OPPONENT" || !hasStarted ? "disabled" : ""}></select></div>
          <button class="btn gray captainRosterAdd__button" id="addBtn" type="button" ${type === "OPPONENT" || !hasStarted ? "disabled" : ""}>Add player</button>
        </div>
      </div>
      ${hasStarted ? "" : `<div class="small inlineNote">Late-player additions unlock at kick-off.</div>`}

      <div id="ratingsGate" class="small" style="margin-top:12px">
          <button class="btn primary" id="continueToRatings" ${ratingsEnabled && roster.length ? "" : "disabled"}>Continue to ratings</button>
      </div>
      </div>

      <div id="ratingsSection" style="display:none">
        <div class="small stepEyebrow">Step 3 of 3</div><div class="h1">Add player stats</div>
        ${
        (!adminMode && type === "INTERNAL" && captainTeam) ? `
            <div class="small" style="margin-bottom:8px">
              <span class="pill">Rating</span> Rate <b>${opponentTeam}</b> players (switch a player to <b>${opponentTeam}</b> to show the rating box).
            </div>
          ` : `
            <div class="small" style="margin-bottom:8px">
              <span class="pill">Rating</span> Enter ratings for the players you want.
            </div>
          `
        }

        <div class="captainRosterSearch">
          <input id="search" class="input" type="search" aria-label="Search players in the roster" placeholder="Search players in roster…" />
        </div>

        <div id="rosterTableWrap" style="overflow:auto; border-radius:14px; border:1px solid rgba(11,18,32,0.10)">
          <table class="ratingDesktopTable">
            <colgroup><col class="ratingColPlayer"/><col class="ratingColTeam"/><col class="ratingColStat"/><col class="ratingColStat"/><col class="ratingColStat"/><col class="ratingColActions"/></colgroup>
            <thead>
              <tr style="background: rgba(11,18,32,0.04)">
                <th style="text-align:left; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Player</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Team</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Rating</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Goals</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Assists</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Boost / update</th>
              </tr>
            </thead>
            <tbody id="body"></tbody>
          </table>
        </div>

        <div id="rosterMobileWrap"></div>

        <div class="draftState isDirty" id="ratingsDraftState" role="status" aria-live="polite">Red is pending · yellow is in progress · save entered ratings at any time</div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="submitRatings">Save entered ratings</button>
        </div>
        <div class="small" id="rateMsg" style="margin-top:10px"></div>
      </div>
    </div>
    </div></div></dialog>
    <dialog class="playerActionDialog" id="playerActionDialog" aria-labelledby="playerActionTitle">
      <div class="playerActionDialog__sheet">
        <header>
          <div><div class="small stepEyebrow">Player actions</div><div class="h1" id="playerActionTitle">Update player</div></div>
          <button class="playerActionDialog__close" id="closePlayerActions" type="button" aria-label="Close player actions">×</button>
        </header>
        <div class="playerActionDialog__body">
          <div class="playerActionDialog__team" id="playerActionTeam"></div>
          <div class="playerActionDialog__actions" id="playerActionButtons"></div>
        </div>
      </div>
    </dialog>
  `;

  installCaptainCommandScrollBehavior(root);

  let captainGuideDialog = null;
  let openCaptainGuide = () => {};
  let shouldAutoOpenCaptainGuide = false;
  if (!adminMode) {
    captainGuideDialog = root.querySelector("#captainGuide");
    openCaptainGuide = () => {
      if (captainGuideDialog && !captainGuideDialog.open) captainGuideDialog.showModal();
    };
    root.querySelector("#openCaptainGuide")?.addEventListener("click", openCaptainGuide);
    root.querySelector("#closeCaptainGuide")?.addEventListener("click", () => captainGuideDialog?.close());
    captainGuideDialog?.addEventListener("click", (event) => { if (event.target === captainGuideDialog) captainGuideDialog.close(); });
    const guideKey = captainGuideKey(code, captain);
    if (!lsGet(guideKey)) {
      lsSet(guideKey, { shownAt: Date.now() });
      shouldAutoOpenCaptainGuide = true;
    }
  }

  const ownTeams = type === "INTERNAL" ? (adminMode ? ["BLUE","ORANGE"] : [captainTeam]) : ["MLFC"];
  const fieldGroups = (type === "INTERNAL" ? ["BLUE","ORANGE"] : ["MLFC"]).map(team => ({team, label:team === "BLUE" ? String(m.teamHomeName || "Blue") : team === "ORANGE" ? String(m.teamAwayName || "Orange") : "MLFC", players:(data.teams || []).filter(r => r.team === team).map(r => r.playerName), captain:team === "ORANGE" ? capt.captain2 : capt.captain1}));
  const fieldPositions = positionMap(data.teams);
  const fieldPhotos = Object.fromEntries((data.teams || []).filter(row => row.photoUrl).map(row => [row.playerName, row.photoUrl]));
  const restoredFieldDraft = lsGet(fieldDraftKey(code, captain));
  if (Array.isArray(restoredFieldDraft?.positions)) {
    const ownPlayers = new Set(fieldGroups.filter(group => ownTeams.includes(group.team)).flatMap(group => group.players));
    Object.assign(fieldPositions, positionMap(restoredFieldDraft.positions.filter(row => ownPlayers.has(row.playerName))));
  }
  const persistFieldDraft = () => lsSet(fieldDraftKey(code, captain), {
    ts:Date.now(),
    positions:positionRows(fieldGroups.filter(group => ownTeams.includes(group.team)), fieldPositions)
  });
  const captainFieldGroups = adminMode ? fieldGroups : fieldGroups.filter(group => ownTeams.includes(group.team));
  const fieldEditor = mountTeamField(root.querySelector("#captainField"), {groups:captainFieldGroups,positions:fieldPositions,photos:fieldPhotos,editableTeams:ownTeams,halfField:!adminMode,disabled:false,onSave:() => root.querySelector("#saveField").click(),onDraft:persistFieldDraft,onChange:() => { persistFieldDraft(); fieldEditor.status("Unsaved positions"); }});
  const addPlayerTeamSelect = root.querySelector("#addPlayerTeam");
  const addPlayerPositionSelect = root.querySelector("#addPlayerPosition");
  const renderAvailableAddPositions = () => {
    if (!addPlayerPositionSelect) return;
    const selectedTeam = adminMode ? safeUpper(addPlayerTeamSelect?.value) : opponentTeam;
    const team = fieldGroups.find(group => group.team === selectedTeam);
    const occupied = new Set((team?.players || []).map(player => fieldPositionCode(fieldPositions[player])).filter(Boolean));
    const available = FIELD_POSITIONS.filter(position => !occupied.has(position.code));
    addPlayerPositionSelect.innerHTML = `<option value="">${available.length ? "Choose…" : "No positions available"}</option>${available.map(position => `<option value="${position.code}">${position.code} · ${position.name}</option>`).join("")}`;
    addPlayerPositionSelect.disabled = type === "OPPONENT" || !hasStarted || !available.length;
    const addButton = root.querySelector("#addBtn");
    if (addButton) addButton.disabled = type === "OPPONENT" || !hasStarted || !available.length;
  };
  addPlayerTeamSelect?.addEventListener("change", renderAvailableAddPositions);
  renderAvailableAddPositions();
  if (Array.isArray(restoredFieldDraft?.positions)) fieldEditor.status("Local draft restored");
  root.querySelector("#shareCaptainTeam")?.addEventListener("click", async () => {
    const team = fieldGroups.find(group => ownTeams.includes(group.team));
    if (!team || !team.players.length) return toastWarn("No players are assigned to your team yet.");
    const button = root.querySelector("#shareCaptainTeam");
    setDisabled(button, true, "Preparing…");
    try {
      const file = await captainTeamImageFile(m, when, team, fieldPositions);
      if (!file) throw new Error("Could not create the team image.");
      const captainMessage = String(root.querySelector("#captainShareMessage")?.value || "").trim();
      const text = [`${m.title} · ${team.label}`, captainMessage].filter(Boolean).join("\n\n");
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${team.label} team sheet`, text, files: [file] });
        toastSuccess("Team PNG shared.");
      } else {
        downloadFile(file);
        if (text) window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
        toastInfo("Team PNG downloaded. Attach it to your message.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") toastError(error?.message || "Team image could not be shared.");
    } finally { setDisabled(button, false); }
  });
  const saveFieldButton = root.querySelector("#saveField");
  if (saveFieldButton) saveFieldButton.onclick = async () => {
    const button = root.querySelector("#saveField"); button.disabled = true;
    try {
      for (const g of fieldGroups.filter(g => ownTeams.includes(g.team))) {
        const out = await API.saveTeamPositions(code,g.team,positionRows([g],fieldPositions));
        if (!out.ok) throw new Error(out.error || "Could not save positions");
      }
      localStorage.removeItem(`mlfc_match_detail_cache_v2:${code}`);
      localStorage.removeItem(`mlfc_next_match_cache_v1:${captain.toLowerCase()}`);
      localStorage.removeItem(fieldDraftKey(code, captain));
      fieldEditor.status("Positions saved"); toastSuccess("Team positions saved.");
    } catch(e) { fieldEditor.status(e.message); toastError(e.message); }
    finally { button.disabled = false; }
  };

  let currentStage = 1;

  function updateStepAvailability() {
    const ratingsReady = ratingsEnabled && roster.length > 0;
    const ratingsStep = root.querySelector('[data-step-dot="3"]');
    const continueButton = root.querySelector("#continueToRatings");
    if (ratingsStep) ratingsStep.disabled = !ratingsReady;
    if (continueButton) continueButton.disabled = !ratingsReady;
    updateWizardProgress();
    return ratingsReady;
  }

  function updateWizardProgress() {
    const launcher = root.querySelector("#openRatingWizard");
    const progress = root.querySelector("#ratingWizardProgress");
    if (!launcher || !progress) return;
    const duty = ratingDutyStatus();
    launcher.classList.toggle("isComplete", duty.complete);
    launcher.classList.toggle("isDue", !adminMode && hasStarted && !duty.complete);
    const label = launcher.querySelector("span");
    if (label) label.textContent = duty.complete ? "Review rating wizard" : "Open rating wizard";
    progress.textContent = `${duty.completed}/${duty.required} rated`;
  }

  function showStage(stage, { scroll = true } = {}) {
    const requestedStage = Number(stage);
    if (requestedStage === 3 && !updateStepAvailability()) {
      toastWarn("Update the score and confirm a roster before opening ratings.");
      return;
    }
    currentStage = requestedStage;
    root.querySelector("#stepScore").style.display = stage === 1 ? "block" : "none";
    root.querySelector("#stepRoster").style.display = stage >= 2 ? "block" : "none";
    root.querySelector("#rosterSetup").style.display = stage === 2 ? "block" : "none";
    root.querySelector("#ratingsSection").style.display = stage === 3 ? "block" : "none";
    root.querySelectorAll("[data-step-dot]").forEach(el => {
      const active = Number(el.dataset.stepDot) === stage;
      el.classList.toggle("isActive", active);
      if (active) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    if (scroll) {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const target = stage === 1 ? root.querySelector("#stepScore") : root.querySelector("#stepRoster");
      target?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }
  root.querySelectorAll("[data-step-dot]").forEach(button => {
    button.addEventListener("click", () => showStage(Number(button.dataset.stepDot)));
  });
  updateStepAvailability();
  const preferredWizardStage = () => !ratingsEnabled ? 1 : (roster.length ? 3 : 2);
  const initialStage = preferredWizardStage();
  showStage(initialStage, { scroll:false });
  root.querySelector("#continueToRatings").onclick = () => showStage(3);

  const wizard = root.querySelector("#captainRatingWizard");
  const openWizard = () => {
    if (!wizard || !document.body.contains(wizard)) return;
    if (!wizard.open) wizard.showModal();
    showStage(preferredWizardStage(), { scroll:false });
  };
  root.querySelector("#openRatingWizard")?.addEventListener("click", openWizard);
  root.querySelector("#closeRatingWizard")?.addEventListener("click", () => wizard?.close());
  wizard?.addEventListener("click", (event) => { if (event.target === wizard) wizard.close(); });
  const autoOpenWizard = () => {
    if (hasStarted && document.body.contains(wizard) && !ratingDutyStatus().complete) openWizard();
  };
  if (!adminMode && shouldAutoOpenCaptainGuide) {
    captainGuideDialog?.addEventListener("close", autoOpenWizard, { once:true });
    requestAnimationFrame(openCaptainGuide);
  } else {
    requestAnimationFrame(autoOpenWizard);
  }

  // Prefill score UI (no extra fetch)
  try {
    if (!adminMode && type === "INTERNAL" && captainTeam) {
      const homeLabel = root.querySelector("#homeScoreLabel");
      const oppInput = root.querySelector("#oppScoreInput");
      const homeScore = (captainTeam === "BLUE") ? String(m.scoreHome ?? "").trim() : String(m.scoreAway ?? "").trim();
      const oppScore = (captainTeam === "BLUE") ? String(m.scoreAway ?? "").trim() : String(m.scoreHome ?? "").trim();

      if (homeLabel) homeLabel.textContent = homeScore === "" ? "—" : homeScore;
      if (oppInput && oppScore !== "") oppInput.value = oppScore;
    } else {
      const sA = root.querySelector("#scoreA");
      const sB = root.querySelector("#scoreB");
      if (sA && String(m.scoreHome || "").trim() !== "") sA.value = Number(m.scoreHome);
      if (sB && String(m.scoreAway || "").trim() !== "") sB.value = Number(m.scoreAway);
    }
  } catch {}

  root.querySelector("#openMatch").onclick = () => {
    location.hash = adminMode
      ? `#/admin?view=manage&code=${encodeURIComponent(code)}&prev=open`
      : `#/match?code=${encodeURIComponent(code)}`;
  };

  root.querySelector("#submitScore").onclick = async () => {
    const btn = root.querySelector("#submitScore");
    const msg = root.querySelector("#scoreMsg");

    setDisabled(btn, true, "Submitting…");
    msg.textContent = "Submitting…";

    try {
      let out;

      if (!adminMode && type === "INTERNAL" && captainTeam) {
        const oppInput = root.querySelector("#oppScoreInput");
        const oppVal = clampInt(String(oppInput?.value ?? "").trim(), 0, 99);
        if (oppVal == null) {
          toastWarn("Enter a valid opponent score (0-99).");
          msg.textContent = "Invalid opponent score";
          return;
        }

        // Partial update: send only opponent side (backend supports COALESCE)
        if (captainTeam === "BLUE") {
          out = await API.captainSubmitScore(code, "INTERNAL", "", String(oppVal), getScopeFromHash());
        } else {
          out = await API.captainSubmitScore(code, "INTERNAL", String(oppVal), "", getScopeFromHash());
        }

        if (!out?.ok) {
          msg.textContent = out?.error || "Failed";
          toastError(out?.error || "Score submit failed");
          return;
        }

        m.scoreHome = String(out.scoreHome ?? m.scoreHome ?? "");
        m.scoreAway = String(out.scoreAway ?? m.scoreAway ?? "");

        msg.textContent = "Submitted ✅";
        toastSuccess("Opponent score submitted.");

        ratingsEnabled = true;
        updateStepAvailability();
        renderRows();
        showStage(roster.length ? 3 : 2);
      } else {
        const sAEl = root.querySelector("#scoreA");
        const sBEl = root.querySelector("#scoreB");
        const a = clampInt(String(sAEl?.value ?? "").trim(), 0, 99);
        const b = clampInt(String(sBEl?.value ?? "").trim(), 0, 99);
        if (a == null || b == null) {
          toastWarn("Enter valid scores (0-99).");
          msg.textContent = "Invalid score";
          return;
        }

        out = adminMode
          ? await API.adminSubmitScore(code, type === "INTERNAL" ? "INTERNAL" : "OPPONENT", String(a), String(b))
          : await API.captainSubmitScore(code, type === "INTERNAL" ? "INTERNAL" : "OPPONENT", String(a), String(b), getScopeFromHash());

        if (!out.ok) {
          msg.textContent = out.error || "Failed";
          toastError(out.error || "Score submit failed");
          return;
        }

        m.scoreHome = String(out.scoreHome ?? a);
        m.scoreAway = String(out.scoreAway ?? b);

        msg.textContent = "Submitted ✅";
        toastSuccess("Score submitted.");

        ratingsEnabled = true;
        updateStepAvailability();
        renderRows();
        showStage(roster.length ? 3 : 2);
      }

      // Update label if present
      if (type === "INTERNAL" && captainTeam) {
        const homeLabel = root.querySelector("#homeScoreLabel");
        const homeScore = (captainTeam === "BLUE") ? String(m.scoreHome ?? "").trim() : String(m.scoreAway ?? "").trim();
        if (homeLabel) homeLabel.textContent = homeScore === "" ? "—" : homeScore;
      }

      try {
        localStorage.removeItem(`mlfc_match_detail_cache_v2:${code}`);
        localStorage.removeItem(`mlfc_admin_manage_cache_v3:${code}`);
        if (m.seasonId) localStorage.removeItem(`mlfc_admin_matches_cache_v3:${m.seasonId}`);
      } catch {}
    } catch (e) {
      msg.textContent = "Failed";
      toastError(e?.message || "Score submit failed");
    } finally {
      setDisabled(btn, false);
    }
  };

  const bodyEl = root.querySelector("#body");
  const mobileWrap = root.querySelector("#rosterMobileWrap");
  const searchEl = root.querySelector("#search");
  const isInternalCaptainView = !adminMode && type === "INTERNAL" && captainTeam && opponentTeam;
  const isOpponentMatch = type !== "INTERNAL";
  const playerActionDialog = root.querySelector("#playerActionDialog");
  const playerActionTitle = root.querySelector("#playerActionTitle");
  const playerActionTeam = root.querySelector("#playerActionTeam");
  const playerActionButtons = root.querySelector("#playerActionButtons");

  const assignPlayerTeam = (playerName, team) => {
    teamMap[playerName] = team;
    saveTeamsLocal();
    renderRows();
  };

  const movePlayer = (playerName, destination) => {
    assignPlayerTeam(playerName, destination === "MY" ? captainTeam : opponentTeam);
  };

  const removePlayer = (playerName) => {
    roster = roster.filter(name => name !== playerName);
    saveRosterLocal();
    renderRows();
  };

  const removeNoShow = async (playerName, button) => {
    if (!window.confirm(`Remove ${playerName} as a no-show? They will not count as playing in this match.`)) return false;
    setDisabled(button, true, "Removing…");
    try {
      const out = await API.captainRemoveNoShow(code, playerName);
      if (!out.ok) throw new Error(out.error || "Could not remove player");
      roster = roster.filter(name => name.toLowerCase() !== playerName.toLowerCase());
      delete drafts[playerName];
      delete teamMap[playerName];
      ratingCoverage.delete(playerName.toLowerCase());
      saveRosterLocal();
      saveTeamsLocal();
      saveRatingsDraft();
      renderRows();
      updateWizardProgress();
      toastSuccess(`${playerName} removed as a no-show.`);
      return true;
    } catch (error) {
      setDisabled(button, false, "Removing…");
      toastError(error?.message || "Could not remove player");
      return false;
    }
  };

  function openPlayerActions(playerName) {
    if (!playerActionDialog || !playerActionButtons) return;
    const team = safeUpper(teamMap[playerName] || "BLUE");
    if (playerActionTitle) playerActionTitle.textContent = playerName;
    if (playerActionTeam) playerActionTeam.innerHTML = `Current team <b>${visibleTeamName(team)}</b>`;

    if (isInternalCaptainView) {
      const onMyTeam = team === captainTeam;
      playerActionButtons.innerHTML = `
        <button class="btn gray" type="button" data-action-move="${onMyTeam ? "OPP" : "MY"}">${onMyTeam ? "Move to opponent" : "Move to my team"}</button>
        ${isOpponentPlayer(playerName) ? `<button class="btn bad" type="button" data-action-no-show>Didn't play</button>` : ""}
      `;
    } else if (!isOpponentMatch) {
      playerActionButtons.innerHTML = `
        <button class="btn good" type="button" data-action-team="BLUE" ${team === "BLUE" ? "disabled" : ""}>Move to ${homeTeamName}</button>
        <button class="btn warn" type="button" data-action-team="ORANGE" ${team === "ORANGE" ? "disabled" : ""}>Move to ${awayTeamName}</button>
        <button class="btn gray playerActionDialog__remove" type="button" data-action-remove>Remove from match</button>
      `;
    } else {
      playerActionButtons.innerHTML = `<div class="small muted">This player’s team is managed from match setup.</div>`;
    }

    playerActionButtons.querySelector("[data-action-move]")?.addEventListener("click", event => {
      movePlayer(playerName, event.currentTarget.dataset.actionMove);
      playerActionDialog.close();
    });
    playerActionButtons.querySelectorAll("[data-action-team]").forEach(button => button.addEventListener("click", () => {
      assignPlayerTeam(playerName, button.dataset.actionTeam);
      playerActionDialog.close();
    }));
    playerActionButtons.querySelector("[data-action-remove]")?.addEventListener("click", () => {
      removePlayer(playerName);
      playerActionDialog.close();
    });
    playerActionButtons.querySelector("[data-action-no-show]")?.addEventListener("click", async event => {
      if (await removeNoShow(playerName, event.currentTarget)) playerActionDialog.close();
    });

    if (!playerActionDialog.open) playerActionDialog.showModal();
  }

  root.querySelector("#closePlayerActions")?.addEventListener("click", () => playerActionDialog?.close());
  playerActionDialog?.addEventListener("click", event => { if (event.target === playerActionDialog) playerActionDialog.close(); });

  function ratingProgress(playerName, canEdit = true) {
    if (!canEdit) return { className: "", label: "", tone: "" };
    const d = drafts[playerName] || {};
    const ratingRaw = String(d.rating ?? "").trim();
    const hasValidRating = clampHalfRating(ratingRaw, 1, 10) != null;
    const hasOtherEntry = String(d.goals ?? "").trim() !== "" || String(d.assists ?? "").trim() !== "" || String(d.boostAttribute || "").trim() !== "";
    if (hasValidRating || ratingCoverage.has(String(playerName || "").trim().toLowerCase())) {
      return { className: "ratingProgress--complete", label: "Rated", tone: "complete" };
    }
    if (ratingRaw || hasOtherEntry) return { className: "ratingProgress--inProgress", label: "In progress", tone: "inProgress" };
    return { className: "ratingProgress--pending", label: "Pending", tone: "pending" };
  }

  function progressBadge(progress) {
    return progress.label ? `<span class="ratingProgressBadge ratingProgressBadge--${progress.tone}" data-rating-progress-badge>${progress.label}</span>` : "";
  }

  function updatePlayerProgress(playerName) {
    root.querySelectorAll("[data-rating-progress]").forEach(el => {
      if (decodeURIComponent(el.getAttribute("data-rating-progress") || "") !== playerName) return;
      const progress = ratingProgress(playerName);
      el.classList.remove("ratingProgress--pending", "ratingProgress--inProgress", "ratingProgress--complete");
      if (progress.className) el.classList.add(progress.className);
      const badge = el.querySelector("[data-rating-progress-badge]");
      if (badge) {
        badge.className = `ratingProgressBadge ratingProgressBadge--${progress.tone}`;
        badge.textContent = progress.label;
      }
    });
  }

  function renderRows() {
    const f = String(searchEl.value || "").trim().toLowerCase();
    const list = f ? roster.filter(p => p.toLowerCase().includes(f)) : roster;

    const ordered = [...list].sort((a, b) => {
      const aRateable = !!(ratingsEnabled && isOpponentPlayer(a));
      const bRateable = !!(ratingsEnabled && isOpponentPlayer(b));
      if (aRateable !== bRateable) return aRateable ? -1 : 1;
      return String(a).localeCompare(String(b));
    });

    const oppList = isInternalCaptainView ? ordered.filter(p => isOpponentPlayer(p)) : ordered;
    const myList = isInternalCaptainView ? ordered.filter(p => !isOpponentPlayer(p)) : [];

    const boostControlHtml=(p,canEdit)=>{
      if(!canEdit) return "";
      const d=drafts[p]||{};
      return `<div class="ratingBoost"><span>Boost</span><select class="input" data-boost-attribute="${encodeURIComponent(p)}" aria-label="Boost attribute for ${p}"><option value="">None</option>${["PAC","SHO","PAS","DRI","DEF","PHY"].map(value=>`<option value="${value}"${d.boostAttribute===value?" selected":""}>${value}</option>`).join("")}</select><select class="input" data-boost-multiplier="${encodeURIComponent(p)}" aria-label="Boost strength for ${p}">${[-3,-2,-1,1,2,3].map(value=>`<option value="${value}"${Number(d.boostMultiplier||1)===value?" selected":""}>${value>0?"+":""}${value}×</option>`).join("")}</select></div>`;
    };

    function playerCardHtml(p) {
      const tm = safeUpper(teamMap[p] || "BLUE");
      const canEdit = ratingsEnabled && isOpponentPlayer(p);
      const d = drafts[p] || {};
      const progress = ratingProgress(p, canEdit);

      const ratingInput = canEdit
        ? `<input class="input ratingStatInput" data-rating="${encodeURIComponent(p)}" type="number" min="1" max="10" step="0.5" inputmode="decimal" placeholder="1–10" value="${d.rating ?? ""}" />`
        : `<div class="small muted">—</div>`;

      const goalsInput = canEdit
        ? `<input class="input ratingStatInput" data-goals="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" value="${d.goals ?? ""}" />`
        : `<div class="small muted">—</div>`;

      const assistsInput = canEdit
        ? `<input class="input ratingStatInput" data-assists="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" value="${d.assists ?? ""}" />`
        : `<div class="small muted">—</div>`;
      const hasPlayerActions = isInternalCaptainView || !isOpponentMatch;

      return `
        <div class="rosterCard ${progress.className}" ${canEdit ? `data-rating-progress="${encodeURIComponent(p)}"` : ""}>
          <div class="ratingPlayerHead">
            <div><div class="ratingPlayerName">${escapeHtml(p)}${progressBadge(progress)}</div><div class="ratingPlayerTeam">${visibleTeamName(tm)} team</div></div>
            ${hasPlayerActions ? `<button class="ratingPlayerUpdate" type="button" data-player-actions="${encodeURIComponent(p)}" aria-label="Update ${escapeHtml(p)}">Update</button>` : ""}
          </div>

          ${canEdit ? `
            <div class="rosterGrid rosterGrid--ratings">
              <div>
                <div class="ratingStatLabel">Rating</div>
                ${ratingInput}
              </div>
              <div>
                <div class="ratingStatLabel">Goals</div>
                ${goalsInput}
              </div>
              <div>
                <div class="ratingStatLabel">Assists</div>
                ${assistsInput}
              </div>
            </div>
            ${boostControlHtml(p,canEdit)}
          ` : `
            <div class="small muted" style="margin-top:10px">${ratingsEnabled ? "No rating box (not opponent)." : "Ratings unlock at kick-off."}</div>
          `}
        </div>
      `;
    }

    // Desktop table is kept for admin + wide screens only
    if (!isInternalCaptainView && !isOpponentMatch) {
      const tableHtml = ordered.map(p => {
        const tm = safeUpper(teamMap[p] || "BLUE");
        const canEdit = ratingsEnabled && isOpponentPlayer(p);
        const d = drafts[p] || {};
        const progress = ratingProgress(p, canEdit);
        const ratingCell = canEdit
          ? `<input class="input ratingTableInput" data-rating="${encodeURIComponent(p)}" type="number" min="1" max="10" step="0.5" inputmode="decimal" placeholder="1–10" value="${d.rating ?? ""}" />`
          : `<span class="small muted">—</span>`;
        const goalsCell = canEdit
          ? `<input class="input ratingTableInput" data-goals="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" value="${d.goals ?? ""}" />`
          : `<span class="small muted">—</span>`;
        const assistsCell = canEdit
          ? `<input class="input ratingTableInput" data-assists="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" value="${d.assists ?? ""}" />`
          : `<span class="small muted">—</span>`;
        return `
          <tr class="${progress.className}" ${canEdit ? `data-rating-progress="${encodeURIComponent(p)}"` : ""} style="border-top:1px solid rgba(11,18,32,0.06)">
            <td style="padding:10px; font-weight:950">${escapeHtml(p)}${progressBadge(progress)}</td>
            <td style="padding:10px; text-align:center"><span class="ratingTeamBadge ratingTeamBadge--${tm === "ORANGE" ? "orange" : "blue"}">${visibleTeamName(tm)}</span></td>
            <td style="padding:10px; text-align:center">${ratingCell}</td>
            <td style="padding:10px; text-align:center">${goalsCell}</td>
            <td style="padding:10px; text-align:center">${assistsCell}</td>
            <td style="padding:10px; text-align:center">
              <div class="ratingTableActions">${boostControlHtml(p,canEdit)}<button class="ratingPlayerUpdate" type="button" data-player-actions="${encodeURIComponent(p)}" aria-label="Update ${escapeHtml(p)}">Update</button></div>
            </td>
          </tr>
        `;
      }).join("") || `<tr><td colspan="6" class="small" style="padding:12px">No players in roster.</td></tr>`;
      bodyEl.innerHTML = tableHtml;
      mobileWrap.innerHTML = ordered.map(playerCardHtml).join("") || `<div class="small">No players in roster.</div>`;
    } else {
      // Internal captain view or opponent match:
      // Keep table rows for desktop (tbody must contain <tr>), and render the clearer
      // sectioned card layout into the dedicated mobile container.

      const tableHtml = ordered.map(p => {
        const tm = safeUpper(teamMap[p] || "BLUE");
        const canEdit = ratingsEnabled && isOpponentPlayer(p);
        const d = drafts[p] || {};
        const progress = ratingProgress(p, canEdit);

        const ratingCell = canEdit
          ? `<input class="input ratingTableInput" data-rating="${encodeURIComponent(p)}" type="number" min="1" max="10" step="0.5" inputmode="decimal" placeholder="1–10" value="${d.rating ?? ""}" />`
          : `<div class="small muted">—</div>`;

        const goalsCell = canEdit
          ? `<input class="input ratingTableInput" data-goals="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" value="${d.goals ?? ""}" />`
          : `<div class="small muted">—</div>`;

        const assistsCell = canEdit
          ? `<input class="input ratingTableInput" data-assists="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" value="${d.assists ?? ""}" />`
          : `<div class="small muted">—</div>`;

        const updateButton = isInternalCaptainView
          ? `<button class="ratingPlayerUpdate" type="button" data-player-actions="${encodeURIComponent(p)}" aria-label="Update ${escapeHtml(p)}">Update</button>`
          : ``;

        return `
          <tr class="${progress.className}" ${canEdit ? `data-rating-progress="${encodeURIComponent(p)}"` : ""} style="border-top:1px solid rgba(11,18,32,0.08)">
            <td style="padding:10px">${escapeHtml(p)}${progressBadge(progress)}</td>
            <td style="padding:10px; text-align:center"><span class="ratingTeamBadge ratingTeamBadge--${tm === "ORANGE" ? "orange" : "blue"}">${visibleTeamName(tm)}</span></td>
            <td style="padding:10px; text-align:center">${ratingCell}</td>
            <td style="padding:10px; text-align:center">${goalsCell}</td>
            <td style="padding:10px; text-align:center">${assistsCell}</td>
            <td style="padding:10px; text-align:center"><div class="ratingTableActions">${boostControlHtml(p,canEdit)}${updateButton || `<span class="small muted">Admin managed</span>`}</div></td>
          </tr>
        `;
      }).join("") || `<tr><td colspan="6" class="small" style="padding:12px">No players in roster.</td></tr>`;

      bodyEl.innerHTML = tableHtml;

      // Mobile: the instruction above already identifies the opponent team, so
      // keep rateable cards flat and reserve a container only for my team.
      mobileWrap.innerHTML = `
        ${isInternalCaptainView ? `
          ${oppList.map(playerCardHtml).join("") || `<div class="small" style="margin-top:8px">No opponent players.</div>`}
          <details class="card" style="margin-top:10px">
            <summary style="font-weight:950">My team (collapsed)</summary>
            <div style="margin-top:8px">${myList.map(playerCardHtml).join("") || `<div class="small">No players.</div>`}</div>
          </details>
        ` : `
          <div class="card" style="margin-top:10px">
            ${ordered.map(playerCardHtml).join("") || `<div class="small">No players.</div>`}
          </div>
        `}
      `;
    }

    // Bind move/team/remove
    root.querySelectorAll("[data-player-actions]").forEach(button => {
      button.onclick = () => openPlayerActions(decodeURIComponent(button.dataset.playerActions));
    });

    root.querySelectorAll("[data-team]").forEach(btn => {
      btn.onclick = () => {
        const team = btn.getAttribute("data-team");
        const p = decodeURIComponent(btn.getAttribute("data-p"));
        assignPlayerTeam(p, team);
      };
    });

    root.querySelectorAll("[data-move]").forEach(btn => {
      btn.onclick = () => {
        const p = decodeURIComponent(btn.getAttribute("data-move"));
        const to = btn.getAttribute("data-move-to");
        movePlayer(p, to);
      };
    });

    root.querySelectorAll("[data-remove]").forEach(btn => {
      btn.onclick = () => {
        const p = decodeURIComponent(btn.getAttribute("data-remove"));
        removePlayer(p);
      };
    });

    root.querySelectorAll("[data-no-show]").forEach(btn => {
      btn.onclick = () => removeNoShow(decodeURIComponent(btn.getAttribute("data-no-show")), btn);
    });

    root.querySelectorAll("[data-rating]").forEach(inp => {
      inp.addEventListener("input", () => {
        const p = decodeURIComponent(inp.getAttribute("data-rating"));

        drafts[p] = drafts[p] || {};
        drafts[p].rating = String(inp.value ?? "");
        saveRatingsDraft();
        updatePlayerProgress(p);
      });
    });
    root.querySelectorAll("[data-goals]").forEach(inp => {
      inp.addEventListener("input", () => {
        const p = decodeURIComponent(inp.getAttribute("data-goals"));
        drafts[p] = drafts[p] || {};
        drafts[p].goals = String(inp.value ?? "");
        saveRatingsDraft();
        updatePlayerProgress(p);
      });
    });
    root.querySelectorAll("[data-assists]").forEach(inp => {
      inp.addEventListener("input", () => {
        const p = decodeURIComponent(inp.getAttribute("data-assists"));
        drafts[p] = drafts[p] || {};
        drafts[p].assists = String(inp.value ?? "");
        saveRatingsDraft();
        updatePlayerProgress(p);
      });
    });
    root.querySelectorAll("[data-boost-attribute]").forEach(input=>input.addEventListener("change",()=>{
      const p=decodeURIComponent(input.dataset.boostAttribute);drafts[p]=drafts[p]||{};drafts[p].boostAttribute=input.value;drafts[p].boostMultiplier=input.value?Number(drafts[p].boostMultiplier||1):0;saveRatingsDraft();renderRows();
    }));
    root.querySelectorAll("[data-boost-multiplier]").forEach(input=>input.addEventListener("change",()=>{
      const p=decodeURIComponent(input.dataset.boostMultiplier);drafts[p]=drafts[p]||{};drafts[p].boostMultiplier=Number(input.value||1);saveRatingsDraft();
    }));
    const ratingsReady = updateStepAvailability();
    if (currentStage === 3 && !ratingsReady) showStage(2);
  }

  renderRows();
  searchEl.addEventListener("input", renderRows);

  const addPlayerInput = root.querySelector("#addFromAll");
  const addPlayerResults = root.querySelector("#addPlayerResults");
  const hideAddPlayerResults = () => {
    if (!addPlayerResults || !addPlayerInput) return;
    addPlayerResults.hidden = true;
    addPlayerInput.setAttribute("aria-expanded", "false");
  };
  const renderAddPlayerResults = () => {
    if (!addPlayerResults || !addPlayerInput || addPlayerInput.disabled) return hideAddPlayerResults();
    const queryText = String(addPlayerInput.value || "").trim().toLowerCase();
    if (!queryText) return hideAddPlayerResults();
    const matches = allPlayers
      .filter(player => player.toLowerCase().includes(queryText))
      .filter(player => !roster.some(name => name.toLowerCase() === player.toLowerCase()))
      .slice(0, 12);
    addPlayerResults.innerHTML = matches.length
      ? matches.map(player => `<button class="captainPlayerResult" type="button" role="option" data-add-player="${encodeURIComponent(player)}">${escapeHtml(player)}</button>`).join("")
      : `<div class="captainPlayerResults__empty">No unassigned players found.</div>`;
    addPlayerResults.hidden = false;
    addPlayerInput.setAttribute("aria-expanded", "true");
    addPlayerResults.querySelectorAll("[data-add-player]").forEach(button => {
      const choosePlayer = () => {
        addPlayerInput.value = decodeURIComponent(button.dataset.addPlayer || "");
        hideAddPlayerResults();
        addPlayerInput.focus();
      };
      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        choosePlayer();
      });
      button.addEventListener("click", choosePlayer);
    });
  };
  addPlayerInput?.addEventListener("input", renderAddPlayerResults);
  addPlayerInput?.addEventListener("focus", () => {
    renderAddPlayerResults();
    // Registration may have happened while this captain page was already open.
    // Refresh in place so the new player becomes searchable without a reload.
    refreshAllPlayers().then(() => {
      if (document.activeElement === addPlayerInput) renderAddPlayerResults();
    }).catch(() => {});
  });
  addPlayerInput?.addEventListener("blur", () => setTimeout(hideAddPlayerResults, 150));

  root.querySelector("#addBtn").onclick = async () => {
    if (type === "OPPONENT") return toastWarn("Assign players in match management and save setup first.");
    if (!hasStarted || (!adminMode && (!ratingsEnabled || !opponentTeam))) return toastWarn("Late players can be added after kick-off and score entry.");
    const sel = root.querySelector("#addFromAll");
    const p = String(sel.value || "").trim();
    if (!p) return toastWarn("Select a player to add.");
    const registeredPlayer = allPlayers.find(name => name.toLowerCase() === p.toLowerCase());
    if (!registeredPlayer) return toastWarn("Choose a registered player from the search suggestions.");
    if (roster.some(x => x.toLowerCase() === p.toLowerCase())) return toastWarn("Already in roster.");
    const selectedTeam = adminMode ? safeUpper(root.querySelector("#addPlayerTeam")?.value) : opponentTeam;
    const selectedPosition = FIELD_POSITIONS.find(position => position.code === safeUpper(addPlayerPositionSelect?.value));
    if (!selectedPosition) return toastWarn("Choose an available field position.");
    const btn = root.querySelector("#addBtn");
    setDisabled(btn, true, "Adding…");
    try {
      const out = await API.captainAddLateOpponent(code, registeredPlayer, selectedTeam, selectedPosition.positionX, selectedPosition.positionY);
      if (!out.ok) throw new Error(out.error || "Could not add player");
      const playerName = String(out.playerName || registeredPlayer);
      roster = uniqueSorted([...roster, playerName]);
      teamMap[playerName] = String(out.team || selectedTeam);
      fieldPositions[playerName] = {
        positionX: Number(out.positionX ?? selectedPosition.positionX),
        positionY: Number(out.positionY ?? selectedPosition.positionY)
      };
      const fieldGroup = fieldGroups.find(group => group.team === teamMap[playerName]);
      if (fieldGroup && !fieldGroup.players.some(name => name.toLowerCase() === playerName.toLowerCase())) {
        fieldGroup.players = uniqueSorted([...fieldGroup.players, playerName]);
      }
      drafts[playerName] = drafts[playerName] || { rating: "", goals: "", assists: "" };
      saveRosterLocal();
      saveTeamsLocal();
      if (ownTeams.includes(teamMap[playerName])) persistFieldDraft();
      sel.value = "";
      addPlayerPositionSelect.value = "";
      hideAddPlayerResults();
      fieldEditor.refresh();
      const availabilityGroup = root.querySelector(`[data-team-availability="${teamMap[playerName]}"]`);
      if (availabilityGroup) availabilityGroup.innerHTML = teamAvailabilityList(teamMap[playerName]);
      try {
        localStorage.removeItem(`mlfc_match_detail_cache_v2:${code}`);
        localStorage.removeItem(`mlfc_admin_manage_cache_v3:${code}`);
      } catch {}
      renderRows();
      toastSuccess(`${playerName} added to ${visibleTeamName(teamMap[playerName])}.`);
    } catch (error) {
      toastError(error?.message || "Could not add player");
    } finally {
      setDisabled(btn, false, "Adding…");
      renderAvailableAddPositions();
    }
  };

  const submitRatingsBtn = root.querySelector("#submitRatings");
  if (submitRatingsBtn) {
    submitRatingsBtn.onclick = async () => {
      if (!ratingsEnabled) {
        toastWarn("Ratings unlock at kick-off.");
        return;
      }

      const btn = root.querySelector("#submitRatings");
      const msg = root.querySelector("#rateMsg");

      setDisabled(btn, true, "Submitting…");
      msg.textContent = "Submitting…";

      try {
        // Build submission rows from in-memory drafts instead of DOM inputs.
        // This keeps validation correct even when the roster is filtered via search.
        const ratablePlayers = roster.filter(p => ratingsEnabled && isOpponentPlayer(p));

        const rows = [];

        for (const p of ratablePlayers) {
          const d = drafts[p] || {};
          const ratingRaw = String(d.rating ?? "").trim();

          if (ratingRaw === "") {
            continue;
          }

          const ratingVal = clampHalfRating(ratingRaw, 1, 10);
          if (ratingVal == null) throw new Error(`Invalid rating for ${p} (use 1–10 in 0.5 steps)`);

          const goalsRaw = String(d.goals ?? "").trim();
          const assistsRaw = String(d.assists ?? "").trim();

          const goalsVal = goalsRaw === "" ? 0 : clampInt(goalsRaw, 0, 99);
          if (goalsVal == null) throw new Error(`Invalid goals for ${p} (0-99)`);

          const assistsVal = assistsRaw === "" ? 0 : clampInt(assistsRaw, 0, 99);
          if (assistsVal == null) throw new Error(`Invalid assists for ${p} (0-99)`);

          rows.push({
            playerName: p,
            rating: ratingVal,
            goals: goalsVal,
            assists: assistsVal,
            teamAtMatch: teamMap[p] || ""
            ,boostAttribute: String(d.boostAttribute||""), boostMultiplier: d.boostAttribute ? Number(d.boostMultiplier||1) : 0
          });
        }

        if (rows.length === 0) {
          toastWarn("Enter at least one rating.");
          msg.textContent = "Nothing to submit";
          return;
        }

        // Opponent match: ensure MLFC score matches total goals entered
        if (!adminMode && type !== "INTERNAL") {
          const mlfcScore = clampInt(String(m.scoreHome ?? "").trim(), 0, 99);
          if (mlfcScore != null && rows.length === ratablePlayers.length) {
            const totalGoals = rows.reduce((s,r)=>s+Number(r.goals||0),0);
            if (totalGoals !== mlfcScore) {
              throw new Error(`MLFC score (${mlfcScore}) must match total goals entered (${totalGoals}).`);
            }
          }
        }

        const out = adminMode
          ? await API.adminSubmitRatingsBatch(code, rows)
          : await API.captainSubmitRatingsBatch(code, rows, "CAPTAIN");
        if (!out.ok) {
          msg.textContent = out.error || "Failed";
          toastError(out.error || "Submit failed");
          return;
        }
        rows.forEach(row => ratingCoverage.set(String(row.playerName || "").trim().toLowerCase(), true));
        renderRows();
        updateWizardProgress();

        try {
          const seasonId = String(m.seasonId || "");
          if (seasonId) localStorage.removeItem(`mlfc_leaderboard_v2:${seasonId}`);
        } catch {}

        msg.textContent = "Submitted ✅";
        try { localStorage.removeItem(ratingsDraftKey(code, captain)); } catch {}
        const indicator = root.querySelector("#ratingsDraftState");
        if (indicator) {
          indicator.textContent = `Saved ${rows.length} player rating${rows.length === 1 ? "" : "s"}`;
          indicator.classList.remove("isDirty");
        }
        toastSuccess(`${rows.length} player rating${rows.length === 1 ? "" : "s"} saved.`);
        toastInfo("Leaderboard cache cleared. Open Leaderboard and tap Refresh.");
      } catch (e) {
        msg.textContent = "Failed";
        toastError(e?.message || "Submit failed");
      } finally {
        setDisabled(btn, false);
      }
    };
  }
}
