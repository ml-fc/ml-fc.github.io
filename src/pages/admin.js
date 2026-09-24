import { drawFcCard } from "../ui/fc_card.js";
import { mountTeamField, positionMap, positionRows, defaultPositions, randomGoalkeeperPositions, fieldPositionCode } from "../ui/team_field.js";
// src/pages/admin.js
import { API } from "../api/endpoints.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { cleanupCaches } from "../cache_cleanup.js";
import { isReloadForAdminList, isReloadForAdminMatchCode, isReloadFor, isIOSStandalone } from "../nav_state.js";
import { clearAuth, updateNavForUser, getCachedUser, getToken, refreshMe } from "../auth.js";
import { initials, loadCanvasImage } from "../ui/player_photo.js";
import { EPL_THEMES, getActiveWeeklyTheme } from "../themes.js";

const LS_ADMIN_KEY = "mlfc_adminKey";
const LS_SELECTED_SEASON = "mlfc_selected_season_v1";
const LS_SEASONS_CACHE = "mlfc_seasons_cache_v1"; // {ts, data}

const LS_ADMIN_MATCHES_PREFIX = "mlfc_admin_matches_cache_v3:"; // + seasonId => {ts, matches}
const LS_MANAGE_CACHE_PREFIX = "mlfc_admin_manage_cache_v3:";   // + code => {ts, data}
const LS_MATCH_DETAIL_PREFIX = "mlfc_match_detail_cache_v2:";   // shared with match page
const LS_USERS_CACHE = "mlfc_admin_users_cache_v1"; // {ts, users}
const USERS_CACHE_MAX_AGE_MS = 60 * 1000;
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
let PENDING_LEADERS_SHARE = null;

function now() { return Date.now(); }

async function leadersBoardFile(payload){
  const cards=payload.cards||[],cols=5,rows=Math.max(1,Math.ceil(cards.length/cols)),cardW=960,cardH=1220,gap=55,pad=110,header=250;
  const canvas=document.createElement("canvas");canvas.width=pad*2+cols*cardW+(cols-1)*gap;canvas.height=header+pad+rows*cardH+(rows-1)*gap;const c=canvas.getContext("2d");
  c.fillStyle="#061827";c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle="#f0d473";c.font="400 104px Impact, Arial Narrow, sans-serif";c.fillText("MLFC SEASON LEADERS",pad,125);c.fillStyle="#b8dcec";c.font="700 42px Arial";c.fillText(`${payload.season?.name||"Season"} · TOP ${cards.length} RATED PLAYERS`,pad,190);
  for(let index=0;index<cards.length;index++){
    const item=cards[index],card=item.card||{},x=pad+(index%cols)*(cardW+gap),y=header+Math.floor(index/cols)*(cardH+gap);
    await drawFcCard(c,card,item.playerName,x,y,cardW,1200);
    c.textAlign="center";c.fillStyle="#f0d473";c.font="700 24px Arial";c.fillText(`#${index+1} · ${Number(item.avgRating||0).toFixed(2)} AVG · ${Number(item.matchesRated||0)} RATED`,x+cardW/2,y+1220);c.textAlign="left";
  }
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));return blob?new File([blob],`mlfc-${String(payload.season?.name||"season").toLowerCase().replace(/[^a-z0-9]+/g,"-")}-top-20.png`,{type:"image/png"}):null;
}

async function shareLeaders(root,button){
  const seasonId=MEM.selectedSeasonId;
  if(!seasonId)return toastWarn("Select a season first.");

  // Calling share immediately on the second tap preserves the transient user
  // activation that mobile browsers require. Building 20 cards can take long
  // enough for that activation to expire if sharing is attempted on the first tap.
  if(PENDING_LEADERS_SHARE?.seasonId===seasonId){
    const shareData=PENDING_LEADERS_SHARE.shareData;
    if(navigator.share&&navigator.canShare?.(shareData)){
      try{
        await navigator.share(shareData);
        PENDING_LEADERS_SHARE=null;
        button.textContent="Share top 20 FC Cards";
      }catch(error){
        if(error?.name!=="AbortError"){
          downloadLeadersFile(shareData.files[0]);
          PENDING_LEADERS_SHARE=null;
          button.textContent="Share top 20 FC Cards";
        }
      }
    }else{
      downloadLeadersFile(shareData.files[0]);
      PENDING_LEADERS_SHARE=null;
      button.textContent="Share top 20 FC Cards";
    }
    return;
  }

  setDisabled(button,true,"Building HD image…");
  try{
    const payload=await API.adminFcCardLeaders(seasonId);
    if(!payload?.ok)throw new Error(payload?.error||"Could not load leaders");
    if(!payload.cards?.length)throw new Error("No rated players in this season yet.");
    const file=await leadersBoardFile(payload);
    if(!file)throw new Error("Could not create the image");
    const text=`⚽ MLFC ${payload.season.name} · Top ${payload.cards.length} rated players`;
    const shareData={title:"MLFC season leaders",text,files:[file]};
    if(navigator.share&&navigator.canShare?.(shareData)){
      PENDING_LEADERS_SHARE={seasonId,shareData};
      toastInfo("Image ready — tap Share again.");
    }else{
      downloadLeadersFile(file);
    }
  }catch(error){
    toastError(error?.message||"Could not prepare leaders");
  }finally{
    setDisabled(button,false);
    if(PENDING_LEADERS_SHARE?.seasonId===seasonId)button.textContent="Share image — tap again";
  }
}

function downloadLeadersFile(file){
  const url=URL.createObjectURL(file);
  const link=document.createElement("a");
  link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  toastInfo("HD leaders image downloaded.");
}
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

function streamState(match) {
  const status = String(match?.streamStatus || "NONE").trim().toUpperCase();
  return ["READY", "LIVE", "ENDED"].includes(status) ? status : "NONE";
}

function streamVideoId(match) {
  const id = String(match?.streamVideoId || "").trim();
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}

function streamDeskHtml(match) {
  const status = streamState(match);
  const videoId = streamVideoId(match);
  const configured = Boolean(videoId);
  const live = status === "LIVE";
  const statusLabel = live ? "Live on MLFC" : status === "READY" ? "Ready to go live" : status === "ENDED" ? "Replay available" : "Not configured";
  const watchUrl = configured ? `https://www.youtube.com/watch?v=${videoId}` : "";
  const streamVersion = encodeURIComponent(String(match?.streamUpdatedAt || videoId));
  const embedUrl = configured ? `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0&mlfc=${streamVersion}` : "";
  return `<section class="streamDesk${live ? " is-live" : ""}" id="streamDesk" aria-labelledby="streamDeskTitle">
    <header class="streamDesk__head">
      <div class="streamDesk__signal"><span class="${live ? "liveSignal" : "streamStandbyDot"}" aria-hidden="true"></span><span>${live ? "LIVE" : "MATCH STREAM"}</span></div>
      <div><div class="stepEyebrow">Unlisted YouTube coverage</div><div class="h1" id="streamDeskTitle">${statusLabel}</div></div>
    </header>
    ${configured ? `<div class="streamDesk__preview"><iframe src="${embedUrl}" title="YouTube stream preview" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>` : ""}
    <div class="streamDesk__body">
      <div class="streamDesk__instructions">
        ${configured
          ? `<strong>${live ? "Players can now see the LIVE banner." : status === "ENDED" ? "The match page is showing this video as a replay." : "The player is already waiting at the top of the match page."}</strong><p>${live ? "When the YouTube broadcast finishes, stop the live display here so the home banner disappears." : "Start the broadcast in YouTube, then mark it live here. YouTube itself remains controlled in YouTube."}</p>`
          : `<strong>Prepare the stream in three steps</strong><ol><li>Create the broadcast in YouTube and set visibility to <b>Unlisted</b>.</li><li>Copy the public watch link—not the stream key or Studio URL.</li><li>Paste it below and save.</li></ol>`}
      </div>
      ${live ? `<div class="streamDesk__link"><span>YouTube video</span><code>${escapeHtml(videoId)}</code></div>` : `<div class="field streamDesk__field"><label class="field__label" for="youtubeStreamUrl">YouTube watch link</label><input class="input" id="youtubeStreamUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://www.youtube.com/watch?v=…" value="${watchUrl}" aria-describedby="streamDeskHelp" /><div class="field__help" id="streamDeskHelp">Only the public video ID is stored. MLFC never receives the YouTube login or stream key.</div></div>`}
      <div class="streamDesk__actions">
        ${!configured ? `<button class="btn primary" id="saveStream" type="button">Save stream</button>` : ""}
        ${configured && !live ? `<button class="btn primary" id="startStream" type="button">${status === "ENDED" ? "Go live again on MLFC" : "Start live on MLFC"}</button><button class="btn gray" id="saveStream" type="button">Save link</button>` : ""}
        ${live ? `<button class="btn danger" id="stopStream" type="button">Stop live on MLFC</button>` : ""}
        ${configured && !live ? `<button class="btn dangerGhost" id="removeStream" type="button">Remove stream</button>` : ""}
      </div>
      <div class="field__message" id="streamDeskMessage" role="status" aria-live="polite"></div>
      <p class="streamDesk__controlNote"><b>Important:</b> these controls change what appears in MLFC. Start or end the actual camera broadcast in YouTube.</p>
    </div>
  </section>`;
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

async function teamSheetImageFile(match, when, homeName, homePlayers, awayName = "", awayPlayers = [], positions = {}, captains = [], photos = {}, balance = null) {
  const canvas = document.createElement("canvas");
  canvas.width = 2160;
  canvas.height = balance ? 3420 : 3120;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.scale(2, 2);
  const weeklyTheme = getActiveWeeklyTheme();
  const gradient = context.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, weeklyTheme?.background || "#061724");
  gradient.addColorStop(1, weeklyTheme?.panel2 || "#0e3a52");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, balance ? 1710 : 1560);
  context.strokeStyle = "rgba(114,215,250,.25)";
  context.lineWidth = 3;
  context.beginPath(); context.arc(940, 250, 280, 0, Math.PI * 2); context.stroke();

  context.fillStyle = weeklyTheme?.accent || "#72d7fa";
  context.font = "900 24px Arial";
  context.fillText("MANOR LAKES FC · DIGITAL TEAM SHEET", 70, 80);
  context.fillStyle = "#ffffff";
  context.font = "900 58px Arial";
  const titleLines = wrapCanvasText(context, match.title, 900).slice(0, 2);
  titleLines.forEach((line, index) => context.fillText(line.toUpperCase(), 70, 155 + index * 64));
  context.fillStyle = "#bed2dc";
  context.font = "700 25px Arial";
  context.fillText(when, 70, 300);
  if (weeklyTheme) {
    context.fillStyle = weeklyTheme.accent;
    context.font = "900 18px Arial";
    context.textAlign = "right";
    context.fillText(`TEAM OF THE WEEK · ${weeklyTheme.name.toUpperCase()}`, 1010, 80);
    context.textAlign = "left";
  }

  const teams = [{ name: homeName, players: homePlayers, color: "#72d7fa", captain:captains[0], upper:false }];
  if (awayName) teams.push({ name: awayName, players: awayPlayers, color: "#ff9c55", captain:captains[1], upper:true });
  const weeklyCrest = await loadCanvasImage(weeklyTheme?.crest);
  const portraits = new Map(await Promise.all(
    [...new Set(teams.flatMap(team => team.players))].map(async name => [
      name,
      await loadCanvasImage(photos[name] || photos[String(name).trim().toLowerCase()]),
    ])
  ));
  const left=70, top=370, width=940, height=1050;
  context.fillStyle="#26713b";
  context.fillRect(left,top,width,height);
  context.fillStyle="#226936";
  for(let i=0;i<10;i+=2) context.fillRect(left,top+i*height/10,width,height/10);
  if (weeklyCrest) {
    const crestSize=Math.min(width*.58,height*.52);
    context.save();context.globalAlpha=.1;
    context.drawImage(weeklyCrest,left+(width-crestSize)/2,top+(height-crestSize)/2,crestSize,crestSize);
    context.restore();
  }
  context.strokeStyle="#78949c"; context.lineWidth=3;
  context.strokeRect(left,top,width,height);
  context.beginPath();context.moveTo(left,top+height/2);context.lineTo(left+width,top+height/2);context.stroke();
  context.beginPath();context.arc(left+width/2,top+height/2,70,0,Math.PI*2);context.stroke();
  context.strokeRect(left+width*.32,top,width*.36,50);
  context.strokeRect(left+width*.32,top+height-50,width*.36,50);
  context.textAlign="center";
  context.fillStyle=weeklyTheme?.accent||"#72d7fa";context.font="900 24px Arial";
  context.fillText(teams.map(team=>team.name).join(" VS ").toUpperCase(),540,345,900);
  for(const team of teams) {
    const defaults=defaultPositions(team.players);
    team.players.forEach((name)=>{
        const position=positions[name]||defaults[name]||{positionX:50,positionY:50};
        const rawX=Number(position.positionX),rawY=Number(position.positionY);
        const positionX=Math.max(7,Math.min(93,Number.isFinite(rawX)?rawX:50));
        const positionY=Math.max(7,Math.min(93,Number.isFinite(rawY)?rawY:50));
        const x=left+width*(team.upper ? 100-positionX : positionX)/100;
        const displayY=teams.length===1 ? 100-positionY : team.upper ? 50-positionY/2 : 50+positionY/2;
        const y=top+height*displayY/100;
        const portrait=portraits.get(name);
        const markerRadius=29;
        context.save();
        context.shadowColor="rgba(0,0,0,.36)";context.shadowBlur=10;
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
        context.strokeStyle=team.color;context.lineWidth=7;context.beginPath();context.arc(x,y,markerRadius,0,Math.PI*2);context.stroke();
        context.strokeStyle="#fff";context.lineWidth=2;context.beginPath();context.arc(x,y,markerRadius-4,0,Math.PI*2);context.stroke();
        const role=fieldPositionCode({positionX,positionY});
        if(role) {
          context.fillStyle="#fff";context.beginPath();context.arc(x-22,y-20,13,0,Math.PI*2);context.fill();
          context.fillStyle="#132c3b";context.font="900 10px Arial";context.fillText(role,x-22,y-16);
        }
        if(name===team.captain) {
          context.fillStyle="#ffe16a";context.beginPath();context.arc(x+21,y-19,12,0,Math.PI*2);context.fill();
          context.fillStyle="#132c3b";context.font="900 15px Arial";context.fillText("C",x+21,y-14);
        }
        context.font="900 20px Arial";
        const maxLabelWidth=170;
        const label=fitCanvasLabel(context,name,maxLabelWidth-18);
        const labelWidth=context.measureText(label).width+18;
        const labelY=y+markerRadius+7;
        context.fillStyle="rgba(2,19,30,.9)";context.fillRect(x-labelWidth/2,labelY,labelWidth,29);
        context.fillStyle="#fff";context.fillText(label,x,labelY+21);
    });
  }
  context.textAlign="left";
  if (balance) {
    context.fillStyle="#dff7ff"; context.fillRect(70,1490,940,154);
    context.fillStyle="#0e3a52"; context.font="900 42px Arial";
    context.fillText(`${Number(balance.balancePercent || 0)}% TEAM BALANCE`,94,1542);
    context.font="800 23px Arial";
    context.fillText(`${homeName} ${Number(balance.blueStrength || 0).toFixed(1)} · ${awayName} ${Number(balance.orangeStrength || 0).toFixed(1)}`,94,1582);
    context.font="700 19px Arial";
    context.fillText(`Considerations: recent ratings · goals and assists · past team combinations`,94,1617);
  }
  context.fillStyle = "#bed2dc";
  context.font = "700 22px Arial";
  context.fillText("Shared by the Manor Lakes FC club desk", 70, balance ? 1680 : 1515);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `mlfc-team-sheet-${match.publicCode}.png`, { type: "image/png" }) : null;
}

async function shareTeamSheet(match, when, homeName, homePlayers, awayName = "", awayPlayers = [], positions = {}, captains = [], photos = {}, balance = null) {
  const file = await teamSheetImageFile(match, when, homeName, homePlayers, awayName, awayPlayers, positions, captains, photos, balance);
  if (!file) throw new Error("Could not create team sheet image");
  if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
    const balanceText = balance ? `\n⚖️ ${Number(balance.balancePercent || 0)}% balanced · ${homeName} ${Number(balance.blueStrength || 0).toFixed(1)} / ${awayName} ${Number(balance.orangeStrength || 0).toFixed(1)}\nConsidered: recent ratings, goals, assists and past team combinations\n` : "";
    const caption = `⚽ ${match.title}\n🗓️ ${when}${balanceText}\nView match: ${matchLink(match.publicCode)}`;
    await navigator.share({ title: `${match.title} team sheet`, text: caption, files: [file] });
    return "image";
  }
  const url=URL.createObjectURL(file);
  const link=document.createElement("a");
  link.href=url; link.download=file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return "download";
}

function drawPotmCelebration(context, width, height) {
  const colors = ["#ffe16a", "#72d7fa", "#45dc8a", "#ff8b78", "#ffffff"];
  for (let index = 0; index < 42; index += 1) {
    const onRight = index % 2 === 0;
    const x = onRight ? width - 28 - ((index * 37) % 150) : 22 + ((index * 53) % 150);
    const y = 28 + ((index * 97) % Math.max(120, height - 100));
    context.save();
    context.translate(x, y); context.rotate((index % 7) * .34);
    context.fillStyle = colors[index % colors.length];
    if (index % 3 === 0) {
      context.beginPath(); context.arc(0, 0, 6 + index % 5, 0, Math.PI * 2); context.fill();
    } else context.fillRect(-8, -4, 16, 8);
    context.restore();
  }
}

async function multiplePotmImageFile(match, when, players, voteCount) {
  const rows = Math.ceil(players.length / 2);
  const canvasHeight = Math.max(1350, 330 + rows * 400 + 170);
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 1080, canvasHeight);
  gradient.addColorStop(0, "#061724"); gradient.addColorStop(1, "#0e536b");
  context.fillStyle = gradient; context.fillRect(0, 0, 1080, canvasHeight);
  context.strokeStyle = "rgba(114,215,250,.28)"; context.lineWidth = 4;
  context.beginPath(); context.arc(920, 150, 230, 0, Math.PI * 2); context.stroke();
  drawPotmCelebration(context, 1080, canvasHeight);

  context.fillStyle = "#72d7fa"; context.font = "900 28px Arial";
  context.fillText("MANOR LAKES FC", 60, 72);
  context.fillStyle = "#ffffff"; context.font = "900 54px Arial";
  context.fillText("🏆 PLAYERS OF THE MATCH 🏆", 60, 145);
  context.fillStyle = "#bed2dc"; context.font = "700 25px Arial";
  context.fillText(`${match.title} · ${when}`, 60, 205, 950);
  context.fillStyle = "#ffe16a"; context.font = "900 22px Arial";
  context.fillText("🎉  SHARED GLORY  ·  CHOSEN BY THE PLAYERS  🎉", 60, 246, 950);

  const portraits = await Promise.all(players.map((player) => loadCanvasImage(player.photoUrl)));
  const gridTop = 285;
  const footerTop = canvasHeight - 150;
  const rowGap = 24;
  const cardHeight = (footerTop - gridTop - rowGap * (rows - 1)) / rows;
  const cardWidth = 474;
  players.forEach((player, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 52 + column * 502;
    const y = gridTop + row * (cardHeight + rowGap);
    const portraitRadius = Math.max(78, Math.min(players.length <= 2 ? 205 : 120, (cardHeight - 185) / 2));
    const portraitX = x + cardWidth / 2;
    const portraitY = y + 32 + portraitRadius;
    const portrait = portraits[index];

    context.fillStyle = "rgba(3,20,32,.82)"; context.fillRect(x, y, cardWidth, cardHeight);
    context.fillStyle = "#ffe16a"; context.fillRect(x, y, cardWidth, 9);
    context.save(); context.beginPath(); context.arc(portraitX, portraitY, portraitRadius, 0, Math.PI * 2); context.clip();
    if (portrait) {
      const diameter = portraitRadius * 2;
      const scale = Math.max(diameter / portrait.width, diameter / portrait.height);
      context.drawImage(portrait, portraitX - portrait.width * scale / 2, portraitY - portrait.height * scale / 2, portrait.width * scale, portrait.height * scale);
    } else {
      context.fillStyle = "#12384a"; context.fillRect(portraitX - portraitRadius, portraitY - portraitRadius, portraitRadius * 2, portraitRadius * 2);
      context.fillStyle = "#ffffff"; context.font = `900 ${Math.round(portraitRadius * .65)}px Arial`; context.textAlign = "center";
      context.fillText(initials(player.playerName), portraitX, portraitY + Math.round(portraitRadius * .22)); context.textAlign = "left";
    }
    context.restore();
    context.strokeStyle = "#ffe16a"; context.lineWidth = 9; context.beginPath(); context.arc(portraitX, portraitY, portraitRadius, 0, Math.PI * 2); context.stroke();

    context.textAlign = "center";
    const nameY = portraitY + portraitRadius + Math.min(54, Math.max(38, cardHeight * .08));
    context.fillStyle = "#ffffff"; context.font = `900 ${players.length <= 2 ? 45 : 36}px Arial`;
    context.fillText(fitCanvasLabel(context, player.playerName, cardWidth - 44), portraitX, nameY);
    context.fillStyle = "#bed2dc"; context.font = `800 ${players.length <= 2 ? 23 : 19}px Arial`;
    const rating = Number(player.ratingCount || 0) ? Number(player.rating).toFixed(1) : "—";
    if (players.length <= 2) {
      context.fillStyle = "#ffe16a"; context.font = "900 21px Arial";
      context.fillText("🎉  POTM WINNER  🎉", portraitX, nameY + 39);
      context.fillStyle = "#bed2dc"; context.font = "800 23px Arial";
      context.fillText(`🗳️ ${voteCount}  ·  🥾 ${Number(player.goals || 0)} GOALS  ·  🎯 ${Number(player.assists || 0)} ASSISTS`, portraitX, y + cardHeight - 62, cardWidth - 30);
      context.fillText(`⭐ ${rating} RATING`, portraitX, y + cardHeight - 27);
    } else {
      context.fillText(`🗳️ ${voteCount}  ·  🥾 ${Number(player.goals || 0)}  ·  🎯 ${Number(player.assists || 0)}  ·  ⭐ ${rating}`, portraitX, y + cardHeight - 29, cardWidth - 30);
    }
    context.textAlign = "left";
  });

  context.fillStyle = "#ffffff"; context.font = "900 34px Arial"; context.textAlign = "center";
  context.fillText(`${match.teamHomeName || "Home"} ${match.scoreHome} – ${match.scoreAway} ${match.teamAwayName || "Away"}`, 540, canvasHeight - 100, 940);
  context.fillStyle = "#bed2dc"; context.font = "700 22px Arial";
  context.fillText("Voted by the players · Manor Lakes FC", 540, canvasHeight - 45);
  context.textAlign = "left";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `mlfc-potm-${match.publicCode}.png`, { type: "image/png" }) : null;
}

async function potmImageFile(match, when, players, voteCount) {
  const winners = (Array.isArray(players) ? players : [players]).filter((player) => player?.playerName);
  if (!winners.length) return null;
  if (winners.length > 1) return multiplePotmImageFile(match, when, winners, voteCount);
  const player = winners[0];
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0,0,1080,1350);
  gradient.addColorStop(0,"#061724"); gradient.addColorStop(1,"#0e536b");
  context.fillStyle=gradient; context.fillRect(0,0,1080,1350);
  drawPotmCelebration(context,1080,1350);
  context.strokeStyle="rgba(114,215,250,.28)"; context.lineWidth=4;
  context.beginPath(); context.arc(890,220,260,0,Math.PI*2); context.stroke();
  const portrait=await loadCanvasImage(player.photoUrl);
  context.save(); context.beginPath(); context.arc(835,315,205,0,Math.PI*2); context.clip();
  if (portrait) {
    const scale=Math.max(410/portrait.width,410/portrait.height);
    context.drawImage(portrait,835-portrait.width*scale/2,315-portrait.height*scale/2,portrait.width*scale,portrait.height*scale);
  } else {
    context.fillStyle="#12384a";context.fillRect(630,110,410,410);
    context.fillStyle="#ffffff";context.font="900 110px Arial";context.textAlign="center";context.fillText(initials(player.playerName),835,352);context.textAlign="left";
  }
  context.restore(); context.strokeStyle="#ffe16a"; context.lineWidth=12; context.beginPath(); context.arc(835,315,205,0,Math.PI*2); context.stroke();
  context.fillStyle="#72d7fa"; context.font="900 28px Arial";
  context.fillText("MANOR LAKES FC",70,90);
  context.fillStyle="#ffffff"; context.font="900 48px Arial";
  context.fillText("PLAYER OF THE MATCH",70,175);
  context.fillStyle="#ffe16a"; context.font="900 150px Arial";
  context.fillText("🎉 🏆 🎊",70,390,500);
  context.fillStyle="#ffffff"; context.font="900 76px Arial";
  wrapCanvasText(context,player.playerName,900).slice(0,2).forEach((line,index)=>context.fillText(line,70,510+index*82));
  context.fillStyle="#bed2dc"; context.font="700 28px Arial";
  context.fillText(`${match.title} · ${when}`,70,705);
  const stats=[
    [String(voteCount),`🗳️ ${voteCount===1?"VOTE":"VOTES"}`],
    [String(Number(player.goals||0)),"🥾 GOALS"],
    [String(Number(player.assists||0)),"🎯 ASSISTS"],
    [Number(player.ratingCount||0)?Number(player.rating).toFixed(1):"—","⭐ RATING"],
  ];
  stats.forEach(([value,label],index)=>{
    const x=70+index*235;
    context.fillStyle="rgba(3,20,32,.72)"; context.fillRect(x,770,210,230);
    context.fillStyle="#ffffff"; context.font="900 84px Arial"; context.fillText(value,x+22,875);
    context.fillStyle="#72d7fa"; context.font="900 26px Arial"; context.fillText(label,x+22,952);
  });
  context.fillStyle="#ffffff"; context.font="900 38px Arial";
  context.fillText(`${match.teamHomeName || "Home"} ${match.scoreHome} – ${match.scoreAway} ${match.teamAwayName || "Away"}`,70,1090);
  context.fillStyle="#bed2dc"; context.font="700 24px Arial";
  context.fillText("Voted by the players · Manor Lakes FC",70,1270);
  const blob=await new Promise((resolve)=>canvas.toBlob(resolve,"image/png"));
  return blob ? new File([blob],`mlfc-potm-${match.publicCode}.png`,{type:"image/png"}) : null;
}

async function sharePotm(match, when, players, voteCount) {
  const winners=(Array.isArray(players)?players:[players]).filter((player)=>player?.playerName);
  const file=await potmImageFile(match,when,winners,voteCount);
  if (!file) throw new Error("Could not create POTM image");
  const winnerNames=winners.map((player)=>player.playerName);
  const namesLabel=winnerNames.length===1?winnerNames[0]:winnerNames.length===2?winnerNames.join(" & "):`${winnerNames.slice(0,-1).join(", ")} & ${winnerNames[winnerNames.length-1]}`;
  const statLines=winners.map((player)=>`• ${player.playerName} — ${Number(player.goals||0)} goals · ${Number(player.assists||0)} assists · ${Number(player.ratingCount||0)?Number(player.rating).toFixed(1):"—"} rating`).join("\n");
  const caption=`🏆 ${winners.length===1?"Player":"Players"} of the Match: ${namesLabel}\n${voteCount} vote${voteCount===1?"":"s"}${winners.length>1?" each":""}\n${statLines}\n\n${matchLink(match.publicCode)}`;
  if (navigator.share && navigator.canShare?.({files:[file]})) {
    await navigator.share({title:`${match.title} · ${winners.length===1?"Player":"Players"} of the Match`,text:caption,files:[file]});
    return "image";
  }
  const url=URL.createObjectURL(file); const link=document.createElement("a");
  link.href=url; link.download=file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000); waOpenPrefill(caption); return "download";
}

async function votingParticipationImageFile(match, voted, pending) {
  const columnsFor = (list) => list.length > 12 ? 2 : 1;
  const votedColumns = columnsFor(voted);
  const pendingColumns = columnsFor(pending);
  const visibleRows = Math.max(
    Math.ceil(voted.length / votedColumns),
    Math.ceil(pending.length / pendingColumns),
    1,
  );
  const canvasHeight = Math.max(1350, 515 + visibleRows * 62);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 1080, canvasHeight);
  gradient.addColorStop(0, "#061724");
  gradient.addColorStop(1, "#0d4058");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, canvasHeight);
  context.strokeStyle = "rgba(114,215,250,.22)";
  context.lineWidth = 4;
  context.beginPath(); context.arc(930, 170, 240, 0, Math.PI * 2); context.stroke();
  context.fillStyle = "#72d7fa";
  context.font = "900 25px Arial";
  context.fillText("MANOR LAKES FC · POTM VOTING", 60, 70);
  context.fillStyle = "#ffffff";
  context.font = "900 52px Arial";
  wrapCanvasText(context, match.title || "Match voting", 900).slice(0, 2).forEach((line, index) => context.fillText(line.toUpperCase(), 60, 145 + index * 58));
  context.fillStyle = "#bed2dc";
  context.font = "700 24px Arial";
  context.fillText(`${voted.length} of ${voted.length + pending.length} players voted`, 60, 285);

  const players = [...voted, ...pending];
  const portraits = new Map(await Promise.all(players.map(async (player) => [
    String(player.playerName || "").toLowerCase(),
    await loadCanvasImage(player.photoUrl),
  ])));
  const drawColumn = (title, list, x, color, mark) => {
    const width = 460;
    const innerColumns = columnsFor(list);
    const rowsPerColumn = Math.ceil(list.length / innerColumns) || 1;
    const innerWidth = (width - 40) / innerColumns;
    context.fillStyle = "rgba(3,20,32,.68)";
    context.fillRect(x, 340, width, canvasHeight - 450);
    context.fillStyle = color;
    context.font = "900 28px Arial";
    context.fillText(`${title.toUpperCase()} · ${list.length}`, x + 28, 395);
    list.forEach((player, index) => {
      const columnIndex = Math.floor(index / rowsPerColumn);
      const rowIndex = index % rowsPerColumn;
      const itemX = x + 22 + columnIndex * innerWidth;
      const centerY = 455 + rowIndex * 62;
      const portraitRadius = innerColumns === 1 ? 24 : 20;
      const portraitX = itemX + portraitRadius;
      const portrait = portraits.get(String(player.playerName || "").toLowerCase());
      context.save();
      context.beginPath(); context.arc(portraitX, centerY, portraitRadius, 0, Math.PI * 2); context.clip();
      if (portrait) {
        const diameter = portraitRadius * 2;
        const scale = Math.max(diameter / portrait.width, diameter / portrait.height);
        context.drawImage(portrait, portraitX - portrait.width * scale / 2, centerY - portrait.height * scale / 2, portrait.width * scale, portrait.height * scale);
      } else {
        context.fillStyle = color; context.fillRect(portraitX - portraitRadius, centerY - portraitRadius, portraitRadius * 2, portraitRadius * 2);
        context.fillStyle = "#08283b"; context.font = `900 ${innerColumns === 1 ? 15 : 12}px Arial`; context.textAlign = "center";
        context.fillText(initials(player.playerName), portraitX, centerY + 5); context.textAlign = "left";
      }
      context.restore();
      context.strokeStyle = color; context.lineWidth = 3; context.beginPath(); context.arc(portraitX, centerY, portraitRadius, 0, Math.PI * 2); context.stroke();
      const textX = portraitX + portraitRadius + 10;
      const textWidth = innerWidth - portraitRadius * 2 - 18;
      context.fillStyle = "#ffffff"; context.font = `850 ${innerColumns === 1 ? 20 : 15}px Arial`;
      context.fillText(fitCanvasLabel(context, player.playerName, textWidth), textX, centerY - 2);
      context.fillStyle = "#9fb8c5"; context.font = `800 ${innerColumns === 1 ? 14 : 11}px Arial`;
      context.fillText(`${mark}  ${String(player.team || "PLAYER").toUpperCase()}`, textX, centerY + 18);
    });
  };
  drawColumn("Voted", voted, 60, "#55d99a", "✓");
  drawColumn("Not voted", pending, 560, "#f0c94b", "!");
  context.fillStyle = "#bed2dc";
  context.font = "700 20px Arial";
  context.fillText("Participation status · Individual votes remain private", 60, canvasHeight - 45);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `mlfc-potm-voting-${match.publicCode}.png`, { type: "image/png" }) : null;
}

async function shareVotingParticipation(match, voted, pending) {
  const file = await votingParticipationImageFile(match, voted, pending);
  if (!file) throw new Error("Could not create voting participation image");
  const votingUrl = `${matchLink(match.publicCode)}&focus=potm`;
  const caption = `🏆 POTM voting is open for ${match.title || "our match"}.\n${voted.length} of ${voted.length + pending.length} players have voted.\n\nTap to vote:\n${votingUrl}`;
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: `${match.title} · POTM voting`, text: caption, files: [file] });
    return "image";
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  waOpenPrefill(caption);
  return "download";
}

function sameNames(a, b) {
  return uniqueSorted(a).map(x => x.toLowerCase()).join("|") === uniqueSorted(b).map(x => x.toLowerCase()).join("|");
}

function setDisabled(btn, disabled, busyText) {
  if (!btn) return;
  btn.disabled = disabled;
  if (disabled && busyText) {
    if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
    btn.textContent = busyText;
  } else if (!disabled && btn.dataset.origText) {
    btn.textContent = btn.dataset.origText;
    delete btn.dataset.origText;
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
  const age = Date.now() - Number(cached?.ts || 0);
  if (!force && Array.isArray(cached?.users) && age <= USERS_CACHE_MAX_AGE_MS) return cached.users;
  const res = await API.adminUsers();
  if (!res?.ok) {
    // Keep the last roster usable when the admin is temporarily offline.
    if (Array.isArray(cached?.users)) return cached.users;
    throw new Error(res?.error || "Failed to load users");
  }
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
  const focus = (query.get("focus") || "").toLowerCase();
  return { view, code, prev, focus };
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
    `<option value="${escapeHtml(s.seasonId)}" ${s.seasonId === selected ? "selected" : ""}>${escapeHtml(s.name)}</option>`
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
      <button class="btn whatsappBtn" id="shareSeasonLeaders" type="button" style="margin-top:10px">Share top 20 FC Cards</button>
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
  const potmVotingStarted = String(m.potmOpenedAt || "").trim() !== "";
  const potmVotingClosed = Number(m.potmVotingClosed || 0) === 1 || isCompleted;
  const potmVoteCount = Number(m.potmVoteCount || 0);
  const ratingStarted = Number(m.ratingCount || 0) > 0;
  const kickOff = new Date(`${String(m.date || "").slice(0, 10)}T${String(m.time || "00:00").slice(0, 5)}:00`).getTime();
  const hasStarted = Number.isFinite(kickOff) && kickOff <= Date.now();
  const scoreStarted = String(m.scoreHome ?? "").trim() !== "" || String(m.scoreAway ?? "").trim() !== "";
  const progress = isCompleted
    ? "Match completed"
    : !hasStarted
      ? "Upcoming match"
      : !scoreStarted
        ? "Match started · scores pending"
        : !hasBothScores
          ? "Score update in progress"
          : potmVotingClosed
            ? `Voting completed · ${ratingStarted ? "ratings in progress" : "ratings pending"}`
            : potmVotingStarted
              ? ratingStarted ? "Voting and ratings in progress" : "Voting open · ratings pending"
              : ratingStarted ? "Ratings in progress · voting pending" : "Scores updated · voting and ratings pending";
  const progressTone = isCompleted ? "complete" : hasStarted ? "progress" : "future";
  const stream = streamState(m);

  // If locked/completed: disable Manage + scoring.
  const disableManage = isEditLocked;

  const when = formatHumanDateTime(m.date, m.time);

  return `
    <article class="adminMatchRow adminMatchRow--${progressTone}">
      <div class="adminMatchRow__head">
        <div class="adminMatchRow__main">
          <div class="adminMatchRow__title">${escapeHtml(m.title)}</div>
          <div class="adminMatchRow__meta">${escapeHtml(when)}<span aria-hidden="true">·</span>${escapeHtml(m.type)}</div>
          <div class="adminMatchRow__progress"><span aria-hidden="true"></span>${escapeHtml(progress)}</div>
          ${potmVotingClosed && !isCompleted ? `<div class="adminMatchRow__votingComplete">✓ Voting completed</div>` : ""}
        </div>
        <div class="adminMatchRow__badges">
          ${stream === "LIVE" ? `<span class="badge badge--live"><span class="liveSignal" aria-hidden="true"></span>LIVE</span>` : stream === "READY" ? `<span class="badge badge--streamReady">STREAM READY</span>` : stream === "ENDED" ? `<span class="badge">REPLAY</span>` : ""}
          <span class="badge${status === "OPEN" ? " badge--good" : ""}">${escapeHtml(m.status)}</span>
          ${locked ? `<span class="badge badge--bad">LOCKED</span>` : ""}
        </div>
      </div>

      <div class="adminMatchRow__actions">
        <button class="btn gray" data-manage="${escapeHtml(m.publicCode)}" ${disableManage ? "disabled" : ""}>Manage</button>
        <button class="btn ${stream === "LIVE" ? "streamLiveButton" : "gray"}" data-stream="${escapeHtml(m.publicCode)}">${stream === "LIVE" ? "Streaming" : stream === "READY" ? "Stream ready" : stream === "ENDED" ? "Replay" : "Stream"}</button>
        ${(!isCompleted && !locked) || potmVotingStarted ? `<button class="btn ${potmVotingClosed ? "whatsappBtn" : hasStarted ? "good" : "gray"}" data-manage-voting="${escapeHtml(m.matchId)}" ${potmVotingStarted || (hasStarted && !isEditLocked) ? "" : "disabled"} title="${potmVotingClosed ? "View and share the POTM result" : hasStarted ? "Manage POTM voting" : "Available after kick-off"}">${potmVotingClosed ? "POTM result" : potmVotingStarted ? "Manage voting" : "Voting"}</button>` : ""}
        <button class="btn primary" data-score="${escapeHtml(m.publicCode)}" ${isEditLocked || !hasStarted ? "disabled" : ""} title="${hasStarted ? "" : "Available after kick-off"}">Score & ratings</button>
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

      <div class="row" style="margin-top:12px;gap:10px;flex-wrap:wrap">
        <button class="btn whatsappBtn" id="shareSeasonLeaders" type="button">Share top 20 FC Cards</button>
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

    <details class="card themeSettings" id="themeSettingsCard">
      <summary style="font-weight:950">Weekly EPL themes</summary>
      <div class="themeSettings__body">
        <div>
          <div class="h1">Match the week</div>
          <p class="small">Automatically colour the app around the best Premier League performance from the previous week.</p>
          <div class="themeSettings__current" id="themeSettingsCurrent">Loading theme status…</div>
        </div>
        <label class="themeSwitch" for="weeklyThemesEnabled">
          <input id="weeklyThemesEnabled" type="checkbox" role="switch" />
          <span aria-hidden="true"></span>
          <b id="weeklyThemesLabel">Themes off</b>
        </label>
      </div>
      <div class="themeSettings__picker">
        <div class="field">
          <label class="field__label" for="weeklyThemeTeam">Choose an EPL team</label>
          <select class="input" id="weeklyThemeTeam">
            ${EPL_THEMES.map((theme) => `<option value="${theme.teamId}">${escapeHtml(theme.name)}</option>`).join("")}
          </select>
        </div>
        <button class="btn primary" id="applyWeeklyTheme" type="button">Apply to everyone</button>
      </div>
      <p class="field__help">A manual choice takes effect immediately and stays active until you change it or the next Monday theme is selected.</p>
      <div class="field__message" id="themeSettingsMessage" role="status" aria-live="polite"></div>
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
  const themeSettings = root.querySelector("#themeSettingsCard");
  const announcement = root.querySelector("#announcementCard");
  if (header) header.style.display = display;
  if (seasonMgmt) seasonMgmt.style.display = display;
  if (createMatch) createMatch.style.display = display;
  if (themeSettings) themeSettings.style.display = display;
  if (announcement) announcement.style.display = display;
}

async function bindThemeSettings(root) {
  const card = root.querySelector("#themeSettingsCard");
  const toggle = root.querySelector("#weeklyThemesEnabled");
  const label = root.querySelector("#weeklyThemesLabel");
  const current = root.querySelector("#themeSettingsCurrent");
  const message = root.querySelector("#themeSettingsMessage");
  const teamSelect = root.querySelector("#weeklyThemeTeam");
  const applyButton = root.querySelector("#applyWeeklyTheme");
  if (!card || !toggle || !label || !current || !message || !teamSelect || !applyButton) return;

  const paint = (settings) => {
    toggle.checked = Boolean(settings?.enabled);
    label.textContent = toggle.checked ? "Themes on" : "Themes off";
    const theme = settings?.theme;
    if (theme?.teamId && EPL_THEMES.some((item) => item.teamId === Number(theme.teamId))) teamSelect.value = String(theme.teamId);
    current.innerHTML = theme
      ? `<i aria-hidden="true"></i><span><b>${escapeHtml(theme.teamName)}</b><small>${escapeHtml(theme.matchLabel || "Current weekly theme")}</small></span>`
      : `<span><b>Manor Lakes theme</b><small>${settings?.apiConfigured ? "Waiting for the next completed EPL week." : "Add the API-Football secret to start automatic selection."}</small></span>`;
  };

  const loaded = await API.adminThemeSettings().catch(() => null);
  if (!loaded?.ok) {
    current.textContent = loaded?.error || "Theme settings could not be loaded.";
    toggle.disabled = true;
    return;
  }
  paint(loaded);

  toggle.onchange = async () => {
    toggle.disabled = true;
    message.textContent = "Saving…";
    const result = await API.adminSetThemeEnabled(toggle.checked).catch(() => null);
    if (!result?.ok) {
      toggle.checked = !toggle.checked;
      message.textContent = result?.error || "Theme setting could not be saved.";
      toastError(message.textContent);
    } else {
      paint(result);
      message.textContent = toggle.checked ? "Weekly EPL themes are on." : "Weekly EPL themes are off.";
      toastSuccess(message.textContent);
      window.dispatchEvent(new CustomEvent("mlfc:theme-setting-changed", { detail: result }));
    }
    toggle.disabled = false;
  };

  applyButton.onclick = async () => {
    applyButton.disabled = true;
    const previous = applyButton.textContent;
    applyButton.textContent = "Applying…";
    message.textContent = "Updating the theme for everyone…";
    const result = await API.adminSetWeeklyTheme(Number(teamSelect.value)).catch(() => null);
    if (!result?.ok) {
      message.textContent = result?.error || "The selected theme could not be applied.";
      toastError(message.textContent);
    } else {
      paint(result);
      message.textContent = `${result.theme?.teamName || "Selected"} theme is now active for everyone.`;
      toastSuccess(message.textContent);
      window.dispatchEvent(new CustomEvent("mlfc:theme-setting-changed", { detail: result }));
    }
    applyButton.textContent = previous;
    applyButton.disabled = false;
  };
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

async function loadAdminMatch(code) {
  const detail = await API.getPublicMatch(code);
  if (!detail?.ok || !detail.match?.matchId) return detail;
  const participation = await API.adminPotmStatus(detail.match.matchId);
  return participation?.ok ? { ...detail, potmAdminStatus: participation } : detail;
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
  const shareLeadersBtn=root.querySelector("#shareSeasonLeaders");
  if(shareLeadersBtn) shareLeadersBtn.onclick=()=>shareLeaders(root,shareLeadersBtn);

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
              <div class="row" style="gap:8px; flex-wrap:nowrap; flex-shrink:0">
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
    area.innerHTML = `<div class="small">${escapeHtml(String(e?.message||e))}</div>`;
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
            const playerStatus = String(u.playerStatus || "ACTIVE").toUpperCase();
            return `
              <article class="userRow" role="listitem">
                <span class="userRow__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
                <div class="userRow__identity">
                  <strong>${escapeHtml(u.name)}${playerStatus === "INJURED" ? ` <span title="Injured" aria-label="Injured">🩹</span>` : ""}${isSelf ? ` <span class="userRow__you">You</span>` : ""}</strong>
                  <span>${escapeHtml(u.phone || "No phone number")}</span>
                </div>
                <span class="userRole ${isAdmin ? "userRole--admin" : ""}">${isAdmin ? "Admin" : "Member"}</span>
                <div class="usersActions">
                  <label class="userStatus"><span class="visuallyHidden">Status for ${escapeHtml(u.name)}</span><select class="userStatus__select" data-user-status="${encodeURIComponent(u.name)}" aria-label="Status for ${escapeHtml(u.name)}">${["ACTIVE","INJURED","UNAVAILABLE","INACTIVE"].map(status => `<option value="${status}" ${status === playerStatus ? "selected" : ""}>${status[0] + status.slice(1).toLowerCase()}</option>`).join("")}</select></label>
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
      const pwd = prompt(`Enter a new password for ${name}`)?.trim();
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

  results.onchange = async (event) => {
    const select = event.target.closest("[data-user-status]");
    if (!select) return;
    const name = decodeURIComponent(select.getAttribute("data-user-status") || "");
    const current = users.find(user => user.name === name);
    const previous = String(current?.playerStatus || "ACTIVE").toUpperCase();
    const next = String(select.value || "").toUpperCase();
    if (next === previous) return;
    select.disabled = true;
    const res = await API.adminSetStatus(name, next).catch(() => null);
    if (!res?.ok) {
      select.value = previous;
      select.disabled = false;
      return toastError(res?.error || "Could not update player status");
    }
    users = users.map(user => user.name === name ? { ...user, playerStatus: res.playerStatus } : user);
    lsSet(LS_USERS_CACHE, { ts: Date.now(), users });
    toastSuccess(`${name} is now ${res.playerStatus[0] + res.playerStatus.slice(1).toLowerCase()}`);
    renderResults();
  };

  renderResults();
}

function bindUserMgmt(root, routeToken) {
  if (!stillOnAdmin(routeToken)) return;
  renderUsers(root).catch(() => {});
}

async function openVotingManager(root, view, match) {
  document.querySelector("#adminVotingDialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "adminVotingDialog";
  dialog.className = "adminVotingDialog";
  dialog.innerHTML = `<div class="adminVotingDialog__loading">Loading voting status…</div>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove(), { once: true });

  const detail = await loadAdminMatch(match.publicCode);
  if (!detail?.ok) {
    dialog.innerHTML = `<div class="adminVotingDialog__panel"><button class="adminVotingDialog__close" type="button">×</button><div class="h1">Voting unavailable</div><div class="small">${escapeHtml(detail?.error || "Could not load voting status.")}</div></div>`;
    dialog.querySelector(".adminVotingDialog__close").onclick = () => dialog.close();
    return;
  }
  const potm = detail.potm || {};
  const participation = detail.potmAdminStatus || {};
  const voted = Array.isArray(participation.voted) ? participation.voted : [];
  const pending = Array.isArray(participation.pending) ? participation.pending : [];
  const started = Boolean(String(potm.openedAt || ""));
  const closed = started && Boolean(potm.closed);
  const hasScores = String(detail.match?.scoreHome ?? "").trim() !== "" && String(detail.match?.scoreAway ?? "").trim() !== "";
  const results = Array.isArray(potm.results) ? potm.results : [];
  const candidates = Array.isArray(potm.candidates) ? potm.candidates : [];
  const voteCount = Number(potm.voteCount || 0);
  const topVotes = Math.max(0, ...results.map((row) => Number(row.voteCount || 0)));
  const leaders = results.filter((row) => topVotes > 0 && Number(row.voteCount || 0) === topVotes);
  const winners = leaders.map((leader) =>
    (potm.candidates || []).find((row) => String(row.playerName || "").toLowerCase() === String(leader.candidateName || "").toLowerCase())
      || { playerName: leader.candidateName }
  ).filter((player) => player.playerName);
  const winnerNames = winners.map((player) => player.playerName);
  const winnerLabel = winnerNames.length === 1
    ? winnerNames[0]
    : winnerNames.length === 2
      ? winnerNames.join(" and ")
      : `${winnerNames.slice(0, -1).join(", ")}, and ${winnerNames[winnerNames.length - 1]}`;
  const matchStatus = String(detail.match?.status || "").toUpperCase();
  const resultLocked = isTrueFlag(detail.match?.ratingsLocked) || matchStatus === "CLOSED" || matchStatus === "COMPLETED";
  const canAdminSelect = started && !resultLocked && voteCount === 0 && candidates.length > 0;
  dialog.innerHTML = `<div class="adminVotingDialog__panel">
    <header><div><div class="stepEyebrow">Player of the Match</div><div class="h1">${escapeHtml(match.title || "Voting")}</div><div class="small">${started ? `${voted.length} of ${voted.length + pending.length} players voted` : hasScores ? "Ready to open voting" : "Add the final score when starting voting"}</div></div><button class="adminVotingDialog__close" type="button" aria-label="Close">×</button></header>
    ${started ? `<div class="potmParticipation">
      <section><header><b>Voted</b><span>${voted.length}</span></header><div class="potmParticipation__players">${voted.length ? voted.map((row) => `<span class="potmParticipation__player potmParticipation__player--done"><i aria-hidden="true">✓</i>${escapeHtml(row.playerName)}<small>${escapeHtml(row.team || "")}</small></span>`).join("") : `<span class="small">No votes yet.</span>`}</div></section>
      <section><header><b>Not voted</b><span>${pending.length}</span></header><div class="potmParticipation__players">${pending.length ? pending.map((row) => `<span class="potmParticipation__player"><i aria-hidden="true">!</i>${escapeHtml(row.playerName)}<small>${escapeHtml(row.team || "")}</small></span>`).join("") : `<span class="small">Everyone has voted.</span>`}</div></section>
    </div>` : `<div class="adminVotingDialog__empty"><b>Voting has not started</b><span>Opening this popup does not notify players. ${hasScores ? "Open voting, then use Send notification when you are ready." : "Enter both scores to open voting automatically and notify the match roster."}</span></div>`}
    ${canAdminSelect ? `<div class="field"><label class="field__label" for="adminPotmPlayer">No votes received — select POTM</label><select class="input" id="adminPotmPlayer"><option value="">Choose a player</option>${candidates.map((candidate) => `<option value="${escapeHtml(candidate.playerName)}">${escapeHtml(candidate.playerName)}</option>`).join("")}</select></div>` : ""}
    <div class="adminVotingDialog__actions">
      ${!started && hasScores ? `<button class="btn good" type="button" data-vote-start>Open voting</button>` : ""}
      ${!started && !hasScores ? `<button class="btn good" type="button" data-vote-score>Enter scores</button>` : ""}
      ${started && !closed && pending.length ? `<button class="btn primary" type="button" data-vote-remind>Send notification</button>` : ""}
      ${canAdminSelect ? `<button class="btn primary" type="button" data-potm-select>Select POTM</button>` : ""}
      ${started && !closed ? `<button class="btn whatsappBtn" type="button" data-vote-share>Share voting link</button>` : ""}
      ${started && !closed ? `<button class="btn gray" type="button" data-vote-close>Close voting</button><button class="btn dangerGhost" type="button" data-vote-cancel>Cancel voting</button>` : ""}
      ${closed && winners.length ? `<button class="btn whatsappBtn" type="button" data-potm-share>Share POTM${winners.length > 1 ? " winners" : ""}</button>` : ""}
      ${closed && !resultLocked ? `<button class="btn primary" type="button" data-vote-reopen>Reopen voting</button>` : ""}
    </div>
    <div class="small" data-vote-status role="status" aria-live="polite">${closed ? winners.length ? `${escapeHtml(winnerLabel)} ${winners.length === 1 ? "won" : "tied"} with ${topVotes} ${topVotes === 1 ? "vote" : "votes"}${winners.length > 1 ? " each" : ""}.` : "Voting closed without any votes." : started ? "Individual choices remain private until voting closes." : ""}</div>
  </div>`;
  dialog.querySelector(".adminVotingDialog__close").onclick = () => dialog.close();

  const refreshList = ({ reopenVoting = false } = {}) => {
    clearPublicMatchDetailCache(match.publicCode);
    clearManageCache(match.publicCode);
    lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });
    const updatedMatch = MEM.matches.find((item) => String(item.matchId) === String(match.matchId)) || match;
    dialog.close();
    renderListView(root, view);
    if (reopenVoting) {
      openVotingManager(root, view, updatedMatch).catch(() => toastError("Could not load the POTM result."));
    }
  };
  dialog.querySelector("[data-vote-start]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setDisabled(button, true, "Opening…");
    const out = await API.adminStartPotmVoting(match.matchId);
    if (!out?.ok) { setDisabled(button, false); return toastError(out?.error || "Voting could not be started."); }
    MEM.matches = MEM.matches.map((item) => String(item.matchId) === String(match.matchId) ? { ...item, scoreHome: match.scoreHome, scoreAway: match.scoreAway, potmOpenedAt: out.openedAt, potmClosedAt: "", potmVotingClosed: 0 } : item);
    toastSuccess("Voting opened. No notifications sent yet.");
    refreshList({ reopenVoting: true });
  });
  dialog.querySelector("[data-vote-score]")?.addEventListener("click", () => {
    dialog.close();
    location.hash = `#/captain?code=${encodeURIComponent(match.publicCode)}&src=admin`;
  });
  dialog.querySelector("[data-vote-remind]")?.addEventListener("click", async (event) => {
    if (!confirm(`Send the voting notification to ${pending.length} ${pending.length === 1 ? "player" : "players"} who have not voted?`)) return;
    const button = event.currentTarget;
    setDisabled(button, true, "Sending…");
    const out = await API.adminRemindPotmPending(match.matchId);
    setDisabled(button, false);
    if (!out?.ok) return toastError(out?.error || "Reminders could not be sent.");
    const message = `Notification sent to ${Number(out.notified || 0)} ${Number(out.notified || 0) === 1 ? "player" : "players"}.`;
    toastSuccess(message, "Notification sent");
  });
  dialog.querySelector("[data-potm-select]")?.addEventListener("click", async (event) => {
    const candidateName = String(dialog.querySelector("#adminPotmPlayer")?.value || "").trim();
    if (!candidateName) return toastWarn("Choose a player for POTM.");
    if (!confirm(`Select ${candidateName} as Player of the Match and close voting?`)) return;
    const button = event.currentTarget;
    setDisabled(button, true, "Selecting…");
    const out = await API.adminSelectPotm(match.matchId, candidateName);
    if (!out?.ok) { setDisabled(button, false); return toastError(out?.error || "POTM could not be selected."); }
    MEM.matches = MEM.matches.map((item) => String(item.matchId) === String(match.matchId) ? { ...item, potmClosedAt: out.closedAt, potmVotingClosed: 1, potmVoteCount: 1 } : item);
    toastSuccess(`${candidateName} selected as POTM.`);
    refreshList({ reopenVoting: true });
  });
  dialog.querySelector("[data-vote-share]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setDisabled(button, true, "Creating image…");
    try {
      const mode = await shareVotingParticipation(match, voted, pending);
      toastInfo(mode === "image" ? "Choose WhatsApp to share the voting card." : "Voting card downloaded. Attach it in WhatsApp.");
    } catch (error) {
      if (error?.name !== "AbortError") toastError(error?.message || "Voting card could not be shared.");
    } finally {
      setDisabled(button, false);
    }
  });
  dialog.querySelector("[data-vote-close]")?.addEventListener("click", async (event) => {
    if (!confirm(`Close POTM voting for “${match.title}”? Votes will be final.`)) return;
    const button = event.currentTarget;
    setDisabled(button, true, "Closing…");
    const out = await API.adminClosePotmVoting(match.matchId);
    if (!out?.ok) { setDisabled(button, false); return toastError(out?.error || "Voting could not be closed."); }
    MEM.matches = MEM.matches.map((item) => String(item.matchId) === String(match.matchId) ? { ...item, potmClosedAt: out.closedAt, potmVotingClosed: 1, potmVoteCount: Number(out.potm?.voteCount || 0) } : item);
    toastSuccess("Voting completed and closed.");
    refreshList({ reopenVoting: true });
  });
  dialog.querySelector("[data-potm-share]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setDisabled(button, true, "Creating image…");
    try {
      const mode = await sharePotm(detail.match, formatHumanDateTime(detail.match.date, detail.match.time), winners, topVotes);
      toastInfo(mode === "image" ? "Choose WhatsApp to share the POTM result." : "POTM image downloaded. Attach it in WhatsApp.");
    } catch (error) {
      if (error?.name !== "AbortError") toastError(error?.message || "POTM result could not be shared.");
    } finally {
      setDisabled(button, false);
    }
  });
  dialog.querySelector("[data-vote-reopen]")?.addEventListener("click", async (event) => {
    if (!confirm(`Reopen POTM voting for “${match.title}”? Existing votes will be kept and players can vote again.`)) return;
    const button = event.currentTarget;
    setDisabled(button, true, "Reopening…");
    const out = await API.adminReopenPotmVoting(match.matchId);
    if (!out?.ok) { setDisabled(button, false); return toastError(out?.error || "Voting could not be reopened."); }
    MEM.matches = MEM.matches.map((item) => String(item.matchId) === String(match.matchId) ? { ...item, potmClosedAt: "", potmVotingClosed: 0 } : item);
    toastSuccess("Voting reopened. Existing votes were kept.");
    refreshList();
  });
  dialog.querySelector("[data-vote-cancel]")?.addEventListener("click", async (event) => {
    if (!confirm(`Cancel POTM voting for “${match.title}”? Votes already cast will be removed.`)) return;
    const button = event.currentTarget;
    setDisabled(button, true, "Cancelling…");
    const out = await API.adminCancelPotmVoting(match.matchId);
    if (!out?.ok) { setDisabled(button, false); return toastError(out?.error || "Voting could not be cancelled."); }
    MEM.matches = MEM.matches.map((item) => String(item.matchId) === String(match.matchId) ? { ...item, potmOpenedAt: "", potmClosedAt: "", potmVotingClosed: 0, potmVoteCount: 0 } : item);
    toastSuccess("Voting cancelled.");
    refreshList();
  });
}

function updateCachedStreamMatch(match, stream) {
  const updated = {
    ...match,
    streamVideoId: String(stream?.videoId || ""),
    streamStatus: String(stream?.status || "NONE"),
    streamUpdatedAt: String(stream?.updatedAt || ""),
  };
  MEM.matches = (MEM.matches || []).map((item) => String(item.matchId) === String(updated.matchId) ? { ...item, ...updated } : item);
  lsSet(matchesKey(MEM.selectedSeasonId), { ts: now(), matches: MEM.matches });
  clearPublicMatchDetailCache(updated.publicCode);
  clearManageCache(updated.publicCode);
  return updated;
}

function wireStreamControls(container, match, onUpdated) {
  const updateStream = async (command, button, busyText) => {
    const input = container.querySelector("#youtubeStreamUrl");
    const message = container.querySelector("#streamDeskMessage");
    const youtubeUrl = command === "SAVE" ? String(input?.value || "").trim() : "";
    if (command === "SAVE" && !youtubeUrl) {
      if (message) message.textContent = "Paste the public YouTube watch link.";
      input?.focus();
      return;
    }
    setDisabled(button, true, busyText);
    if (message) message.textContent = "";
    try {
      const result = await API.adminUpdateMatchStream(match.matchId, command, youtubeUrl);
      if (!result?.ok) {
        if (message) message.textContent = result?.error || "Could not update the stream.";
        return toastError(result?.error || "Could not update the stream.");
      }
      const updated = updateCachedStreamMatch(match, result.stream || {});
      const notice = command === "SAVE"
        ? "Stream saved. The YouTube player is now on the match page."
        : command === "START"
          ? "Live on MLFC. The home banner is now visible."
          : command === "STOP"
            ? "Live display stopped. The player remains as a replay."
            : "Stream removed from this match.";
      toastSuccess(notice);
      onUpdated(updated);
    } catch (error) {
      if (message) message.textContent = error?.message || "Could not update the stream.";
      toastError(error?.message || "Could not update the stream.");
    } finally {
      setDisabled(button, false);
    }
  };

  container.querySelector("#saveStream")?.addEventListener("click", (event) => updateStream("SAVE", event.currentTarget, "Saving…"));
  container.querySelector("#startStream")?.addEventListener("click", (event) => updateStream("START", event.currentTarget, "Starting…"));
  container.querySelector("#stopStream")?.addEventListener("click", (event) => {
    if (!confirm("Stop showing this match as LIVE in MLFC?\n\nThis does not end the camera broadcast in YouTube. The video will remain on the match page as a replay.")) return;
    updateStream("STOP", event.currentTarget, "Stopping…");
  });
  container.querySelector("#removeStream")?.addEventListener("click", (event) => {
    if (!confirm("Remove the YouTube player from this match?\n\nThis does not delete the video from YouTube.")) return;
    updateStream("REMOVE", event.currentTarget, "Removing…");
  });
}

async function openStreamManager(root, view, match) {
  const dialog = document.createElement("dialog");
  dialog.className = "adminStreamDialog";
  dialog.setAttribute("aria-label", `Stream settings for ${match.title || "match"}`);
  dialog.innerHTML = `<div class="adminStreamDialog__loading">Loading stream settings…</div>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  let current = match;
  try {
    const fresh = await API.getPublicMatch(match.publicCode);
    if (fresh?.ok && fresh.match?.matchId) current = { ...match, ...fresh.match };
  } catch {}
  if (!dialog.isConnected) return;

  const render = (nextMatch) => {
    current = nextMatch;
    dialog.innerHTML = `<div class="adminStreamDialog__panel">
      <header><div><div class="stepEyebrow">${escapeHtml(current.title || "Match")}</div><div class="h1">Stream controls</div></div><button class="adminStreamDialog__close" type="button" aria-label="Close stream controls">×</button></header>
      ${streamDeskHtml(current)}
    </div>`;
    dialog.querySelector(".adminStreamDialog__close")?.addEventListener("click", () => dialog.close());
    wireStreamControls(dialog, current, (updated) => {
      render(updated);
      if (currentHashPath() === "#/admin") renderListView(root, view);
    });
  };
  render(current);
}

function bindListButtons(root, view) {
  root.querySelectorAll('[data-score]:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      const code = btn.getAttribute("data-score");
      location.hash = `#/captain?code=${encodeURIComponent(code)}&src=admin`;
    };
  });

  root.querySelectorAll('[data-manage-voting]:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      const matchId = btn.getAttribute("data-manage-voting");
      const match = (MEM.matches || []).find((item) => String(item.matchId) === String(matchId));
      if (match) openVotingManager(root, view, match).catch(() => toastError("Could not open voting management."));
    };
  });

  root.querySelectorAll("[data-stream]").forEach((btn) => {
    btn.onclick = () => {
      const code = btn.getAttribute("data-stream");
      const match = (MEM.matches || []).find((item) => String(item.publicCode) === String(code));
      if (match) openStreamManager(root, view, match).catch(() => toastError("Could not open stream controls."));
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

  // Lock ratings
  root.querySelectorAll('[data-lock]:not([disabled])').forEach(btn => {
    btn.onclick = async () => {
      const routeToken = window.__mlfcAdminToken;
      if (!stillOnAdmin(routeToken)) return;

      const matchId = btn.getAttribute("data-lock");
      const match = (MEM.matches || []).find(item => String(item.matchId) === String(matchId));
      const potmReady = String(match?.potmOpenedAt || "").trim() !== "" && Number(match?.potmVoteCount || 0) > 0;
      if (!potmReady) {
        toastError("Select Player of the Match before completing this match.");
        if (match) openVotingManager(root, view, match).catch(() => {});
        return;
      }
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
   - Opponent: set captain, publish from Manage, and share separately
   - Internal: compact table (player + Blue/Orange), remove enables buttons again,
              captains chosen via checkbox in team lists,
              Publish teams + Share team sheet buttons after the field,
              Captain links remain available from the Manage screen
   - Admins can close and reopen availability from Manage
   ======================= */

function renderManageUI(root, data, routeToken, { fromCache = true, prevView = "open" } = {}) {
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
  const scoreStarted = String(m.scoreHome ?? "").trim() !== "" || String(m.scoreAway ?? "").trim() !== "";
  const isEditLocked = locked || status === "CLOSED" || isCompleted || scoreStarted;
  const hasBothScores = String(m.scoreHome ?? "").trim() !== "" && String(m.scoreAway ?? "").trim() !== "";
  const potm = data.potm || {};
  const potmStarted = String(potm.openedAt || "").trim() !== "";
  const potmFinal = potmStarted && Boolean(potm.closed);
  const potmResults = Array.isArray(potm.results) ? potm.results : [];
  const potmReady = potmStarted && Number(potm.voteCount || 0) > 0;
  const potmTopVotes = Math.max(0,...potmResults.map((row)=>Number(row.voteCount||0)));
  const potmLeaders = potmResults.filter((row)=>Number(row.voteCount||0)===potmTopVotes && potmTopVotes>0);
  const potmLead = potmLeaders[0];
  const potmPlayer = (potm.candidates || []).find((row)=>String(row.playerName).toLowerCase()===String(potmLead?.candidateName||"").toLowerCase());
  const potmAdminStatus = data.potmAdminStatus || {};
  const potmVoted = Array.isArray(potmAdminStatus.voted) ? potmAdminStatus.voted : [];
  const potmPending = Array.isArray(potmAdminStatus.pending) ? potmAdminStatus.pending : [];

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
  const phaseLabel = locked ? "Completed" : potmFinal ? "POTM published" : potmStarted ? "Voting open" : hasBothScores ? "Score ready" : availabilityLocked ? "Teams & scoring" : "Availability open";

  manageArea.innerHTML = `
    <section class="manageCommand" aria-labelledby="manageMatchTitle">
      <div class="row" style="justify-content:space-between; align-items:flex-start">
        <div style="min-width:0">
          <div class="manageCommand__eyebrow">Matchday control · ${escapeHtml(type)}</div>
          <div class="h1 manageCommand__title" id="manageMatchTitle">${safeTitle}</div>
          <div class="manageCommand__meta">${safeWhen}</div>
        </div>
        <div class="manageCommand__statusGroup">
          <div class="manageCommand__state"><span class="statusDot" aria-hidden="true"></span>${phaseLabel}</div>
          <button class="btn ${availabilityLocked ? "primary" : "warn"} manageCommand__availabilityBtn" id="${availabilityLocked ? "openAvailability" : "closeAvailability"}" type="button" aria-label="${availabilityLocked ? "Open availability" : "Close availability"}" ${isEditLocked ? "disabled" : ""}>${availabilityLocked ? "Open" : "Close"}</button>
        </div>
      </div>
      <div class="manageCommand__actions">
        <button class="btn gray" id="backToAdminList">Back to matches</button>
        <button class="btn primary" id="shareMatch">Share match link</button>
        ${isEditLocked ? `<button class="btn gray" id="unlockBtn">Unlock match</button>` : ""}
        ${hasBothScores && !locked ? `<button class="btn primary" id="lockRatingsTop">Complete & lock match</button>` : ""}
      </div>
      <div class="manageCommand__notice" id="lockReason">${locked ? "Completed matches are read-only until an admin unlocks them." : !hasBothScores ? "Locking becomes available after both scores are saved." : !potmReady ? "Select Player of the Match before completing." : "Ready to complete once all ratings have been checked."}</div>
      <div class="draftState" id="draftState" role="status" aria-live="polite">All setup changes saved</div>
    </section>
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
    if (!potmReady) {
      toastError("Select Player of the Match before completing this match.");
      const listMatch = (MEM.matches || []).find((item) => String(item.matchId) === String(m.matchId)) || m;
      openVotingManager(root, prevView || "open", listMatch).catch(() => {});
      return;
    }

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

  function wireAdminAvailabilityPicker() {
    const input = manageBody.querySelector("#adminPlayerCombo");
    const list = manageBody.querySelector("#adminPlayerComboList");
    const selectedList = manageBody.querySelector("#adminSelectedPlayers");
    const addBtn = manageBody.querySelector("#adminAddPlayerBtn");
    const availEl = manageBody.querySelector("#adminAddAvailability");
    const msgEl = manageBody.querySelector("#adminAddPlayerMsg");
    if (!input || !list || !selectedList || !addBtn) return;

    let allPlayers = [];
    const selectedPlayers = new Set();

    const hideList = () => { list.style.display = "none"; };
    const updateSelection = () => {
      selectedList.innerHTML = [...selectedPlayers].map(name => `
        <button type="button" class="playerSelectionChip" data-remove-player="${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)}">
          <span>${escapeHtml(name)}</span><span aria-hidden="true">×</span>
        </button>
      `).join("");
      selectedList.hidden = selectedPlayers.size === 0;
      addBtn.textContent = selectedPlayers.size ? `Add / Update ${selectedPlayers.size} player${selectedPlayers.size === 1 ? "" : "s"}` : "Add / Update players";
      selectedList.querySelectorAll("[data-remove-player]").forEach(button => {
        button.onclick = () => {
          selectedPlayers.delete(String(button.dataset.removePlayer || ""));
          updateSelection();
          input.focus();
        };
      });
    };
    const renderList = (filterText = "") => {
      const q = String(filterText || "").trim().toLowerCase();
      const items = (q ? allPlayers.filter(name => name.toLowerCase().includes(q)) : allPlayers)
        .filter(name => !selectedPlayers.has(name));
      list.innerHTML = items.slice(0, 60).map(name => `
        <button type="button" class="comboItem" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>
      `).join("");
      list.style.display = items.length ? "block" : "none";
      list.querySelectorAll(".comboItem").forEach(button => {
        button.onclick = () => {
          const name = String(button.dataset.name || "").trim();
          if (name) selectedPlayers.add(name);
          input.value = "";
          updateSelection();
          renderList("");
          input.focus();
        };
      });
    };

    let latestLoad = 0;
    const loadPlayers = async (force = false) => {
      const loadId = ++latestLoad;
      const users = await getUsersCached(force);
      if (loadId !== latestLoad) return;
      allPlayers = uniqueSorted((users || []).map(user => String(user?.name || user || "").trim()).filter(Boolean));
      if (document.activeElement === input) renderList(input.value);
    };

    input.onfocus = () => {
      // Show the local list immediately, then replace it with the latest roster.
      // This makes an account registered on another device searchable without
      // requiring the admin to reload the page or clear app caches.
      renderList(input.value);
      loadPlayers(true).catch(() => {});
    };
    input.oninput = () => renderList(input.value);
    input.onblur = () => setTimeout(hideList, 120);
    input.onkeydown = event => {
      if (event.key === "Escape") { hideList(); input.blur(); }
    };

    loadPlayers(false).catch(() => {
      addBtn.disabled = true;
      if (msgEl) msgEl.textContent = "Failed to load players list.";
    });

    updateSelection();
    addBtn.onclick = async () => {
      if (!stillOnAdmin(routeToken)) return;
      const playerNames = [...selectedPlayers];
      const desired = String(availEl?.value || "YES").trim().toUpperCase();
      if (!playerNames.length) return toastWarn("Select at least one player");
      if (desired === "WAITING" && yesPlayers.length < cap) {
        return toastWarn(`Waiting list is only available once ${cap} players are marked YES.`);
      }

      setDisabled(addBtn, true, `Saving 0/${playerNames.length}…`);
      if (msgEl) msgEl.textContent = `Saving 0 of ${playerNames.length} players…`;
      const saved = [];
      const failed = [];
      for (let index = 0; index < playerNames.length; index += 1) {
        const playerName = playerNames[index];
        try {
          const out = await API.adminSetAvailabilityFor(m.matchId, playerName, desired);
          if (!out?.ok) throw new Error(out?.error || "Failed");
          saved.push({ playerName, availability: String(out.effectiveAvailability || desired).toUpperCase() });
        } catch (error) {
          failed.push({ playerName, error: String(error?.message || error) });
        }
        setDisabled(addBtn, true, `Saving ${index + 1}/${playerNames.length}…`);
        if (msgEl) msgEl.textContent = `Saving ${index + 1} of ${playerNames.length} players…`;
      }

      if (saved.length) {
        const waiting = saved.filter(row => row.availability === "WAITING").length;
        const summary = `${saved.length} player${saved.length === 1 ? "" : "s"} updated${waiting ? ` · ${waiting} placed on waiting list` : ""}.`;
        failed.length ? toastWarn(`${summary} ${failed.length} failed.`) : toastSuccess(summary);
        clearPublicMatchDetailCache(m.publicCode);
        clearManageCache(m.publicCode);
        const fresh = await API.getPublicMatch(m.publicCode);
        if (stillOnAdmin(routeToken) && fresh?.ok) {
          lsSet(manageKey(m.publicCode), { ts: now(), data: fresh });
          renderManageUI(root, fresh, routeToken, { fromCache: false, prevView });
          return;
        }
      }

      addBtn.disabled = false;
      updateSelection();
      if (failed.length && msgEl) msgEl.textContent = failed.map(row => `${row.playerName}: ${row.error}`).join(" · ");
      if (failed.length && !saved.length) toastError(`Could not update ${failed.length} player${failed.length === 1 ? "" : "s"}.`);
    };
  }

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
    const savedOpponent = { squad: [...squad], captain: cap };

    // If no saved squad yet, default to all YES players (keeps old behavior simple)
    if (!squad.length && yesPlayers.length) squad = [...yesPlayers];
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

    async function saveOpponentField() {
      if (!squad.length) return toastWarn("Select at least one MLFC player before saving.");
      if (!opponentCaptain) return toastWarn("Select one MLFC captain before saving.");
      const out = await API.adminSetupOpponent({ matchId:m.matchId, captain:opponentCaptain, mlfcPlayers:squad, positions:positionRows([{team:"MLFC",players:squad}],fieldPositions) });
      if (!out?.ok) return toastError(out?.error || "Team changes could not be saved.");
      savedOpponent.squad = [...squad];
      savedOpponent.captain = opponentCaptain;
      savedPositions = JSON.stringify(fieldPositions);
      lsDel(setupDraftKey(m.matchId));
      clearPublicMatchDetailCache(m.publicCode);
      clearManageCache(m.publicCode);
      updateOpponentDraft();
      toastSuccess("Team-field changes saved.");
    }

    function renderSquadLists() {
      mountTeamField(manageBody.querySelector("#opponentTeamPreview"), {
        groups:[{team:"MLFC",label:homeTeamName,players:squad,captain:opponentCaptain}],positions:fieldPositions,photos:playerPhotos,pool:yesPlayers,disabled:isEditLocked,
        onResetDraft:() => {
          squad = [...savedOpponent.squad];
          opponentCaptain = savedOpponent.captain;
          fieldPositions = JSON.parse(savedPositions || "{}");
          lsDel(setupDraftKey(m.matchId));
          updateOpponentDraft();
          renderSquadLists();
          toastSuccess("Draft cleared. Saved setup restored.");
        },
        onAuto:() => { squad=uniqueSorted([...squad,...yesPlayers]); fieldPositions=randomGoalkeeperPositions(squad); updateOpponentDraft(); renderSquadLists(); },
        onChange:updateOpponentDraft,
        onDraft:updateOpponentDraft,
        onSave:saveOpponentField,
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
          <button class="btn primary" id="publishOpponent" ${isEditLocked ? "disabled" : ""}>Publish team</button>
          <button class="btn whatsappBtn" id="shareSquad" ${squad.length ? "" : "disabled"}>Share team sheet</button>
        </div>

        <div class="hr"></div>

        <div class="h1">Availability (admin)</div>
        <div class="small">Select several players, then update their availability together.</div>

        <label class="field__label" for="adminPlayerCombo">Player name</label>
        <input id="adminPlayerCombo" class="input" type="search" placeholder="Start typing a name" autocomplete="off" style="margin-top:7px" ${isEditLocked ? "disabled" : ""} />
        <div id="adminPlayerComboList" class="comboList" style="display:none"></div>
        <div id="adminSelectedPlayers" class="playerSelectionChips" aria-label="Selected players" hidden></div>

        <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
          <select id="adminAddAvailability" class="input" aria-label="Player availability" style="width:200px" ${isEditLocked ? "disabled" : ""}>
            <option value="YES" selected>YES</option>
            <option value="WAITING">WAITING</option>
            <option value="NO">NO</option>
          </select>
          <button class="btn primary" id="adminAddPlayerBtn" ${isEditLocked ? "disabled" : ""}>Add / Update players</button>
        </div>
        <div class="small" id="adminAddPlayerMsg" style="margin-top:10px"></div>

        <div class="small" id="msg" style="margin-top:10px"></div>
      </details>
    `;

    wireAvailabilityLimitEditor();

    renderSquadLists();
    updateOpponentDraft();

    manageBody.querySelector("#shareSquad").onclick = async () => {
      if (!squad.length) return toastWarn("Select the MLFC squad first.");
      const button = manageBody.querySelector("#shareSquad");
      setDisabled(button, true, "Preparing…");
      try {
        const mode = await shareTeamSheet(m, when, homeTeamName || "MLFC", squad, "", [], fieldPositions, [opponentCaptain], playerPhotos);
        toastInfo(mode === "image" ? "Choose WhatsApp to share the team-sheet image." : "Field image downloaded. Attach it in WhatsApp to share.");
      } catch (error) {
        if (error?.name !== "AbortError") toastError("Team sheet could not be shared.");
      } finally { setDisabled(button, false); }
    };

    manageBody.querySelector("#publishOpponent").onclick = async () => {
      const btn = manageBody.querySelector("#publishOpponent");
      const msg = manageBody.querySelector("#msg");
      const selCaptain = opponentCaptain;

      if (!squad.length) return toastWarn("Select at least one MLFC player before publishing.");
      if (!selCaptain) return toastWarn("Select one MLFC captain before publishing.");

      setDisabled(btn, true, "Publishing…");
      msg.textContent = "Saving team before publishing…";

      const out = await API.adminSetupOpponent({ matchId: m.matchId, captain: selCaptain, mlfcPlayers: squad, positions:positionRows([{team:"MLFC",players:squad}],fieldPositions) });
      if (!out.ok) { setDisabled(btn, false); msg.textContent = out.error || "Failed"; return toastError(out.error || "Failed"); }
      const published = await API.adminShareTeams(m.matchId);
      setDisabled(btn, false);
      if (!published?.ok) { msg.textContent = published?.error || "Publishing failed"; return toastError(published?.error || "Team notification could not be sent"); }
      msg.textContent = "Published ✅";
      toastSuccess("Team published and players notified.");
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
    const closeAvailabilityBtn = manageArea.querySelector("#closeAvailability");
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
    const openAvailabilityBtn = manageArea.querySelector("#openAvailability");
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

    wireAdminAvailabilityPicker();

    return;
  }

  /* ================= INTERNAL ================= */
  let blue = uniqueSorted(teams.filter(t => String(t.team).toUpperCase() === "BLUE").map(t => String(t.playerName || "").trim()));
  let orange = uniqueSorted(teams.filter(t => String(t.team).toUpperCase() === "ORANGE").map(t => String(t.playerName || "").trim()));
  let captainBlue = String(captains.captain1 || "");
  let captainOrange = String(captains.captain2 || "");
  let autoBalanceReport = data.teamBalance || null;
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

  async function saveInternalField() {
    if (!(blue.length + orange.length)) return toastWarn("Assign at least one player before saving.");
    const out = await API.adminSetupInternal({
      matchId:m.matchId, bluePlayers:blue, orangePlayers:orange,
      captainBlue, captainOrange,
      positions:positionRows([{team:"BLUE",players:blue},{team:"ORANGE",players:orange}],fieldPositions)
    });
    if (!out?.ok) return toastError(out?.error || "Team changes could not be saved.");
    savedInternal.blue = [...blue];
    savedInternal.orange = [...orange];
    savedInternal.captainBlue = captainBlue;
    savedInternal.captainOrange = captainOrange;
    savedPositions = JSON.stringify(fieldPositions);
    lsDel(setupDraftKey(m.matchId));
    clearManageCache(m.publicCode);
    clearPublicMatchDetailCache(m.publicCode);
    updateInternalDraft();
    toastSuccess("Team-field changes saved.");
  }

  // Links can be generated as soon as we know the captain names.
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
        Search and select multiple existing players, then update their availability together.
      </div>

      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap; align-items:center">
        <div class="comboWrap" style="flex:1; min-width:220px; position:relative">
          <label class="field__label" for="adminPlayerCombo">Player name</label>
          <input class="input" id="adminPlayerCombo" type="search" placeholder="Start typing a name" autocomplete="off" style="width:100%; margin-top:7px" />
          <div id="adminPlayerComboList" class="comboList" style="display:none"></div>
        </div>

        <div id="adminSelectedPlayers" class="playerSelectionChips" aria-label="Selected players" hidden></div>

        <select class="input" id="adminAddAvailability" aria-label="Player availability" style="min-width:160px">
          <option value="YES" selected>YES (Available)</option>
          <option value="NO">NO (Not available)</option>
          <option value="WAITING" ${yesPlayers.length >= cap ? "" : "disabled"}>WAITING LIST</option>
        </select>

        <button class="btn primary" id="adminAddPlayerBtn" ${isEditLocked ? "disabled" : ""}>Add / Update players</button>
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

      <!-- Publishing sends notifications; sharing only creates the image. -->
      <div class="row fieldSaveBar" style="margin-top:14px; gap:10px; flex-wrap:wrap">
        <button class="btn primary" id="publishSetup" ${isEditLocked || !hasAnyTeams ? "disabled" : ""}>Publish teams</button>
        <button class="btn whatsappBtn" id="shareTeams" ${hasAnyTeams ? "" : "disabled"}>Share team sheet</button>
      </div>

      <div id="setupMsg" class="small" style="margin-top:10px"></div>
    </details>

    
  `;

  wireAvailabilityLimitEditor();

  wireAdminAvailabilityPicker();

  const closeAvailabilityBtn = manageArea.querySelector("#closeAvailability");
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
 const openAvailabilityBtn = manageArea.querySelector("#openAvailability");
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
      onAuto:() => manageBody.querySelector("#autoBalanceTeams").click(),
      onResetDraft:() => {
        blue = [...savedInternal.blue];
        orange = [...savedInternal.orange];
        captainBlue = savedInternal.captainBlue;
        captainOrange = savedInternal.captainOrange;
        fieldPositions = JSON.parse(savedPositions || "{}");
        autoBalanceReport = data.teamBalance || null;
        lsDel(setupDraftKey(m.matchId));
        updateInternalDraft();
        renderAll();
        toastSuccess("Draft cleared. Saved setup restored.");
      },
      onChange:updateInternalDraft,
      onDraft:updateInternalDraft,
      onSave:saveInternalField,
      onAssign:(p,t) => { setTeam(p,t); renderAll(); },
      onCaptain:(p,t) => { if(t === "BLUE") captainBlue=p; else captainOrange=p; updateInternalDraft(); renderAll(); },
      onRemove:p => { delete fieldPositions[p]; removeFromTeam(p); renderAll(); },
      onTransfer:(p,t) => { delete fieldPositions[p]; setTeam(p,t === "BLUE" ? "ORANGE" : "BLUE"); renderAll(); }
    });

    const shareBtn = manageBody.querySelector("#shareTeams");
    const publishBtn = manageBody.querySelector("#publishSetup");
    if (shareBtn) {
      const ok = (blue.length + orange.length) > 0;
      shareBtn.disabled = !ok;
      if (publishBtn) publishBtn.disabled = isEditLocked || !ok;
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
      fieldPositions = {
        ...randomGoalkeeperPositions(blue),
        ...randomGoalkeeperPositions(orange)
      };
      autoBalanceReport = out.balance || null;
      updateInternalDraft();
      renderAll();
      toastSuccess(`Balanced ${blue.length + orange.length} players. Review, then publish the teams.`);
    } catch (error) {
      toastError(String(error?.message || error));
    } finally {
      setDisabled(autoBalanceTeams, false, "Balancing…");
    }
  };

  const clearTeamSelections = manageBody.querySelector("#clearTeamSelections");
  if (clearTeamSelections) clearTeamSelections.onclick = () => {
    if (!(blue.length || orange.length)) return;
    if (!window.confirm("Reset both team selections? The published setup will not change until you select Publish teams.")) return;
    blue = [];
    orange = [];
    captainBlue = "";
    captainOrange = "";
    fieldPositions = {};
    autoBalanceReport = null;
    updateInternalDraft();
    renderAll();
  };

  // Publish teams: save the current draft first, then send notifications.
  manageBody.querySelector("#publishSetup").onclick = async () => {
    if (!stillOnAdmin(routeToken)) return;
    if (isEditLocked) return toastWarn("Match is locked. Unlock to edit.");

    const msg = manageBody.querySelector("#setupMsg");
    // Requested: allow saving setup even if captains aren't selected yet.
    // Captains can be assigned later without blocking team setup.
    if (!captainBlue || !captainOrange) {
      msg.textContent = "Publishing setup without captains…";
    }

    const btn = manageBody.querySelector("#publishSetup");
    setDisabled(btn, true, "Publishing…");
    msg.textContent = "Saving teams before publishing…";

    const out = await API.adminSetupInternal({
      matchId: m.matchId,
      bluePlayers: blue,
      orangePlayers: orange,
      captainBlue,
      captainOrange,
      positions: positionRows([{team:"BLUE",players:blue},{team:"ORANGE",players:orange}],fieldPositions)
    });

    if (!out.ok) {
      setDisabled(btn, false);
      msg.textContent = out.error || "Failed";
      return toastError(out.error || "Failed to publish teams");
    }

    const published = await API.adminShareTeams(m.matchId);
    setDisabled(btn, false);
    if (!published?.ok) {
      msg.textContent = published?.error || "Publishing failed";
      return toastError(published?.error || "Team notification could not be sent");
    }

    msg.textContent = "Published ✅";
    toastSuccess("Teams published and players notified.");
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

  // Sharing creates the WhatsApp image only. Publishing is the sole action
  // that sends team notifications.
  const shareTeamsBtn = manageBody.querySelector("#shareTeams");
  shareTeamsBtn.onclick = async () => {
    const ok = (blue.length + orange.length) > 0;
    if (!ok) return toastWarn("Assign players to Blue/Orange first.");

    setDisabled(shareTeamsBtn, true, "Opening…");

  try {
    const fresh = await API.getPublicMatch(m.publicCode).catch(() => null);
    const shareBalance = autoBalanceReport || fresh?.teamBalance || null;
    const mode = await shareTeamSheet(m, when, homeTeamName, blue, awayTeamName, orange, fieldPositions, [captainBlue,captainOrange], playerPhotos, shareBalance);
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
  bindThemeSettings(root).catch(() => {});
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
