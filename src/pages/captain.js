// src/pages/captain.js
import { API } from "../api/endpoints.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { lsGet, lsSet } from "../storage.js";

const LS_CAPTAIN_ROSTER_PREFIX = "mlfc_captain_roster_v1:"; // + code + captain
const LS_CAPTAIN_TEAMS_PREFIX = "mlfc_captain_teams_v1:";   // + code

function rosterKey(code, captain){ return `${LS_CAPTAIN_ROSTER_PREFIX}${code}:${captain.toLowerCase()}`; }
function teamsKey(code){ return `${LS_CAPTAIN_TEAMS_PREFIX}${code}`; }

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
  const maybe = avail.filter(a => a.availability === "MAYBE").map(a => a.playerName);
  return uniqueSorted([...yes, ...maybe]);
}

function clampInt(x, min=0, max=99) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < min || v > max) return null;
  return v;
}

function safeUpper(x){ return String(x || "").trim().toUpperCase(); }

export async function renderCaptainPage(root, query) {
  const code = query.get("code");
  const captain = (query.get("captain") || "").trim();

  if (!code || !captain) {
    root.innerHTML = `<div class="card"><div class="h1">Captain</div><div class="small">Missing code/captain.</div></div>`;
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
  const status = safeUpper(m.status);
  const locked = String(m.ratingsLocked || "").toUpperCase() === "TRUE" || Number(m.ratingsLocked) === 1;
  const when = formatHumanDateTime(m.date, m.time);

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

  const avail = normalizeAvail(data.availability || []);
  const postedPlayers = uniqueSorted(avail.map(a => a.playerName));

  const playersRes = await API.players();
  const allPlayers = playersRes.ok ? uniqueSorted((playersRes.players || []).map(p => p.name)) : [];

  const cachedRoster = lsGet(rosterKey(code, captain));
  let roster = cachedRoster?.roster && Array.isArray(cachedRoster.roster)
    ? uniqueSorted(cachedRoster.roster)
    : initialRosterFromAvailability(avail);

  const cachedTeams = lsGet(teamsKey(code));
  let teamMap = (cachedTeams?.teamMap && typeof cachedTeams.teamMap === "object") ? cachedTeams.teamMap : {};

  (data.teams || []).forEach(t => {
    const p = String(t.playerName || "").trim();
    const tm = safeUpper(t.team);
    if (p && tm) teamMap[p] = tm;
  });

  if (!roster.some(x => x.toLowerCase() === captain.toLowerCase())) {
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

  const opponentScoreField = (type === "INTERNAL" && captainTeam)
    ? (captainTeam === "BLUE" ? "scoreAway" : "scoreHome")
    : "";

  // Ratings should only be available after a score has been submitted (as stored in backend).
  // - INTERNAL: captain can only submit opponent score, so unlock once *their* opponent score field exists.
  // - OPPONENT / other: unlock once both scores exist.
  let ratingsEnabled = false;
  if (type === "INTERNAL" && captainTeam) {
    const oppStored = String(m[opponentScoreField] ?? "").trim();
    ratingsEnabled = oppStored !== "";
  } else {
    const a = String(m.scoreHome ?? "").trim();
    const b = String(m.scoreAway ?? "").trim();
    ratingsEnabled = a !== "" && b !== "";
  }

  function isOpponentPlayer(playerName) {
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

  const hint = (type === "INTERNAL" && captainTeam)
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
      .pill { display:inline-block; padding: 4px 10px; border-radius:999px; background: rgba(11,18,32,0.06); font-weight:950; }
      .inlineNote { margin-top:6px; }
    </style>

    <div class="card">
      <div class="h1">${m.title}</div>
      <div class="row">
        <span class="badge">${m.type}</span>
        <span class="badge">${m.status}</span>
      </div>
      <div class="small" style="margin-top:10px">${when}</div>
      <div class="small" style="margin-top:6px"><b>Captain:</b> ${captain}${type === "INTERNAL" && captainTeam ? ` • <b>Your team:</b> ${captainTeam}` : ""}</div>
      ${type === "INTERNAL" && captainTeam ? `<div class="small inlineNote">You can only rate/update <b>opponent</b> players.</div>` : ""}
      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
        <button class="btn gray" id="openMatch">Open match</button>
        <button class="btn gray" id="refreshMatch">Refresh match data</button>
      </div>
      <div class="small" id="refreshMsg" style="margin-top:10px"></div>
    </div>

    <div class="card">
      <div class="h1">Score</div>
      <div class="small">
        ${type === "INTERNAL" ? "Enter Blue vs Orange score." : "Enter MLFC vs Opponent score."} ${hint}
      </div>

      ${
        (type === "INTERNAL" && captainTeam) ? `
          <div class="scoreGrid">
            <div class="scoreBox">
              <div class="scoreLabel">${captainTeam} score (read-only)</div>
              <div class="scoreValue" id="homeScoreLabel">—</div>
              <div class="small muted">This will be filled when the other captain submits their opponent score.</div>
            </div>
            <div class="scoreBox">
              <div class="scoreLabel">Opponent (${opponentTeam}) score (editable)</div>
              <input id="oppScoreInput" class="input" type="number" min="0" placeholder="Opponent score" style="margin-top:8px" />
              <div class="small muted">You can only edit opponent score</div>
            </div>
          </div>
        ` : `
          <div class="row" style="margin-top:10px">
            <input id="scoreA" class="input" type="number" min="0" placeholder="${type === "INTERNAL" ? "Blue score" : "MLFC score"}" style="flex:1" />
            <input id="scoreB" class="input" type="number" min="0" placeholder="${type === "INTERNAL" ? "Orange score" : "Opponent score"}" style="flex:1" />
          </div>
        `
      }

      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="submitScore">Submit score</button>
      </div>
      <div class="small" id="scoreMsg" style="margin-top:10px"></div>
    </div>

    <div class="card">
      <div class="h1">Roster</div>
      <div class="small">Roster starts from YES/MAYBE availability. Add more players if someone joins late.</div>

      <details class="card" style="margin-top:10px">
        <summary style="font-weight:950">Players who posted availability (${postedPlayers.length})</summary>
        <div class="small" style="margin-top:8px">
          ${postedPlayers.map(p => `• ${p}`).join("<br/>") || "None"}
        </div>
      </details>

      <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
        <select id="addFromAll" class="input" style="flex:1">
          <option value="">Add player from full list…</option>
          ${(allPlayers||[]).map(p => `<option value="${p}">${p}</option>`).join("")}
        </select>
        <button class="btn gray" id="addBtn">Add</button>
      </div>

      <div class="row" style="margin-top:10px">
        <input id="search" class="input" placeholder="Search roster…" />
      </div>

      <div id="ratingsGate" class="small" style="margin-top:12px; ${ratingsEnabled ? "display:none" : ""}">
        <span class="pill">Step 1</span> Submit your opponent score to unlock ratings.
      </div>

      <div id="ratingsSection" style="margin-top:12px; ${ratingsEnabled ? "" : "display:none"}">
        ${
          (type === "INTERNAL" && captainTeam) ? `
            <div class="small" style="margin-bottom:8px">
              <span class="pill">Rating</span> Rate <b>${opponentTeam}</b> players (switch a player to <b>${opponentTeam}</b> to show the rating box).
            </div>
          ` : `
            <div class="small" style="margin-bottom:8px">
              <span class="pill">Rating</span> Enter ratings for the players you want.
            </div>
          `
        }

        <div id="rosterTableWrap" style="overflow:auto; border-radius:14px; border:1px solid rgba(11,18,32,0.10)">
          <table style="width:100%; border-collapse:collapse; min-width:780px">
            <thead>
              <tr style="background: rgba(11,18,32,0.04)">
                <th style="text-align:left; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Player</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Team</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Rating</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Goals</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Assists</th>
                <th style="text-align:center; padding:10px; font-size:12px; color:rgba(11,18,32,0.72)">Remove</th>
              </tr>
            </thead>
            <tbody id="body"></tbody>
          </table>
        </div>

        <div id="rosterMobileWrap"></div>

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="submitRatings">Submit ratings</button>
        </div>
        <div class="small" id="rateMsg" style="margin-top:10px"></div>
      </div>
    </div>
  `;

  // Prefill score UI (no extra fetch)
  try {
    if (type === "INTERNAL" && captainTeam) {
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
    location.hash = `#/match?code=${encodeURIComponent(code)}`;
  };

  root.querySelector("#refreshMatch").onclick = async () => {
    const btn = root.querySelector("#refreshMatch");
    const msg = root.querySelector("#refreshMsg");
    setDisabled(btn, true, "Refreshing…");
    msg.textContent = "Refreshing…";
    try {
      const res = await API.getPublicMatch(code);
      if (!res.ok) {
        msg.textContent = res.error || "Failed";
        toastError(res.error || "Failed to refresh");
        return;
      }
      msg.textContent = "Refreshed ✅";
      toastSuccess("Match refreshed");
      await renderCaptainPage(root, query);
    } finally {
      setDisabled(btn, false);
    }
  };

  root.querySelector("#submitScore").onclick = async () => {
    const btn = root.querySelector("#submitScore");
    const msg = root.querySelector("#scoreMsg");

    setDisabled(btn, true, "Submitting…");
    msg.textContent = "Submitting…";

    try {
      let out;

      if (type === "INTERNAL" && captainTeam) {
        const oppInput = root.querySelector("#oppScoreInput");
        const oppVal = clampInt(String(oppInput?.value ?? "").trim(), 0, 99);
        if (oppVal == null) {
          toastWarn("Enter a valid opponent score (0-99).");
          msg.textContent = "Invalid opponent score";
          return;
        }

        // Partial update: send only opponent side (backend supports COALESCE)
        if (captainTeam === "BLUE") {
          out = await API.captainSubmitScore(code, captain, "INTERNAL", "", String(oppVal));
          m.scoreAway = String(oppVal);
        } else {
          out = await API.captainSubmitScore(code, captain, "INTERNAL", String(oppVal), "");
          m.scoreHome = String(oppVal);
        }

        if (!out?.ok) {
          msg.textContent = out?.error || "Failed";
          toastError(out?.error || "Score submit failed");
          return;
        }

        msg.textContent = "Submitted ✅";
        toastSuccess("Opponent score submitted.");

        // Unlock ratings right away
        root.querySelector("#ratingsGate").style.display = "none";
        root.querySelector("#ratingsSection").style.display = "block";
        ratingsEnabled = true;
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

        out = await API.captainSubmitScore(code, captain, type === "INTERNAL" ? "INTERNAL" : "OPPONENT", String(a), String(b));

        if (!out.ok) {
          msg.textContent = out.error || "Failed";
          toastError(out.error || "Score submit failed");
          return;
        }

        m.scoreHome = String(a);
        m.scoreAway = String(b);

        msg.textContent = "Submitted ✅";
        toastSuccess("Score submitted.");

        root.querySelector("#ratingsGate").style.display = "none";
        root.querySelector("#ratingsSection").style.display = "block";
        ratingsEnabled = true;
      }

      // Update label if present
      if (type === "INTERNAL" && captainTeam) {
        const homeLabel = root.querySelector("#homeScoreLabel");
        const homeScore = (captainTeam === "BLUE") ? String(m.scoreHome ?? "").trim() : String(m.scoreAway ?? "").trim();
        if (homeLabel) homeLabel.textContent = homeScore === "" ? "—" : homeScore;
      }
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

  function renderRows() {
    const f = String(searchEl.value || "").trim().toLowerCase();
    const list = f ? roster.filter(p => p.toLowerCase().includes(f)) : roster;

    // Display order:
    // - Players who can be rated (opponent team, when ratings are enabled) come first
    // - Your team players (and any non-rateable entries) come after
    const ordered = [...list].sort((a, b) => {
      const aRateable = !!(ratingsEnabled && isOpponentPlayer(a));
      const bRateable = !!(ratingsEnabled && isOpponentPlayer(b));
      if (aRateable !== bRateable) return aRateable ? -1 : 1;
      return String(a).localeCompare(String(b));
    });

    bodyEl.innerHTML = ordered.map(p => {
      const tm = safeUpper(teamMap[p] || "BLUE");
      const canEdit = ratingsEnabled && isOpponentPlayer(p);

      const d = drafts[p] || {};
      const ratingCell = canEdit
        ? `<input class="input" data-rating="${encodeURIComponent(p)}" type="number" min="1" max="10" placeholder="1-10" style="width:110px; text-align:center" value="${d.rating ?? ""}" />`
        : `<span class="small muted">—</span>`;

      const goalsCell = canEdit
        ? `<input class="input" data-goals="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" style="width:90px; text-align:center" value="${d.goals ?? ""}" />`
        : `<span class="small muted">—</span>`;

      const assistsCell = canEdit
        ? `<input class="input" data-assists="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" style="width:90px; text-align:center" value="${d.assists ?? ""}" />`
        : `<span class="small muted">—</span>`;

      return `
        <tr style="border-top:1px solid rgba(11,18,32,0.06)">
          <td style="padding:10px; font-weight:950">${p}</td>
          <td style="padding:10px; text-align:center">
            <div class="row" style="gap:8px; justify-content:center; flex-wrap:wrap">
              <button class="btn good compactBtn" data-team="BLUE" data-p="${encodeURIComponent(p)}" ${tm==="BLUE"?"disabled":""}>Blue</button>
              <button class="btn warn compactBtn" data-team="ORANGE" data-p="${encodeURIComponent(p)}" ${tm==="ORANGE"?"disabled":""}>Orange</button>
            </div>
          </td>
          <td style="padding:10px; text-align:center">${ratingCell}</td>
          <td style="padding:10px; text-align:center">${goalsCell}</td>
          <td style="padding:10px; text-align:center">${assistsCell}</td>
          <td style="padding:10px; text-align:center">
            <button class="btn gray" data-remove="${encodeURIComponent(p)}" style="padding:8px 10px; border-radius:12px">Remove</button>
          </td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6" class="small" style="padding:12px">No players in roster.</td></tr>`;

    mobileWrap.innerHTML = ordered.map(p => {
      const tm = safeUpper(teamMap[p] || "BLUE");
      const canEdit = ratingsEnabled && isOpponentPlayer(p);
      const d = drafts[p] || {};

      return `
        <div class="rosterCard">
          <div style="font-weight:950; font-size:16px">${p}</div>
          <div class="muted" style="margin-top:6px; font-size:12px">Team</div>
          <div class="teamPills" style="margin-top:6px">
            <button class="btn good" data-team="BLUE" data-p="${encodeURIComponent(p)}" ${tm==="BLUE"?"disabled":""}>Blue</button>
            <button class="btn warn" data-team="ORANGE" data-p="${encodeURIComponent(p)}" ${tm==="ORANGE"?"disabled":""}>Orange</button>
            <button class="btn gray" data-remove="${encodeURIComponent(p)}" style="margin-left:auto">Remove</button>
          </div>

          ${
            canEdit ? `
              <div class="rosterGrid">
                <div>
                  <div class="muted" style="font-size:12px">Rating</div>
                  <input class="input" data-rating="${encodeURIComponent(p)}" type="number" min="1" max="10" placeholder="1-10" style="text-align:center" value="${d.rating ?? ""}" />
                </div>
                <div>
                  <div class="muted" style="font-size:12px">Goals</div>
                  <input class="input" data-goals="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" style="text-align:center" value="${d.goals ?? ""}" />
                </div>
                <div>
                  <div class="muted" style="font-size:12px">Assists</div>
                  <input class="input" data-assists="${encodeURIComponent(p)}" type="number" min="0" max="99" placeholder="0" style="text-align:center" value="${d.assists ?? ""}" />
                </div>
              </div>
            ` : `
              <div class="small muted" style="margin-top:10px">No rating box (not opponent).</div>
            `
          }
        </div>
      `;
    }).join("") || `<div class="small">No players in roster.</div>`;

    root.querySelectorAll("[data-team]").forEach(btn => {
      btn.onclick = () => {
        const team = btn.getAttribute("data-team");
        const p = decodeURIComponent(btn.getAttribute("data-p"));
        teamMap[p] = team;
        saveTeamsLocal();
        renderRows();
      };
    });

    root.querySelectorAll("[data-remove]").forEach(btn => {
      btn.onclick = () => {
        const p = decodeURIComponent(btn.getAttribute("data-remove"));
        roster = roster.filter(x => x !== p);
        saveRosterLocal();
        renderRows();
      };
    });

    root.querySelectorAll("[data-rating]").forEach(inp => {
      inp.addEventListener("input", () => {
        const p = decodeURIComponent(inp.getAttribute("data-rating"));
        drafts[p] = drafts[p] || {};
        drafts[p].rating = String(inp.value ?? "");
      });
    });
    root.querySelectorAll("[data-goals]").forEach(inp => {
      inp.addEventListener("input", () => {
        const p = decodeURIComponent(inp.getAttribute("data-goals"));
        drafts[p] = drafts[p] || {};
        drafts[p].goals = String(inp.value ?? "");
      });
    });
    root.querySelectorAll("[data-assists]").forEach(inp => {
      inp.addEventListener("input", () => {
        const p = decodeURIComponent(inp.getAttribute("data-assists"));
        drafts[p] = drafts[p] || {};
        drafts[p].assists = String(inp.value ?? "");
      });
    });
  }

  renderRows();
  searchEl.addEventListener("input", renderRows);

  root.querySelector("#addBtn").onclick = () => {
    const sel = root.querySelector("#addFromAll");
    const p = String(sel.value || "").trim();
    if (!p) return toastWarn("Select a player to add.");
    if (roster.some(x => x.toLowerCase() === p.toLowerCase())) return toastWarn("Already in roster.");
    roster = uniqueSorted([...roster, p]);
    if (!teamMap[p]) teamMap[p] = "BLUE";
    saveRosterLocal();
    saveTeamsLocal();
    sel.value = "";
    renderRows();
    toastSuccess("Player added to roster.");
  };

  const submitRatingsBtn = root.querySelector("#submitRatings");
  if (submitRatingsBtn) {
    submitRatingsBtn.onclick = async () => {
      if (!ratingsEnabled) {
        toastWarn("Submit your opponent score first to unlock ratings.");
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

        // INTERNAL captain flow: require ratings for ALL ratable (opponent) players.
        // Other match types keep the "rate whoever you want" behavior.
        const requireAll = (type === "INTERNAL" && !!captainTeam);

        const rows = [];
        const missing = [];

        for (const p of ratablePlayers) {
          const d = drafts[p] || {};
          const ratingRaw = String(d.rating ?? "").trim();

          if (ratingRaw === "") {
            if (requireAll) missing.push(p);
            continue;
          }

          const ratingVal = clampInt(ratingRaw, 1, 10);
          if (ratingVal == null) throw new Error(`Invalid rating for ${p} (1-10)`);

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
          });
        }

        if (requireAll && missing.length) {
          throw new Error(`Please rate all ${opponentTeam} players before submitting. Missing: ${missing.join(", ")}`);
        }

        if (rows.length === 0) {
          toastWarn(requireAll ? `Rate all ${opponentTeam} players before submitting.` : "Enter at least one rating.");
          msg.textContent = "Nothing to submit";
          return;
        }

        const out = await API.captainSubmitRatingsBatch(code, captain, rows);
        if (!out.ok) {
          msg.textContent = out.error || "Failed";
          toastError(out.error || "Submit failed");
          return;
        }

        try {
          const seasonId = String(m.seasonId || "");
          if (seasonId) localStorage.removeItem(`mlfc_leaderboard_v2:${seasonId}`);
        } catch {}

        msg.textContent = "Submitted ✅";
        toastSuccess("Submitted.");
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