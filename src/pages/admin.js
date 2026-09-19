import { mountTeamField, positionMap, positionRows, defaultPositions } from "../ui/team_field.js";
// src/pages/admin.js
import { API } from "../api/endpoints.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { cleanupCaches } from "../cache_cleanup.js";
import { isReloadForAdminList, isReloadForAdminMatchCode, isReloadFor, isIOSStandalone } from "../nav_state.js";
import { clearAuth, updateNavForUser, getCachedUser, getToken, refreshMe } from "../auth.js";
import { loadCanvasImage } from "../ui/player_photo.js";

const LS_ADMIN_KEY = "mlfc_adminKey";
const LS_SELECTED_SEASON = "mlfc_selected_season_v1";
const LS_SEASONS_CACHE = "mlfc_seasons_cache_v1"; // {ts, data}

const LS_ADMIN_MATCHES_PREFIX = "mlfc_admin_matches_cache_v3:"; // + seasonId => {ts, matches}
const LS_MANAGE_CACHE_PREFIX = "mlfc_admin_manage_cache_v3:";   // + code => {ts, data}
const LS_MATCH_DETAIL_PREFIX = "mlfc_match_detail_cache_v2:";   // shared with match page
const LS_USERS_CACHE = "mlfc_admin_users_cache_v1"; // {ts, users}
const LS_SETUP_DRAFT_PREFIX = "mlfc_admin_setup_draft_v1:";
   // shared with match page

const SEASONS_TTL_MS = 60 * 10000;
const ADMIN_MATCH_CACHE_MAX_AGE_MS = 60 * 1000;
const ADMIN_MATCH_REFRESH_COOLDOWN_MS = 15 * 1000;

let MEM = {
  adminKey: null,
  seasons: [],
  selectedSeasonId: "",
  matches: [],
  editSeasonId: "",
};

let ADMIN_AUTO_REFRESH_INSTALLED = false;
let ADMIN_LAST_REFRESH_TS = 0;
let ADMIN_REFRESH_INFLIGHT = false;
let ACTIVE_ADMIN = { root: null, routeToken: "", view: "", refreshList: null };
let MANAGE_COMMAND_SCROLL_HANDLER = null;

function now() { return Date.now(); }
function currentHashPath() { return (location.hash || "#/match").split("?")[0]; }
function currentHashQuery() { return new URLSearchParams(location.hash.split("?")[1] || ""); }
function stillOnAdmin(routeToken) {
  return currentHashPath() === "#/admin" && window.__mlfcAdminToken === routeToken;
}



function isAdminRouteActive() {
  const hash = window.location.hash || "#/match";
  return hash.startsWith("#/admin");
}

function isAdminListViewActive() {
  const q = currentHashQuery();
  const view = (q.get("view") || "open").toLowerCase();
  return isAdminRouteActive() && (view === "open" || view === "past");
}

function shouldRefreshAdminMatches(seasonId, { force = false } = {}) {
  if (force) return true;
  if (!isAdminListViewActive()) return false;
  const cache = lsGet(matchesKey(seasonId));
  const age = now() - Number(cache?.ts || 0);
  return !cache?.matches || age > ADMIN_MATCH_CACHE_MAX_AGE_MS;
}

function ensureAdminAutoRefresh() {
  if (ADMIN_AUTO_REFRESH_INSTALLED) return;
  ADMIN_AUTO_REFRESH_INSTALLED = true;

  const trigger = () => {
    if (!ACTIVE_ADMIN.refreshList) return;
    ACTIVE_ADMIN.refreshList({ silent: true }).catch(() => {});
  };

  window.addEventListener("hashchange", () => {
    if (isAdminListViewActive()) trigger();
  });

  window.addEventListener("focus", () => {
    if (isAdminListViewActive()) trigger();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isAdminListViewActive()) trigger();
  });
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
function setupDraftKey(matchId) { return `${LS_SETUP_DRAFT_PREFIX}${matchId}`; }

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function formationRows(players) {
  const list = [...(players || [])];
  const total = list.length;
  if (!total) return [];
  const counts = total <= 5 ? [1, total - 1]
    : total <= 7 ? [1, 2, total - 3]
      : total <= 9 ? [1, 3, total - 4]
        : [1, 3, 3, total - 7];
  let offset = 0;
  return counts.filter(Boolean).map((count) => {
    const row = list.slice(offset, offset + count);
    offset += count;
    return row;
  });
}

function teamSheetHtml(teamName, players, captain = "", tone = "blue") {
  const rows = formationRows(players);
  return `<section class="digitalTeam digitalTeam--${tone}" aria-label="${escapeHtml(teamName)} digital team sheet">
    <header class="digitalTeam__head"><div><span>Digital team sheet</span><strong>${escapeHtml(teamName)}</strong></div><b>${players.length}</b></header>
    <div class="digitalTeam__pitch">
      <span class="digitalTeam__centre" aria-hidden="true"></span>
      ${rows.length ? rows.map((row) => `<div class="digitalTeam__line">${row.map((player) => `<div class="digitalPlayer${player === captain ? " digitalPlayer--captain" : ""}"><i aria-hidden="true">${player === captain ? "C" : "•"}</i><span>${escapeHtml(player)}</span></div>`).join("")}</div>`).join("") : `<div class="digitalTeam__empty">Select players to build the team sheet</div>`}
    </div>
  </section>`;
}

function teamSheetShareText(match, when, homeName, homePlayers, awayName = "", awayPlayers = [], positions = {}, captains = []) {
  const lines = ["📋 *MANOR LAKES FC · DIGITAL TEAM SHEET*", "", `⚽ *${match.title}*`, `🗓️ ${when}`, ""];
  lines.push(`🔵 *${homeName.toUpperCase()}*`);
  (homePlayers.length ? homePlayers : ["Squad to be confirmed"]).forEach((player, index) => lines.push(`${index + 1}. ${player}`));
  if (awayName) {
    lines.push("", `🟠 *${awayName.toUpperCase()}*`);
    (awayPlayers.length ? awayPlayers : ["Squad to be confirmed"]).forEach((player, index) => lines.push(`${index + 1}. ${player}`));
  }
  lines.push("", `Open match: ${matchLink(match.publicCode)}`, "", "Shared by the Manor Lakes FC club desk.");
  return lines.join("\n");
}

function wrapCanvasText(context, text, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  });
  if (line) lines.push(line);
  return lines;
}

function fitCanvasLabel(context, value, maxWidth) {
  const label = String(value || "Player").trim();
  if (context.measureText(label).width <= maxWidth) return label;
  let shortened = label;
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function drawTeamSheetPitch(context, team, x, y, width, height) {
  const compact = width < 600;
  const lineColor = "rgba(255,255,255,.42)";
  const pitchTop = y + 88;
  const pitchHeight = height - 112;
  const pitchLeft = x + 18;
  const pitchWidth = width - 36;
  const centerX = pitchLeft + pitchWidth / 2;
  const centerY = pitchTop + pitchHeight / 2;

  context.fillStyle = "rgba(3,20,32,.78)";
  context.fillRect(x, y, width, height);
  context.fillStyle = team.color;
  context.fillRect(x, y, width, 9);

  context.fillStyle = team.color;
  context.font = "900 31px Arial";
  context.fillText(String(team.name || "Team").toUpperCase(), x + 24, y + 54);
  context.fillStyle = "#bed2dc";
  context.font = "800 18px Arial";
  context.textAlign = "right";
  context.fillText(`${team.players.length} PLAYERS`, x + width - 24, y + 52);
  context.textAlign = "left";

  const pitchGradient = context.createLinearGradient(pitchLeft, pitchTop, pitchLeft, pitchTop + pitchHeight);
  pitchGradient.addColorStop(0, "#0d5969");
  pitchGradient.addColorStop(1, "#083c50");
  context.fillStyle = pitchGradient;
  context.fillRect(pitchLeft, pitchTop, pitchWidth, pitchHeight);

  context.fillStyle = "rgba(255,255,255,.035)";
  const stripeHeight = pitchHeight / 8;
  for (let stripe = 0; stripe < 8; stripe += 2) {
    context.fillRect(pitchLeft, pitchTop + stripe * stripeHeight, pitchWidth, stripeHeight);
  }

  context.strokeStyle = lineColor;
  context.lineWidth = 2;
  context.strokeRect(pitchLeft, pitchTop, pitchWidth, pitchHeight);
  context.beginPath();
  context.moveTo(pitchLeft, centerY);
  context.lineTo(pitchLeft + pitchWidth, centerY);
  context.stroke();
  context.beginPath();
  context.arc(centerX, centerY, Math.min(54, pitchWidth * .14), 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = lineColor;
  context.beginPath();
  context.arc(centerX, centerY, 4, 0, Math.PI * 2);
  context.fill();

  const boxWidth = pitchWidth * .5;
  const boxHeight = Math.min(76, pitchHeight * .13);
  context.strokeRect(centerX - boxWidth / 2, pitchTop, boxWidth, boxHeight);
  context.strokeRect(centerX - boxWidth / 2, pitchTop + pitchHeight - boxHeight, boxWidth, boxHeight);
  context.strokeRect(centerX - boxWidth * .28, pitchTop, boxWidth * .56, boxHeight * .42);
  context.strokeRect(centerX - boxWidth * .28, pitchTop + pitchHeight - boxHeight * .42, boxWidth * .56, boxHeight * .42);

  const rows = formationRows(team.players);
  if (!rows.length) {
    context.fillStyle = "#dceaf0";
    context.font = "800 23px Arial";
    context.textAlign = "center";
    context.fillText("SQUAD TO BE CONFIRMED", centerX, centerY + 8);
    context.textAlign = "left";
    return;
  }

  const rowGap = pitchHeight / (rows.length + 1);
  [...rows].reverse().forEach((row, visualRowIndex) => {
    const defaultY = pitchTop + rowGap * (visualRowIndex + 1);
    const playerGap = pitchWidth / (row.length + 1);
    row.forEach((player, playerIndex) => {
      const pos = team.positions?.[player] || defaultPositions(team.players)[player];
      const playerX = pitchLeft + pitchWidth * pos.positionX / 100;
      const playerY = pos ? pitchTop + pitchHeight * pos.positionY / 100 : defaultY;
      const markerRadius = Math.min(compact ? 20 : 24, playerGap * .28);
      const maxLabelWidth = Math.max(46, playerGap - 8);

      context.shadowColor = "rgba(0,0,0,.42)";
      context.shadowBlur = 10;
      context.fillStyle = team.color;
      context.beginPath();
      context.arc(playerX, playerY - 10, markerRadius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(255,255,255,.82)";
      context.lineWidth = 3;
      context.stroke();

      context.font = `900 ${compact && row.length > 4 ? 13 : compact ? 16 : 19}px Arial`;
      context.textAlign = "center";
      const label = fitCanvasLabel(context, player, maxLabelWidth);
      const labelWidth = context.measureText(label).width + 14;
      context.fillStyle = "rgba(2,19,30,.86)";
      context.fillRect(playerX - labelWidth / 2, playerY + markerRadius - 12, labelWidth, 25);
      context.fillStyle = "#ffffff";
      context.fillText(label, playerX, playerY + markerRadius + 7);
      context.textAlign = "left";
    });
  });
}

async function teamSheetImageFile(match, when, homeName, homePlayers, awayName = "", awayPlayers = [], positions = {}, captains = [], photos = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 2160;
  canvas.height = 2700;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.scale(2, 2);
  const gradient = context.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#061724");
  gradient.addColorStop(1, "#0e3a52");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, 1350);
  context.strokeStyle = "rgba(114,215,250,.25)";
  context.lineWidth = 3;
  context.beginPath(); context.arc(940, 250, 280, 0, Math.PI * 2); context.stroke();

  context.fillStyle = "#72d7fa";
  context.font = "900 24px Arial";
  context.fillText("MANOR LAKES FC · DIGITAL TEAM SHEET", 70, 80);
  context.fillStyle = "#ffffff";
  context.font = "900 58px Arial";
  const titleLines = wrapCanvasText(context, match.title, 900).slice(0, 2);
  titleLines.forEach((line, index) => context.fillText(line.toUpperCase(), 70, 155 + index * 64));
  context.fillStyle = "#bed2dc";
  context.font = "700 25px Arial";
  context.fillText(when, 70, 300);

  const teams = [{ name: homeName, players: homePlayers, color: "#72d7fa", captain:captains[0], upper:false }];
  if (awayName) teams.push({ name: awayName, players: awayPlayers, color: "#ff9c55", captain:captains[1], upper:true });
  const portraits = new Map(await Promise.all(
    [...new Set(teams.flatMap(team => team.players))].map(async name => [
      name,
      await loadCanvasImage(photos[name] || photos[String(name).trim().toLowerCase()]),
    ])
  ));
  const left=70, top=390, width=940, height=800;
  context.fillStyle="#26713b";
  context.fillRect(left,top,width,height);
  context.fillStyle="#226936";
  for(let i=0;i<10;i+=2) context.fillRect(left,top+i*height/10,width,height/10);
  context.strokeStyle="#78949c"; context.lineWidth=3;
  context.strokeRect(left,top,width,height);
  context.beginPath();context.moveTo(left,top+height/2);context.lineTo(left+width,top+height/2);context.stroke();
  context.beginPath();context.arc(left+width/2,top+height/2,70,0,Math.PI*2);context.stroke();
  context.strokeRect(left+width*.32,top,width*.36,50);
  context.strokeRect(left+width*.32,top+height-50,width*.36,50);
  context.textAlign="center";
  for(const team of teams) {
    context.fillStyle=team.color;context.font="900 24px Arial";
    context.fillText(`${team.name} · ${team.players.length} · ${team.upper?'↓':'↑'} attacks`,540,team.upper?365:1230);
    const defaults=defaultPositions(team.players);
    for(const name of team.players) {
      const pos=positions[name] || defaults[name];
      const x=left+width*(team.upper?100-pos.positionX:pos.positionX)/100;
      const y=top+height*(team.upper?50-pos.positionY/2:50+pos.positionY/2)/100;
      const portrait=portraits.get(name);
      const markerRadius=30;
      context.save();
      context.beginPath();context.arc(x,y,markerRadius,0,Math.PI*2);context.clip();
      if (portrait) {
        const size=markerRadius*2;
        const scale=Math.max(size/portrait.width,size/portrait.height);
        const drawWidth=portrait.width*scale,drawHeight=portrait.height*scale;
        context.drawImage(portrait,x-drawWidth/2,y-drawHeight/2,drawWidth,drawHeight);
      } else {
        context.fillStyle=team.color;context.fillRect(x-markerRadius,y-markerRadius,markerRadius*2,markerRadius*2);
      }
      context.restore();
      context.strokeStyle="#fff";context.lineWidth=3;context.beginPath();context.arc(x,y,markerRadius,0,Math.PI*2);context.stroke();
      if(name===team.captain) {
        context.fillStyle="#ffe16a";context.beginPath();context.arc(x+20,y-17,12,0,Math.PI*2);context.fill();
        context.fillStyle="#132c3b";context.font="900 16px Arial";context.fillText("C",x+20,y-11);
      }
      context.font="800 36px Arial";
      const lines=wrapCanvasText(context,name,200).slice(0,2).map(line => fitCanvasLabel(context,line,200));
      const labelWidth=Math.max(...lines.map(line => context.measureText(line).width))+16;
      const labelX=Math.max(left+labelWidth/2+4,Math.min(left+width-labelWidth/2-4,x));
      const labelY=Math.min(y+25,top+height-lines.length*40-12);
      context.fillStyle="#061e2d";context.fillRect(labelX-labelWidth/2,labelY,labelWidth,lines.length*40+8);
      context.fillStyle="#fff";
      lines.forEach((line,index) => context.fillText(line,labelX,labelY+35+index*40));
    }
  }
  context.textAlign="left";
  context.fillStyle = "#bed2dc";
  context.font = "700 22px Arial";
  context.fillText("Shared by the Manor Lakes FC club desk", 70, 1305);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `mlfc-team-sheet-${match.publicCode}.png`, { type: "image/png" }) : null;
}

async function shareTeamSheet(match, when, homeName, homePlayers, awayName = "", awayPlayers = [], positions = {}, captains = [], photos = {}) {
  const file = await teamSheetImageFile(match, when, homeName, homePlayers, awayName, awayPlayers, positions, captains, photos);
  if (!file) throw new Error("Could not create team sheet image");
  if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
    const caption = `⚽ ${match.title}\n🗓️ ${when}\n\nView match: ${matchLink(match.publicCode)}`;
    await navigator.share({ title: `${match.title} team sheet`, text: caption, files: [file] });
    return "image";
  }
  const url=URL.createObjectURL(file);
  const link=document.createElement("a");
  link.href=url; link.download=file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return "download";
}

async function potmImageFile(match, when, player, voteCount) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0,0,1080,1350);
  gradient.addColorStop(0,"#061724"); gradient.addColorStop(1,"#0e536b");
  context.fillStyle=gradient; context.fillRect(0,0,1080,1350);
  context.strokeStyle="rgba(114,215,250,.28)"; context.lineWidth=4;
  context.beginPath(); context.arc(890,220,260,0,Math.PI*2); context.stroke();
  const portrait=await loadCanvasImage(player.photoUrl);
  if (portrait) {
    context.save(); context.beginPath(); context.arc(850,300,175,0,Math.PI*2); context.clip();
    const scale=Math.max(350/portrait.width,350/portrait.height);
    context.drawImage(portrait,850-portrait.width*scale/2,300-portrait.height*scale/2,portrait.width*scale,portrait.height*scale);
    context.restore(); context.strokeStyle="#72d7fa"; context.lineWidth=10; context.beginPath(); context.arc(850,300,175,0,Math.PI*2); context.stroke();
  }
  context.fillStyle="#72d7fa"; context.font="900 28px Arial";
  context.fillText("MANOR LAKES FC",70,90);
  context.fillStyle="#ffffff"; context.font="900 48px Arial";
  context.fillText("PLAYER OF THE MATCH",70,175);
  context.fillStyle="#ffe16a"; context.font="900 150px Arial";
  context.fillText("🏆",70,390);
  context.fillStyle="#ffffff"; context.font="900 76px Arial";
  wrapCanvasText(context,player.playerName,900).slice(0,2).forEach((line,index)=>context.fillText(line,70,510+index*82));
  context.fillStyle="#bed2dc"; context.font="700 28px Arial";
  context.fillText(`${match.title} · ${when}`,70,705);
  const stats=[
    [String(voteCount),voteCount===1?"VOTE":"VOTES"],
    [String(Number(player.goals||0)),"GOALS"],
    [String(Number(player.assists||0)),"ASSISTS"],
    [Number(player.ratingCount||0)?Number(player.rating).toFixed(1):"—","RATING"],
  ];
  stats.forEach(([value,label],index)=>{
    const x=70+index*235;
    context.fillStyle="rgba(3,20,32,.72)"; context.fillRect(x,790,210,190);
    context.fillStyle="#ffffff"; context.font="900 62px Arial"; context.fillText(value,x+25,875);
    context.fillStyle="#72d7fa"; context.font="900 20px Arial"; context.fillText(label,x+25,935);
  });
  context.fillStyle="#ffffff"; context.font="900 38px Arial";
  context.fillText(`${match.teamHomeName || "Home"} ${match.scoreHome} – ${match.scoreAway} ${match.teamAwayName || "Away"}`,70,1090);
  context.fillStyle="#bed2dc"; context.font="700 24px Arial";
  context.fillText("Voted by the players · Manor Lakes FC",70,1270);
  const blob=await new Promise((resolve)=>canvas.toBlob(resolve,"image/png"));
  return blob ? new File([blob],`mlfc-potm-${match.publicCode}.png`,{type:"image/png"}) : null;
}

async function sharePotm(match, when, player, voteCount) {
  const file=await potmImageFile(match,when,player,voteCount);
  if (!file) throw new Error("Could not create POTM image");
  const caption=`🏆 Player of the Match: ${player.playerName}\n${voteCount} vote${voteCount===1?"":"s"} · ${Number(player.goals||0)} goals · ${Number(player.assists||0)} assists · ${Number(player.ratingCount||0)?Number(player.rating).toFixed(1):"—"} rating\n\n${matchLink(match.publicCode)}`;
  if (navigator.share && navigator.canShare?.({files:[file]})) {
    await navigator.share({title:`${player.playerName} · Player of the Match`,text:caption,files:[file]});
    return "image";
  }
  const url=URL.createObjectURL(file); const link=document.createElement("a");
  link.href=url; link.download=file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000); waOpenPrefill(caption); return "download";
}

function sameNames(a, b) {
  return uniqueSorted(a).map(x => x.toLowerCase()).join("|") === uniqueSorted(b).map(x => x.toLowerCase()).join("|");
}

function setDisabled(btn, disabled, busyText) {
  if (!btn) return;
  btn.disabled = disabled;
  if (busyText) {
    if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
    btn.textContent = disabled ? busyText : btn.dataset.origText;
  }
}

function installManageCommandScrollBehavior(manageArea) {
  if (MANAGE_COMMAND_SCROLL_HANDLER) {
    window.removeEventListener("scroll", MANAGE_COMMAND_SCROLL_HANDLER);
    window.removeEventListener("resize", MANAGE_COMMAND_SCROLL_HANDLER);
    window.removeEventListener("hashchange", MANAGE_COMMAND_SCROLL_HANDLER);
  }
  const command = manageArea?.querySelector(".manageCommand");
  if (!command) return;

  let scheduled = false;
  let compact = false;
  let handler = null;
  const setCompact = (nextCompact) => {
    if (nextCompact === compact) return;

    // A fixed element leaves normal document flow. Reserve its expanded space
    // before fixing it so the page height and scroll position cannot oscillate.
    if (nextCompact) {
      const styles = getComputedStyle(command);
      const outerHeight = command.getBoundingClientRect().height
        + Number.parseFloat(styles.marginTop || "0")
        + Number.parseFloat(styles.marginBottom || "0");
      manageArea.style.setProperty("--manage-command-space", `${Math.ceil(outerHeight)}px`);
    }

    compact = nextCompact;
    manageArea.classList.toggle("hasCompactCommand", compact);
    command.classList.toggle("isCompact", compact);
    command.dataset.display = compact ? "compact" : "expanded";
    document.body.classList.toggle("hasCompactMatchCommand", compact);
  };
  const syncCompactBounds = () => {
    const bounds = manageArea.getBoundingClientRect();
    const edge = window.innerWidth <= 819 ? 4 : 0;
    command.style.setProperty("--manage-command-left", `${Math.max(0, bounds.left - edge)}px`);
    command.style.setProperty("--manage-command-width", `${Math.min(window.innerWidth, bounds.width + edge * 2)}px`);
  };
  const update = () => {
    scheduled = false;
    if (!document.body.contains(command)) {
      window.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
      window.removeEventListener("hashchange", handler);
      manageArea.classList.remove("hasCompactCommand");
      document.body.classList.remove("hasCompactMatchCommand");
      if (MANAGE_COMMAND_SCROLL_HANDLER === handler) MANAGE_COMMAND_SCROLL_HANDLER = null;
      return;
    }
    const routeActive = currentHashPath() === "#/admin" && manageArea.offsetParent !== null;
    // Separate collapse/expand thresholds prevent tiny scroll movements from
    // rapidly toggling the banner at the boundary on touch devices.
    const nextCompact = routeActive && (compact ? window.scrollY > 72 : window.scrollY > 140);
    if (nextCompact) syncCompactBounds();
    setCompact(nextCompact);
  };
  handler = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };
  MANAGE_COMMAND_SCROLL_HANDLER = handler;
  window.addEventListener("scroll", handler, { passive: true });
  window.addEventListener("resize", handler, { passive: true });
  window.addEventListener("hashchange", handler);
  update();
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

function isTrueFlag(value) {
  return Number(value) === 1 || String(value ?? "").trim().toUpperCase() === "TRUE";
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
      <label class="field__label" for="seasonSelect" style="min-width:64px">Season</label>
      <select class="input" id="seasonSelect" style="flex:1">${opts}</select>
    </div>
  `;
}

// Shared by manual + background refresh paths
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
      <div class="field"><label class="field__label" for="key">Admin key</label><input id="key" class="input" type="password" autocomplete="current-password" aria-describedby="msg" /></div>
      <div class="row" style="margin-top:10px">
        <button id="login" class="btn primary">Login</button>
        <button id="clear" class="btn gray">Clear key</button>
      </div>
      <div id="msg" class="field__message" role="status" aria-live="polite"></div>
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
    keyEl.removeAttribute("aria-invalid");
    if (!adminKey) {
      keyEl.setAttribute("aria-invalid", "true");
      msgEl.textContent = "Enter the admin key to open the club desk.";
      keyEl.focus();
      return toastWarn("Enter admin key");
    }

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
  const locked = isTrueFlag(m.ratingsLocked);
  const isCompleted = status === "COMPLETED";
  const isEditLocked = locked || status === "CLOSED" || isCompleted;
  const hasBothScores = String(m.scoreHome ?? "").trim() !== "" && String(m.scoreAway ?? "").trim() !== "";
  const potmVotingClosed = Number(m.potmVotingClosed || 0) === 1 || isCompleted;
  const potmVoteCount = Number(m.potmVoteCount || 0);

  // If locked/completed: disable Manage + scoring.
  const disableManage = isEditLocked;

  const when = formatHumanDateTime(m.date, m.time);

  return `
    <article class="adminMatchRow">
      <div class="adminMatchRow__head">
        <div class="adminMatchRow__main">
          <div class="adminMatchRow__title">${m.title}</div>
          <div class="adminMatchRow__meta">${when}<span aria-hidden="true">·</span>${m.type}</div>
        </div>
        <div class="adminMatchRow__badges">
          <span class="badge${status === "OPEN" ? " badge--good" : ""}">${m.status}</span>
          ${locked ? `<span class="badge badge--bad">LOCKED</span>` : ""}
        </div>
      </div>

      <div class="adminMatchRow__actions">
        <button class="btn gray" data-manage="${m.publicCode}" ${disableManage ? "disabled" : ""}>Manage</button>
        <button class="btn primary" data-score="${m.publicCode}" ${isEditLocked ? "disabled" : ""}>Score & ratings</button>
        ${hasBothScores ? `<button class="btn ${potmVotingClosed && potmVoteCount > 0 ? "whatsappBtn" : "gray"}" data-share-potm-card="${m.publicCode}" ${potmVotingClosed && potmVoteCount > 0 ? "" : "disabled"}>${potmVotingClosed ? (potmVoteCount > 0 ? "Share POTM" : "No POTM votes") : "Share POTM after voting"}</button>` : ""}
        ${hasBothScores && !locked && !isCompleted ? `<button class="btn gray" data-lock="${m.matchId}">Complete & lock</button>` : ""}
        ${isEditLocked ? `<button class="btn gray" data-unlock="${m.matchId}">Unlock match</button>` : ""}
        <button class="btn dangerGhost" data-delete-match="${m.matchId}">Delete match</button>
      </div>
    </article>
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

      <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
        <button class="btn gray" style="display:none;" id="clearAdminCache">Clear cache</button>
      </div>
    </div>

    <details class="card" id="seasonMgmt">
      <summary style="font-weight:950">Season management</summary>

      <div class="small" style="margin-top:8px">
        Create seasons like: <b>24 Winter</b>, <b>24-25 Summer</b>, <b>25 Winter</b>, <b>25-26 Summer</b>.
      </div>

      <div class="field"><label class="field__label" for="seasonName">Season name</label><input id="seasonName" class="input" placeholder="For example, 25-26 Summer" /></div>
      <div class="formGrid formGrid--two">
        <div class="field"><label class="field__label" for="seasonStart">Start date</label><input id="seasonStart" class="input" type="date" /></div>
        <div class="field"><label class="field__label" for="seasonEnd">End date</label><input id="seasonEnd" class="input" type="date" /></div>
      </div>
      <div class="field"><label class="field__label" for="seasonStatus">Season status</label>
        <select id="seasonStatus" class="input">
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

    <details class="card" id="createMatchCard" >
      <summary style="font-weight:950">Create match</summary>

      <div class="field"><label class="field__label" for="title">Match title</label><input id="title" class="input" placeholder="For example, Friday night football" /></div>
      <div class="formGrid formGrid--two"><div class="field"><label class="field__label" for="date">Match date</label><input id="date" class="input" type="date" /></div><div class="field"><label class="field__label" for="time">Kick-off time</label><input id="time" class="input" type="time" value="19:00" /></div></div>
      <div class="field"><label class="field__label" for="type">Match type</label><select id="type" class="input">
        <option value="INTERNAL" selected>Internal</option>
        <option value="OPPONENT">Against opponents (1 captain)</option>
      </select></div>

      <div class="formGrid formGrid--two" id="teamNamesFields">
        <div class="field"><label class="field__label" for="teamHomeName">Home team name</label><input id="teamHomeName" class="input" value="Blue" maxlength="30" aria-describedby="teamNamesHelp" /></div>
        <div class="field"><label class="field__label" for="teamAwayName">Away team name</label><input id="teamAwayName" class="input" value="Orange" maxlength="30" aria-describedby="teamNamesHelp" /></div>
      </div>
      <div class="field__help" id="teamNamesHelp">For internal matches, choose the names shown instead of Blue and Orange.</div>

      <div class="field"><label class="field__label" for="availabilityLimit">Maximum confirmed players</label><input
        id="availabilityLimit"
        class="input"
        type="number"
        min="1"
        max="100"
        value="22"
        style="margin-top:10px"
        aria-describedby="availabilityHelp"
      /><div class="field__help" id="availabilityHelp">Extra Yes responses move to the waiting list.</div></div>

      <button id="createMatch" class="btn primary" style="margin-top:10px">Create</button>
      <div id="created" class="small" style="margin-top:10px"></div>
    </details>

    <details class="card" id="announcementCard">
      <summary style="font-weight:950">Send club announcement</summary>
      <p class="small">Send one in-app and push notification to every registered player. Add an optional secure link for payments or tournament registration.</p>
      <div class="field"><label class="field__label" for="announcementTitle">Notification title</label><input id="announcementTitle" class="input" maxlength="80" placeholder="For example, Tournament registration" /></div>
      <div class="field"><label class="field__label" for="announcementMessage">Message</label><textarea id="announcementMessage" class="input" rows="4" maxlength="500" placeholder="Write a clear action and deadline"></textarea></div>
      <div class="field"><label class="field__label" for="announcementUrl">Registration or payment link <span class="field__optional">optional</span></label><input id="announcementUrl" class="input" type="url" inputmode="url" placeholder="https://…" aria-describedby="announcementUrlHelp" /><div class="field__help" id="announcementUrlHelp">HTTPS links can open directly. Embedding is offered only when the provider permits it.</div></div>
      <label class="row announcementEmbedChoice"><input id="announcementEmbed" type="checkbox" /><span>Offer an embedded registration view</span></label>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="sendAnnouncement">Review & send to everyone</button></div>
      <div class="field__message" id="announcementMsg" role="status" aria-live="polite"></div>
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
  const announcement = root.querySelector("#announcementCard");
  if (header) header.style.display = display;
  if (seasonMgmt) seasonMgmt.style.display = display;
  if (createMatch) createMatch.style.display = display;
  if (announcement) announcement.style.display = display;
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

  // Availability can change on another device. Refresh before mounting the editor
  // so a cached YES cannot reappear in the unassigned pool or a saved draft.
  manageArea.innerHTML = `<div class="card"><div class="h1">Loading match…</div><div class="small">Refreshing availability and teams…</div></div>`;
  let fresh;
  try {
    fresh = await API.getPublicMatch(code);
  } catch {
    fresh = { ok: false, error: "Could not refresh the match. Reopen it to try again." };
  }
  if (!stillOnAdmin(routeToken)) return;
  if (!fresh?.ok) {
    const message = fresh?.error || "Could not refresh the match. Reopen it to try again.";
    manageArea.innerHTML = `<div class="card"><div class="h1">Unable to load match</div><div class="small">${escapeHtml(message)}</div></div>`;
    return toastError(message);
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
  // Default availability limits:
  // - OPPONENT match: 11
  // - INTERNAL match: 22
  try {
    const typeEl = root.querySelector("#type");
    const limitEl = root.querySelector("#availabilityLimit");
    const homeNameEl = root.querySelector("#teamHomeName");
    const awayNameEl = root.querySelector("#teamAwayName");
    const namesHelp = root.querySelector("#teamNamesHelp");
    if (typeEl && limitEl) {
      const setDefault = () => {
        const opponent = String(typeEl.value || "").toUpperCase() === "OPPONENT";
        limitEl.value = opponent ? 11 : 22;
        if (homeNameEl) homeNameEl.value = opponent ? "MLFC" : "Blue";
        if (awayNameEl) awayNameEl.value = opponent ? "Opponent" : "Orange";
        if (homeNameEl) homeNameEl.disabled = opponent;
        if (awayNameEl) awayNameEl.disabled = opponent;
        if (namesHelp) namesHelp.textContent = opponent ? "Opponent fixtures use MLFC and Opponent." : "Choose the internal team names shown across scores, teams and results.";
      };
      // initial default
      setDefault();
      // update when type changes
      typeEl.onchange = () => setDefault();
    }
  } catch {}

  root.querySelector("#createMatch").onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;

    const btn = root.querySelector("#createMatch");
    setDisabled(btn, true, "Creating…");

    const payload = {
      title: root.querySelector("#title").value.trim() || "Weekly Match",
      date: root.querySelector("#date").value,
      time: root.querySelector("#time").value || "19:00",
      type: root.querySelector("#type").value,
      teamHomeName: root.querySelector("#teamHomeName")?.value.trim() || "Blue",
      teamAwayName: root.querySelector("#teamAwayName")?.value.trim() || "Orange",
      availabilityLimit: Math.max(1, Math.min(100, Math.floor(Number(root.querySelector("#availabilityLimit")?.value || 22)))),
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
      teamHomeName: payload.teamHomeName,
      teamAwayName: payload.teamAwayName,
      availabilityLimit: payload.availabilityLimit,
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

function bindAnnouncement(root, routeToken) {
  const button = root.querySelector("#sendAnnouncement");
  if (!button) return;
  button.onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;
    const titleEl = root.querySelector("#announcementTitle");
    const messageEl = root.querySelector("#announcementMessage");
    const urlEl = root.querySelector("#announcementUrl");
    const embedEl = root.querySelector("#announcementEmbed");
    const statusEl = root.querySelector("#announcementMsg");
    const title = String(titleEl?.value || "").trim();
    const message = String(messageEl?.value || "").trim();
    const linkUrl = String(urlEl?.value || "").trim();
    titleEl?.removeAttribute("aria-invalid");
    messageEl?.removeAttribute("aria-invalid");
    urlEl?.removeAttribute("aria-invalid");
    if (!title) { titleEl?.setAttribute("aria-invalid", "true"); titleEl?.focus(); statusEl.textContent = "Enter a notification title."; return; }
    if (!message) { messageEl?.setAttribute("aria-invalid", "true"); messageEl?.focus(); statusEl.textContent = "Enter the message players should receive."; return; }
    if (linkUrl && !/^https:\/\//i.test(linkUrl)) { urlEl?.setAttribute("aria-invalid", "true"); urlEl?.focus(); statusEl.textContent = "Use a secure HTTPS link."; return; }
    const embedUrl = linkUrl && embedEl?.checked ? linkUrl : "";
    if (!confirm(`Send “${title}” to every registered player?\n\n${message}${linkUrl ? `\n\nLink: ${linkUrl}` : ""}`)) return;
    setDisabled(button, true, "Sending…");
    statusEl.textContent = "Sending one notification to each registered player…";
    let pushOffset = 0;
    let out;
    do {
      out = await API.adminBroadcastNotification({ title, message, linkUrl, embedUrl, pushOffset });
      if (!out?.ok) break;
      pushOffset = Number.isInteger(out.nextPushOffset) ? out.nextPushOffset : null;
    } while (pushOffset !== null);
    setDisabled(button, false);
    if (!out?.ok) { statusEl.textContent = out?.error || "The announcement could not be sent."; return toastError(statusEl.textContent); }
    statusEl.textContent = `Sent to ${Number(out.recipients || 0)} players.`;
    titleEl.value = ""; messageEl.value = ""; urlEl.value = ""; embedEl.checked = false;
    toastSuccess("Club announcement sent.");
  };
}

function bindHeaderButtons(root, routeToken) {
  // Logout is handled from the Account page; admin chrome may not include a logout button.
  const logoutBtn = root.querySelector("#logout");
  // These buttons exist in the Admin header card.
  const clearBtn = root.querySelector("#clearAdminCache");

  if (clearBtn) {
    clearBtn.onclick = () => {
      try {
        // Clear list cache for selected season + any cached manage/match details.
        clearAdminMatchesCache(MEM.selectedSeasonId);
        cleanupCaches();
      } catch {}
      toastInfo("Admin cache cleared.");
      const msg = root.querySelector("#msg");
      if (msg) msg.textContent = "Cache cleared.";
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
  users = users || [];
  area.innerHTML = `
    <div class="usersToolbar">
      <label class="usersSearch" for="userSearch">
        <span class="usersSearch__icon" aria-hidden="true">⌕</span>
        <input id="userSearch" type="search" aria-label="Search users by name or phone" placeholder="Find a player…" value="${escapeHtml(state.q || "")}" autocomplete="off" />
      </label>
      <div class="usersToolbar__meta">
        <span id="usersSummary" aria-live="polite"></span>
        <div id="usersPager" class="usersPager"></div>
      </div>
    </div>
    <div id="usersResults"></div>
  `;

  const results = area.querySelector("#usersResults");
  const pager = area.querySelector("#usersPager");
  const summary = area.querySelector("#usersSummary");

  function renderResults() {
    const q = String(state.q || "").trim().toLowerCase();
    const filtered = q ? users.filter(u => String(u.name || "").toLowerCase().includes(q) || String(u.phone || "").toLowerCase().includes(q)) : users;
    const total = filtered.length;
    const pageSize = Number(state.pageSize) || 20;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    pager.innerHTML = pages > 1 ? `
      <button type="button" id="usersPrev" aria-label="Previous page" ${state.page <= 1 ? "disabled" : ""}>←</button>
      <span aria-label="Page ${state.page} of ${pages}">${state.page} / ${pages}</span>
      <button type="button" id="usersNext" aria-label="Next page" ${state.page >= pages ? "disabled" : ""}>→</button>
    ` : "";
    summary.textContent = q ? `${total} ${total === 1 ? "result" : "results"}` : `${total} ${total === 1 ? "member" : "members"}`;
    results.innerHTML = pageItems.length ? `
      <div class="usersList" role="list">
        ${pageItems.map(u => {
            const isSelf = meNameLower && String(u.name || "").trim().toLowerCase() === meNameLower;
            const isAdmin = Number(u.isAdmin) === 1;
            const toggleDisabled = !canToggleAdmin || isSelf;
            const toggleTitle = !canToggleAdmin
              ? "Only admins can change admin rights"
              : (isSelf ? "You cannot change your own admin access" : (isAdmin ? "Remove admin access" : "Grant admin access"));
            const initial = String(u.name || "?").trim().charAt(0).toUpperCase();
            return `
              <article class="userRow" role="listitem">
                <span class="userRow__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
                <div class="userRow__identity">
                  <strong>${escapeHtml(u.name)}${isSelf ? ` <span class="userRow__you">You</span>` : ""}</strong>
                  <span>${escapeHtml(u.phone || "No phone number")}</span>
                </div>
                <span class="userRole ${isAdmin ? "userRole--admin" : ""}">${isAdmin ? "Admin" : "Member"}</span>
                <div class="usersActions">
                  <button class="userAction" data-toggle-admin="${encodeURIComponent(u.name)}" ${toggleDisabled ? "disabled" : ""} title="${toggleTitle}">${isAdmin ? "Revoke admin" : "Make admin"}</button>
                  <button class="userAction" data-reset-pass="${encodeURIComponent(u.name)}" title="Change password">Password</button>
                  <button class="userAction userAction--danger" data-del-user="${encodeURIComponent(u.name)}" ${isSelf ? "disabled" : ""} title="${isSelf ? "You cannot delete your own admin account" : "Delete user"}">Delete</button>
                </div>
              </article>`;
          }).join("")}
      </div>
    ` : `<div class="usersEmpty"><strong>No players found</strong><span>Try a different name or phone number.</span></div>`;
  }

  const search = area.querySelector("#userSearch");
  search.oninput = () => {
    state.q = search.value;
    state.page = 1;
    renderResults();
  };

  pager.onclick = (event) => {
    if (event.target.closest("#usersPrev")) state.page = Math.max(1, state.page - 1);
    else if (event.target.closest("#usersNext")) state.page += 1;
    else return;
    renderResults();
  };

  results.onclick = async (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;

    if (btn.matches("[data-toggle-admin]")) {
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
      renderResults();
      return;
    }

    if (btn.matches("[data-reset-pass]")) {
      const name = decodeURIComponent(btn.getAttribute("data-reset-pass") || "");
      const pwd = prompt(`Enter a new password for ${name}`);
      if (!pwd) return;
      const res = await API.adminSetPassword(name, pwd).catch(() => null);
      if (!res?.ok) return toastError(res?.error || "Failed");
      toastSuccess("Password updated");
      return;
    }

    if (btn.matches("[data-del-user]")) {
      const name = decodeURIComponent(btn.getAttribute("data-del-user") || "");
      if (meNameLower && String(name || "").trim().toLowerCase() === meNameLower) {
        return toastError("You cannot delete your own admin account");
      }
      const ok = confirm(`Delete user ${name}? This cannot be undone.`);
      if (!ok) return;
      const res = await API.adminDeleteUser(name).catch(() => null);
      if (!res?.ok) return toastError(res?.error || "Failed");
      users = users.filter(u => String(u.name || "").trim().toLowerCase() !== String(name).trim().toLowerCase());
      lsSet(LS_USERS_CACHE, { ts: Date.now(), users });
      toastSuccess("User deleted");
      renderResults();
    }
  };

  renderResults();
}

function bindUserMgmt(root, routeToken) {
  if (!stillOnAdmin(routeToken)) return;
  renderUsers(root).catch(() => {});
}

function bindListButtons(root, view) {
  root.querySelectorAll('[data-score]:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      const code = btn.getAttribute("data-score");
      location.hash = `#/captain?code=${encodeURIComponent(code)}&src=admin`;
    };
  });

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

  root.querySelectorAll('[data-share-potm-card]:not([disabled])').forEach(btn => {
    btn.onclick = async () => {
      const code = btn.getAttribute("data-share-potm-card");
      setDisabled(btn,true,"Creating…");
      try {
        const detail = await API.getPublicMatch(code);
        if (!detail?.ok) throw new Error(detail?.error || "Could not load POTM result");
        const results = Array.isArray(detail.potm?.results) ? detail.potm.results : [];
        const topVotes = Math.max(0,...results.map((row)=>Number(row.voteCount||0)));
        const leader = results.find((row)=>Number(row.voteCount||0)===topVotes && topVotes>0);
        const player = (detail.potm?.candidates || []).find((row)=>String(row.playerName).toLowerCase()===String(leader?.candidateName||"").toLowerCase());
        if (!leader || !player || !detail.potm?.closed) throw new Error("POTM voting has not produced a final result yet");
        const mode = await sharePotm(detail.match,formatHumanDateTime(detail.match.date,detail.match.time),player,Number(leader.voteCount||0));
        toastInfo(mode==="image"?"Choose WhatsApp to share the POTM image.":"POTM image downloaded and WhatsApp opened.");
      } catch(error) {
        if(error?.name!=="AbortError") toastError(error?.message || "POTM image could not be shared.");
      } finally { setDisabled(btn,false); }
    };
  });

  // Lock ratings
  root.querySelectorAll('[data-lock]:not([disabled])').forEach(btn => {
    btn.onclick = async () => {
      const routeToken = window.__mlfcAdminToken;
      if (!stillOnAdmin(routeToken)) return;

      const matchId = btn.getAttribute("data-lock");
      const match = (MEM.matches || []).find(item => String(item.matchId) === String(matchId));
      if (!confirm(`Complete “${match?.title || "this match"}”?\n\nThis will close POTM voting immediately. Teams, availability, scores and ratings will become read-only and the final result will be published.`)) return;
      setDisabled(btn, true, "Locking…");

      const out = await API.adminLockRatings(matchId);
      setDisabled(btn, false);

      if (!out.ok) return toastError(out.error || "Failed");
      toastSuccess("Match completed and ratings locked.");

      const found = (MEM.matches || []).find(x => String(x.matchId) === String(matchId));
      if (found?.publicCode) {
        clearPublicMatchDetailCache(found.publicCode);
        clearManageCache(found.publicCode);
      }

      // Update list cache via API only if user wants latest; but here action definitely changed state
      // so we update MEM locally (fast) and save.
      MEM.matches = (MEM.matches || []).map(m => {
        if (String(m.matchId) !== String(matchId)) return m;
        return { ...m, status: "COMPLETED", ratingsLocked: "TRUE", potmVotingClosed: 1 };
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
  const locked = isTrueFlag(m.ratingsLocked);
  const availabilityLocked = isTrueFlag(m.availabilityLocked);
  const isCompleted = status === "COMPLETED";
  const isEditLocked = locked || status === "CLOSED" || isCompleted;
  const hasBothScores = String(m.scoreHome ?? "").trim() !== "" && String(m.scoreAway ?? "").trim() !== "";
  const potm = data.potm || {};
  const potmResults = Array.isArray(potm.results) ? potm.results : [];
  const potmTopVotes = Math.max(0,...potmResults.map((row)=>Number(row.voteCount||0)));
  const potmLeaders = potmResults.filter((row)=>Number(row.voteCount||0)===potmTopVotes && potmTopVotes>0);
  const potmLead = potmLeaders[0];
  const potmPlayer = (potm.candidates || []).find((row)=>String(row.playerName).toLowerCase()===String(potmLead?.candidateName||"").toLowerCase());

  const type = String(m.type || "").toUpperCase();
  const homeTeamName = String(m.teamHomeName || (type === "OPPONENT" ? "MLFC" : "Blue"));
  const awayTeamName = String(m.teamAwayName || (type === "OPPONENT" ? "Opponent" : "Orange"));
  const availability = data.availability || [];
  const yesPlayers = uniqueSorted(availability
    .filter(a => String(a.availability).toUpperCase() === "YES")
    .map(a => String(a.playerName || "").trim())
  );

  const cap = (() => {
    const n = Math.floor(Number(m.availabilityLimit || 22));
    if (!Number.isFinite(n) || n <= 0) return 22;
    return Math.min(n, 100);
  })();

  const limitEditLocked = isCompleted; // allow editing even if availability is closed, but not once completed

  function availabilityLimitEditorHtml() {
    return `
      <details class="card">
        <summary style="font-weight:950">Availability limit</summary>

        <div class="small" style="margin-top:8px">
          Max number of players who can be <b>YES</b> for this match. Extra YES requests will be placed on the <b>WAITING</b> list.
        </div>

        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap; align-items:center">
          <input class="input" id="availLimitInput" type="number" min="1" max="100" step="1" value="${cap}" aria-label="Maximum confirmed players" style="max-width:140px" ${limitEditLocked ? "disabled" : ""} />
          <button class="btn primary" id="availLimitSave" ${limitEditLocked ? "disabled" : ""}>Save</button>
          <div class="small" id="availLimitMsg"></div>
        </div>

        ${limitEditLocked ? `<div class="small" style="margin-top:10px">This match is completed — availability limit can’t be changed.</div>` : ""}
      </details>
    `;
  }

  async function wireAvailabilityLimitEditor() {
    const input = manageArea.querySelector("#availLimitInput");
    const save = manageArea.querySelector("#availLimitSave");
    const msg = manageArea.querySelector("#availLimitMsg");
    if (!input || !save) return;

    save.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      const n = Math.min(100, Math.max(1, Math.floor(Number(input.value || cap))));
      input.value = String(n);

      setDisabled(save, true, "Saving…");
      if (msg) msg.textContent = "";

      const out = await API.adminUpdateAvailabilityLimit(m.matchId, n);
      setDisabled(save, false);
      if (!out?.ok) {
        if (msg) msg.textContent = out?.error || "Failed";
        return toastError(out?.error || "Failed");
      }

      toastSuccess("Availability limit updated.");
      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);

      // Update MEM locally (no API)
      MEM.matches = (MEM.matches || []).map(x => String(x.matchId) === String(m.matchId)
        ? { ...x, availabilityLimit: n }
        : x
      );
      lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });

      // Fetch fresh match once to refresh the manage view (availability list might have changed)
      const fresh = await API.getPublicMatch(m.publicCode);
      if (stillOnAdmin(routeToken) && fresh.ok) {
        lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
        renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
      }
    };
  }

  const availByName = new Map((availability || []).map(a => [String(a.playerName || '').trim().toLowerCase(), a]));
  const playerDeclaredNo = (name) => {
    const r = availByName.get(String(name || '').trim().toLowerCase());
    return String(r?.playerDeclared || '').trim().toUpperCase() === 'NO';
  };


  const captains = data.captains || {};
  const teams = data.teams || [];
  const playerPhotos = Object.fromEntries(teams
    .filter(row => row.photoUrl)
    .flatMap(row => [[row.playerName, row.photoUrl], [String(row.playerName || "").trim().toLowerCase(), row.photoUrl]]));

  const when = formatHumanDateTime(m.date, m.time);
  const safeTitle = escapeHtml(m.title || "Untitled match");
  const safeWhen = escapeHtml(when);
  const phaseLabel = locked ? "Completed" : hasBothScores ? "Ratings open" : availabilityLocked ? "Teams & scoring" : "Availability open";

  manageArea.innerHTML = `
    <section class="manageCommand" aria-labelledby="manageMatchTitle">
      <div class="row" style="justify-content:space-between; align-items:flex-start">
        <div style="min-width:0">
          <div class="manageCommand__eyebrow">Matchday control · ${escapeHtml(type)}</div>
          <div class="h1 manageCommand__title" id="manageMatchTitle">${safeTitle}</div>
          <div class="manageCommand__meta">${safeWhen}</div>
        </div>
        <div class="manageCommand__state"><span class="statusDot" aria-hidden="true"></span>${phaseLabel}</div>
      </div>
      <div class="manageCommand__actions">
        <button class="btn gray" id="backToAdminList">Back to matches</button>
        <button class="btn primary" id="shareMatch">Share match link</button>
        ${isEditLocked ? `<button class="btn gray" id="unlockBtn">Unlock match</button>` : ""}
        ${hasBothScores && !locked ? `<button class="btn primary" id="lockRatingsTop">Complete & lock match</button>` : ""}
      </div>
      <div class="manageCommand__notice" id="lockReason">${locked ? "Completed matches are read-only until an admin unlocks them." : !hasBothScores ? "Locking becomes available after both scores are saved." : "Ready to complete once all ratings have been checked."}</div>
      <div class="draftState" id="draftState" role="status" aria-live="polite">All setup changes saved</div>
    </section>
    ${hasBothScores ? `<section class="card potmAdminCard">
      <div class="stepEyebrow">Player of the Match</div><div class="h1">${potm.closed ? "Voting closed" : "Voting open"}</div>
      <div class="small">${Number(potm.voteCount||0)} votes cast${potm.deadlineAt ? ` · closes ${new Date(potm.deadlineAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}` : ""}${potmLeaders.length>1 ? ` · ${potmLeaders.length}-way tie` : ""}</div>
      ${potmLead ? `<div class="potmAdminLeader"><span>🏆</span><div><b>${escapeHtml(potmLead.candidateName)}</b><small>${Number(potmLead.voteCount)} votes · ${Number(potmPlayer?.goals||0)} G · ${Number(potmPlayer?.assists||0)} A · ${Number(potmPlayer?.ratingCount||0)?`${Number(potmPlayer.rating).toFixed(1)} rating`:"No rating"}</small></div></div>` : `<div class="small" style="margin-top:10px">No votes yet.</div>`}
      <button class="btn whatsappBtn" id="sharePotm" type="button" ${potmLead && potm.closed ? "" : "disabled"}>${potm.closed ? "Share POTM image" : "Share after voting closes"}</button>
    </section>` : ""}

    <details class="card">
      <summary style="font-weight:950">Team names</summary>
      <div class="formGrid formGrid--two" style="margin-top:12px">
        <div class="field"><label class="field__label" for="editTeamHomeName">Home team name</label><input class="input" id="editTeamHomeName" maxlength="40" value="${escapeHtml(m.teamHomeName || (type === "OPPONENT" ? "MLFC" : "Blue"))}" ${isEditLocked ? "disabled" : ""} /></div>
        <div class="field"><label class="field__label" for="editTeamAwayName">Away team name</label><input class="input" id="editTeamAwayName" maxlength="40" value="${escapeHtml(m.teamAwayName || (type === "OPPONENT" ? "Opponent" : "Orange"))}" ${isEditLocked ? "disabled" : ""} /></div>
      </div>
      <button class="btn primary" id="saveTeamNames" type="button" ${isEditLocked ? "disabled" : ""}>Save team names</button>
    </details>
    <div id="manageBody"></div>
  `;
  installManageCommandScrollBehavior(manageArea);

  const sharePotmButton=manageArea.querySelector("#sharePotm");
  if (sharePotmButton) sharePotmButton.onclick=async()=>{
    if (!potmPlayer || !potmLead || !potm.closed) return;
    setDisabled(sharePotmButton,true,"Creating…");
    try {
      const mode=await sharePotm(m,when,potmPlayer,Number(potmLead.voteCount||0));
      toastInfo(mode==="image"?"Choose WhatsApp to share the POTM image.":"POTM image downloaded and WhatsApp opened.");
    } catch(error) { if(error?.name!=="AbortError") toastError("POTM image could not be shared."); }
    finally { setDisabled(sharePotmButton,false); }
  };

  manageArea.querySelector("#saveTeamNames").onclick = async () => {
    const button = manageArea.querySelector("#saveTeamNames");
    const payload = {matchId:m.matchId, teamHomeName:manageArea.querySelector("#editTeamHomeName").value.trim(), teamAwayName:manageArea.querySelector("#editTeamAwayName").value.trim()};
    setDisabled(button, true, "Saving…");
    try {
      const out = await API.adminUpdateTeamNames(payload);
      if (!out.ok) return toastError(out.error || "Could not save team names");
      Object.assign(m, {teamHomeName:out.teamHomeName,teamAwayName:out.teamAwayName});
      MEM.matches = (MEM.matches || []).map(item => String(item.matchId) === String(m.matchId) ? {...item, teamHomeName:out.teamHomeName,teamAwayName:out.teamAwayName} : item);
      lsSet(matchesKey(MEM.selectedSeasonId), {ts:now(),matches:MEM.matches});
      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);
      lsSet(manageKey(m.publicCode), {ts:now(),data});
      if (stillOnAdmin(routeToken)) renderManageUI(root, data, routeToken, {fromCache:false,prevView});
      toastSuccess("Team names updated.");
    } catch (error) {
      toastError(error.message || "Could not save team names");
    } finally { setDisabled(button, false); }
  };

  // Admin manage view

  manageArea.querySelector("#backToAdminList").onclick = () => {
    const target = prevView === "past" ? "past" : "open";
    location.hash = `#/admin?view=${target}`;
  };

  manageArea.querySelector("#shareMatch").onclick = () => {
    waOpenPrefill(`Manor Lakes FC match link:\n${matchLink(m.publicCode)}`);
    toastInfo("WhatsApp opened.");
  };

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


 

  const lockRatingsTop = manageArea.querySelector("#lockRatingsTop");
  if (lockRatingsTop) lockRatingsTop.onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;

    const confirmed = confirm(
      `Complete “${m.title || "this match"}”?\n\nThis will:\n• close POTM voting immediately\n• lock team and availability changes\n• lock scores and ratings\n• publish the final result\n• mark the match completed\n\nAn admin can unlock the match later, but POTM voting will remain closed.`
    );
    if (!confirmed) return;

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

  let fieldPositions = positionMap(teams);
  let savedPositions = JSON.stringify(fieldPositions);

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
    const savedOpponent = { squad: [...squad], captain: cap };
    const opponentDraft = lsGet(setupDraftKey(m.matchId));
    let opponentCaptain = cap;
    if (!isEditLocked && opponentDraft?.type === "OPPONENT") {
      squad = uniqueSorted((opponentDraft.squad || []).filter(name => yesPlayers.includes(name)));
      fieldPositions = opponentDraft.positions || fieldPositions;
      opponentCaptain = squad.includes(opponentDraft.captain) ? opponentDraft.captain : "";
    }

    function updateOpponentDraft() {
      const dirty = JSON.stringify(fieldPositions) !== savedPositions || !sameNames(squad, savedOpponent.squad) || opponentCaptain.toLowerCase() !== savedOpponent.captain.toLowerCase();
      const state = manageArea.querySelector("#draftState");
      if (state) {
        state.textContent = dirty ? "Unsaved setup · draft saved on this device" : "All setup changes saved";
        state.classList.toggle("isDirty", dirty);
      }
      if (dirty) lsSet(setupDraftKey(m.matchId), { type: "OPPONENT", squad, captain: opponentCaptain, positions:fieldPositions, ts: now() });
      else lsDel(setupDraftKey(m.matchId));
    }

    function renderSquadLists() {
      mountTeamField(manageBody.querySelector("#opponentTeamPreview"), {
        groups:[{team:"MLFC",label:homeTeamName,players:squad,captain:opponentCaptain}],positions:fieldPositions,photos:playerPhotos,pool:yesPlayers,disabled:isEditLocked,
        onSave:() => manageBody.querySelector("#saveOpponent").click(),
        onClear:() => { squad=[]; opponentCaptain=""; fieldPositions={}; updateOpponentDraft(); renderSquadLists(); },
        onAuto:() => { squad=uniqueSorted([...squad,...yesPlayers]); updateOpponentDraft(); renderSquadLists(); },
        onChange:updateOpponentDraft,
        onAssign:p => { squad=uniqueSorted([...squad,p]); updateOpponentDraft(); renderSquadLists(); },
        onCaptain:p => { opponentCaptain=p; updateOpponentDraft(); renderSquadLists(); },
        onRemove:p => { squad=squad.filter(n => n !== p); if(opponentCaptain === p) opponentCaptain=""; delete fieldPositions[p]; updateOpponentDraft(); renderSquadLists(); }
      });
      const share=manageBody.querySelector("#shareSquad"); if(share) share.disabled=!squad.length;
    }

    manageBody.innerHTML = `
      ${availabilityLimitEditorHtml()}
      <details class="card" open>
        <summary style="font-weight:950">Opponent match setup</summary>

        <div id="opponentTeamPreview"></div>

        <div class="row" style="margin-top:14px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="saveOpponent" ${isEditLocked ? "disabled" : ""}>Save setup</button>
          <button class="btn whatsappBtn" id="shareSquad" ${squad.length ? "" : "disabled"}>Share team sheet</button>
          ${!isEditLocked ? (availabilityLocked ? `<button class="btn gray" id="openAvailability">Re-open availability</button>` : `<button class="btn warn" id="closeAvailability">Close availability</button>`) : ""}
        </div>

        <div class="hr"></div>

        <div class="h1">Availability (admin)</div>
        <div class="small">Add/update any player’s availability (including people without the app).</div>

        <label class="field__label" for="adminPlayerCombo">Player name</label>
        <input id="adminPlayerCombo" class="input" type="search" placeholder="Start typing a name" autocomplete="off" style="margin-top:7px" ${isEditLocked ? "disabled" : ""} />
        <div id="adminPlayerComboList" class="comboList" style="display:none"></div>

        <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
          <select id="adminAddAvailability" class="input" aria-label="Player availability" style="width:200px" ${isEditLocked ? "disabled" : ""}>
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

    wireAvailabilityLimitEditor();

    renderSquadLists();
    updateOpponentDraft();

    const openAdmin = manageBody.querySelector("#openRatingsAdmin");
    if (openAdmin) openAdmin.onclick = () => {
      location.hash = `#/captain?code=${encodeURIComponent(m.publicCode)}&src=admin`;
    };

    manageBody.querySelector("#shareSquad").onclick = async () => {
      if (!squad.length) return toastWarn("Select the MLFC squad first.");
      const button = manageBody.querySelector("#shareSquad");
      setDisabled(button, true, "Preparing…");
      try {
        const mode = await shareTeamSheet(m, when, homeTeamName || "MLFC", squad, "", [], fieldPositions, [opponentCaptain], playerPhotos);
        const published = await API.adminShareTeams(m.matchId);
        if (!published?.ok) throw new Error(published?.error || "Team notification could not be sent");
        toastInfo(mode === "image" ? "Choose WhatsApp to share the team-sheet image." : "Field image downloaded. Attach it in WhatsApp to share.");
      } catch (error) {
        if (error?.name !== "AbortError") toastError("Team sheet could not be shared.");
      } finally { setDisabled(button, false); }
    };

    manageBody.querySelector("#saveOpponent").onclick = async () => {
      const btn = manageBody.querySelector("#saveOpponent");
      const msg = manageBody.querySelector("#msg");
      const selCaptain = opponentCaptain;

      if (!squad.length) return toastWarn("Select at least one MLFC player before saving.");
      if (!selCaptain) return toastWarn("Select one MLFC captain before saving.");

      setDisabled(btn, true, "Saving…");
      msg.textContent = "Saving…";

      const out = await API.adminSetupOpponent({ matchId: m.matchId, captain: selCaptain, mlfcPlayers: squad, positions:positionRows([{team:"MLFC",players:squad}],fieldPositions) });
      setDisabled(btn, false);

      if (!out.ok) { msg.textContent = out.error || "Failed"; return toastError(out.error || "Failed"); }
      msg.textContent = "Saved ✅";
      toastSuccess("Opponent match setup saved.");
      lsDel(setupDraftKey(m.matchId));
      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);
      savedOpponent.squad = [...squad];
      savedOpponent.captain = opponentCaptain;
      savedPositions = JSON.stringify(fieldPositions);
      const state = manageArea.querySelector("#draftState");
      if (state) { state.textContent = "All setup changes saved"; state.classList.remove("isDirty"); }
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
        if (desired === "WAITING" && yesPlayers.length < cap) {
          return toastWarn(`Waiting list is only available once ${cap} players are marked YES.`);
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
  let autoBalanceReport = null;
  const savedInternal = { blue: [...blue], orange: [...orange], captainBlue, captainOrange };
  const internalDraft = lsGet(setupDraftKey(m.matchId));

  if (!isEditLocked && internalDraft?.type === "INTERNAL") {
    const allowed = new Set(yesPlayers.map(name => name.toLowerCase()));
    blue = uniqueSorted((internalDraft.blue || []).filter(name => allowed.has(name.toLowerCase())));
    orange = uniqueSorted((internalDraft.orange || []).filter(name => allowed.has(name.toLowerCase()) && !blue.some(b => b.toLowerCase() === name.toLowerCase())));
    fieldPositions = internalDraft.positions || fieldPositions;
    captainBlue = blue.includes(internalDraft.captainBlue) ? internalDraft.captainBlue : "";
    captainOrange = orange.includes(internalDraft.captainOrange) ? internalDraft.captainOrange : "";
  }

  function updateInternalDraft() {
    const dirty = JSON.stringify(fieldPositions) !== savedPositions || !sameNames(blue, savedInternal.blue) || !sameNames(orange, savedInternal.orange) ||
      captainBlue.toLowerCase() !== savedInternal.captainBlue.toLowerCase() ||
      captainOrange.toLowerCase() !== savedInternal.captainOrange.toLowerCase();
    const state = manageArea.querySelector("#draftState");
    if (state) {
      state.textContent = dirty ? "Unsaved setup · draft saved on this device" : "All setup changes saved";
      state.classList.toggle("isDirty", dirty);
    }
    if (dirty) lsSet(setupDraftKey(m.matchId), { type: "INTERNAL", blue, orange, captainBlue, captainOrange, positions: fieldPositions, ts: now() });
    else lsDel(setupDraftKey(m.matchId));
  }

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
    autoBalanceReport = null;
    updateInternalDraft();
  }

  function removeFromTeam(p) {
    blue = blue.filter(x => x !== p);
    orange = orange.filter(x => x !== p);
    if (captainBlue === p) captainBlue = "";
    if (captainOrange === p) captainOrange = "";
    autoBalanceReport = null;
    updateInternalDraft();
  }

  manageBody.innerHTML = `
    ${availabilityLimitEditorHtml()}
    <details class="card">
      <summary style="font-weight:950">Add players to this match (Admin)</summary>

      <div class="small" style="margin-top:8px">
        Search and select an existing player to add/update their availability.
        (Only existing names are allowed.)
      </div>

      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap; align-items:center">
        <div class="comboWrap" style="flex:1; min-width:220px; position:relative">
          <label class="field__label" for="adminPlayerCombo">Player name</label>
          <input class="input" id="adminPlayerCombo" type="search" placeholder="Start typing a name" autocomplete="off" style="width:100%; margin-top:7px" />
          <div id="adminPlayerComboList" class="comboList" style="display:none"></div>
        </div>

        <select class="input" id="adminAddAvailability" aria-label="Player availability" style="min-width:160px">
          <option value="YES" selected>YES (Available)</option>
          <option value="NO">NO (Not available)</option>
          <option value="WAITING" ${yesPlayers.length >= cap ? "" : "disabled"}>WAITING LIST</option>
        </select>

        <button class="btn primary" id="adminAddPlayerBtn" ${isEditLocked ? "disabled" : ""}>Add / Update</button>
</div>

      <div id="adminAddPlayerMsg" class="small" style="margin-top:10px"></div>
    </details>

    <details class="card" open>
      <summary style="font-weight:950">Internal setup</summary>

      <div class="teamAssignTools" aria-label="Team selection tools">
        <button class="btn smartTeamBtn" id="autoBalanceTeams" type="button" ${isEditLocked || yesPlayers.length < 2 ? "disabled" : ""}><span aria-hidden="true">✦</span> Auto team</button>
        <button class="btn gray" id="clearTeamSelections" type="button" ${isEditLocked ? "disabled" : ""}>Clear teams</button>
        <span id="unassignedCount" class="small"></span>
      </div>
      <div class="autoTeamIntro">Uses recent ratings, goals, assists and past team combinations. Review the draft, then save it.</div>
      <div id="autoTeamReport" class="autoTeamReport" role="status" aria-live="polite" hidden></div>

      <div id="digitalTeamPreview"></div>

      <!-- Requested: Save + Share after lists -->
      <div class="row fieldSaveBar" style="margin-top:14px; gap:10px; flex-wrap:wrap">
        <button class="btn primary" id="saveSetup" ${isEditLocked ? "disabled" : ""}>Save setup</button>
        <button class="btn whatsappBtn" id="shareTeams" ${hasAnyTeams ? "" : "disabled"}>Share team sheet</button>
         ${!isEditLocked ? (availabilityLocked ? `<button class="btn gray" id="openAvailability">Re-open availability</button>` : `<button class="btn warn" id="closeAvailability">Close availability</button>`) : ""}
      </div>

      <div class="hr"></div>

      <div class="h1">Ratings</div>
      <div class="small">Admin can rate all players for this match (partial submission allowed).</div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="openRatingsAdminInternal" ${hasAnyTeams ? "" : "disabled"}>Give ratings</button>
      </div>
      ${hasAnyTeams ? "" : `<div class="small" style="margin-top:8px">Assign players to teams and save setup before giving ratings.</div>`}

      <div id="setupMsg" class="small" style="margin-top:10px"></div>
    </details>

    
  `;

  wireAvailabilityLimitEditor();

  
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

      // Enforce UI rule: waiting list only enabled when the match capacity is reached.
      if (desired === "WAITING" && yesPlayers.length < cap) {
        return toastWarn(`Waiting list is only available once ${cap} players are marked YES.`);
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

  function renderAll() {
    blue = uniqueSorted(blue);
    orange = uniqueSorted(orange);


    const unassigned = yesPlayers.filter((player) => !assignedTeam(player));
    const count = manageBody.querySelector("#unassignedCount");
    if (count) count.textContent = `${unassigned.length} unassigned`;
    const report = manageBody.querySelector("#autoTeamReport");
    if (report) {
      report.hidden = !autoBalanceReport;
      if (autoBalanceReport) {
        const rated = Number(autoBalanceReport.ratedPlayers || 0);
        const total = Number(autoBalanceReport.playerCount || yesPlayers.length);
        const history = Number(autoBalanceReport.historicalMatches || 0);
        report.innerHTML = `<strong>${Number(autoBalanceReport.balancePercent || 0)}% balanced</strong><span>${escapeHtml(homeTeamName)} ${Number(autoBalanceReport.blueStrength || 0).toFixed(1)} · ${escapeHtml(awayTeamName)} ${Number(autoBalanceReport.orangeStrength || 0).toFixed(1)}</span><small>${rated}/${total} players have rating history · ${history} past internal ${history === 1 ? "match" : "matches"} considered</small>`;
      }
    }
    const preview = manageBody.querySelector("#digitalTeamPreview");
    if (preview) mountTeamField(preview, {
      groups: [{team:"BLUE",label:homeTeamName,players:blue,captain:captainBlue},{team:"ORANGE",label:awayTeamName,players:orange,captain:captainOrange}],
      positions:fieldPositions, photos:playerPhotos, pool:yesPlayers, disabled:isEditLocked,
      onSave:() => manageBody.querySelector("#saveSetup").click(),
      onAuto:() => manageBody.querySelector("#autoBalanceTeams").click(),
      onClear:() => manageBody.querySelector("#clearTeamSelections").click(),
      onChange:updateInternalDraft,
      onAssign:(p,t) => { setTeam(p,t); renderAll(); },
      onCaptain:(p,t) => { if(t === "BLUE") captainBlue=p; else captainOrange=p; updateInternalDraft(); renderAll(); },
      onRemove:p => { delete fieldPositions[p]; removeFromTeam(p); renderAll(); },
      onTransfer:(p,t) => { delete fieldPositions[p]; setTeam(p,t === "BLUE" ? "ORANGE" : "BLUE"); renderAll(); }
    });

    const shareBtn = manageBody.querySelector("#shareTeams");
    if (shareBtn) {
      const ok = (blue.length + orange.length) > 0;
      shareBtn.disabled = !ok;
    }
  }

  renderAll();
  updateInternalDraft();

  const autoBalanceTeams = manageBody.querySelector("#autoBalanceTeams");
  if (autoBalanceTeams) autoBalanceTeams.onclick = async () => {
    if (yesPlayers.length < 2) return toastWarn("Mark at least two players as available first.");
    setDisabled(autoBalanceTeams, true, "Balancing…");
    try {
      const out = await API.adminAutoTeams(m.matchId);
      if (!out?.ok) throw new Error(out?.error || "Could not create balanced teams");
      if (!stillOnAdmin(routeToken)) return;
      blue = uniqueSorted(out.bluePlayers || []);
      orange = uniqueSorted(out.orangePlayers || []);
      if (!blue.includes(captainBlue)) captainBlue = "";
      if (!orange.includes(captainOrange)) captainOrange = "";
      fieldPositions = {};
      autoBalanceReport = out.balance || null;
      updateInternalDraft();
      renderAll();
      toastSuccess(`Balanced ${blue.length + orange.length} players. Review and save the draft.`);
    } catch (error) {
      toastError(String(error?.message || error));
    } finally {
      setDisabled(autoBalanceTeams, false, "Balancing…");
    }
  };

  const clearTeamSelections = manageBody.querySelector("#clearTeamSelections");
  if (clearTeamSelections) clearTeamSelections.onclick = () => {
    if (!(blue.length || orange.length)) return;
    if (!window.confirm("Reset both team selections? The saved setup will not change until you select Save setup.")) return;
    blue = [];
    orange = [];
    captainBlue = "";
    captainOrange = "";
    fieldPositions = {};
    autoBalanceReport = null;
    updateInternalDraft();
    renderAll();
  };

  // Admin ratings entry point (internal matches)
  const openRatingsInternal = manageBody.querySelector("#openRatingsAdminInternal");
  if (openRatingsInternal) {
    openRatingsInternal.onclick = () => {
      if ((blue.length + orange.length) === 0) return toastWarn("Assign players to teams and save setup before giving ratings.");
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
      captainOrange,
      positions: positionRows([{team:"BLUE",players:blue},{team:"ORANGE",players:orange}],fieldPositions)
    });

    setDisabled(btn, false);

    if (!out.ok) {
      msg.textContent = out.error || "Failed";
      return toastError(out.error || "Failed to save setup");
    }

    msg.textContent = "Saved ✅";
    toastSuccess("Setup saved.");
    lsDel(setupDraftKey(m.matchId));
    savedInternal.blue = [...blue];
    savedInternal.orange = [...orange];
    savedInternal.captainBlue = captainBlue;
    savedInternal.captainOrange = captainOrange;
    savedPositions = JSON.stringify(fieldPositions);
    clearManageCache(m.publicCode);
    clearPublicMatchDetailCache(m.publicCode);
    const state = manageArea.querySelector("#draftState");
    if (state) { state.textContent = "All setup changes saved"; state.classList.remove("isDirty"); }
  };

  // Share teams (after saved)
  const shareTeamsBtn = manageBody.querySelector("#shareTeams");
  shareTeamsBtn.onclick = async () => {
    const ok = (blue.length + orange.length) > 0;
    if (!ok) return toastWarn("Assign players to Blue/Orange first.");

    setDisabled(shareTeamsBtn, true, "Opening…");

  try {
    const mode = await shareTeamSheet(m, when, homeTeamName, blue, awayTeamName, orange, fieldPositions, [captainBlue,captainOrange], playerPhotos);
    const published = await API.adminShareTeams(m.matchId);
    if (!published?.ok) throw new Error(published?.error || "Team notification could not be sent");
    toastInfo(mode === "image" ? "Choose WhatsApp to share the team-sheet image." : "Field image downloaded. Attach it in WhatsApp to share.");
  } catch (error) {
    if (error?.name !== "AbortError") toastError("Team sheet could not be shared.");
  } finally { setDisabled(shareTeamsBtn, false); }
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
      <div class="card">
        <div class="h1" style="margin:0">User management</div>
        ${topNavHtml("users")}
      </div>
      <div class="card" id="usersArea"></div>
    `;
    bindTopNav(root, routeToken);
    await renderUsers(root);
    return;
  }

  renderAdminShell(root, view);

  bindTopNav(root, routeToken);
  bindSeasonSelector(root, routeToken);
  bindSeasonMgmt(root, routeToken);
  bindCreateMatch(root, routeToken);
  bindAnnouncement(root, routeToken);
  bindHeaderButtons(root, routeToken);
  // Users view is rendered on demand
  if (view === "users") {
    bindUserMgmt(root, routeToken);
  }

  const msg = root.querySelector("#msg");
  msg.textContent = MEM.matches.length
    ? "Loaded from device cache."
    : "No cached matches for this season yet.";

  async function refreshAdminList(opts = {}) {
    const force = !!opts.force;
    const silent = !!opts.silent;
    const seasonId = MEM.selectedSeasonId;

    if (!shouldRefreshAdminMatches(seasonId, { force })) return;
    if (ADMIN_REFRESH_INFLIGHT) return;

    const t = now();
    if (!force && t - ADMIN_LAST_REFRESH_TS < ADMIN_MATCH_REFRESH_COOLDOWN_MS) return;
    ADMIN_LAST_REFRESH_TS = t;

    if (!silent) msg.textContent = "Loading latest…";

    ADMIN_REFRESH_INFLIGHT = true;
    try {
      const out = await refreshMatchesFromApi(seasonId, routeToken);
      if (!stillOnAdmin(routeToken)) return;
      if (!out.ok) {
        if (!silent) msg.textContent = out.error || "Failed to load";
        return;
      }

      msg.textContent = silent ? "Updated just now." : "";
      renderListView(root, (view === "past") ? "past" : "open");
    } finally {
      ADMIN_REFRESH_INFLIGHT = false;
    }
  }

  ACTIVE_ADMIN = { root, routeToken, view, refreshList: refreshAdminList };
  ensureAdminAutoRefresh();

  const viewNow = view;
  const hasCache = !!lsGet(matchesKey(MEM.selectedSeasonId));
  const cacheStale = (now() - Number(lsGet(matchesKey(MEM.selectedSeasonId))?.ts || 0)) > ADMIN_MATCH_CACHE_MAX_AGE_MS;
  // In iOS installed app (Add to Home Screen), reload semantics are unreliable.
  const shouldReloadFetch = (viewNow === "open" || viewNow === "past") && (isIOSStandalone() || isReloadForAdminList() || !hasCache || cacheStale);
  if (shouldReloadFetch) {
    await refreshAdminList({ force: true, silent: false });
    if (!stillOnAdmin(routeToken)) return;
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
