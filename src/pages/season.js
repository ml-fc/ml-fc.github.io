import { API } from "../api/endpoints.js";
import { getCachedUser } from "../auth.js";
import { toastError, toastInfo } from "../ui/toast.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function matchResult(match) {
  const home = String(match?.scoreHome ?? "").trim();
  const away = String(match?.scoreAway ?? "").trim();
  return home !== "" && away !== "" ? `${home}–${away}` : "—";
}

function formTone(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value)) return "neutral";
  if (value >= 8) return "great";
  if (value >= 6.5) return "good";
  return "steady";
}

function shareSeason(userName, summary, matches) {
  const rating = summary.averageRating == null ? "—" : Number(summary.averageRating).toFixed(1);
  const lines = [
    `⚽ ${userName}'s Manor Lakes FC season`, "",
    `${Number(summary.appearances || 0)} appearances`,
    `${Number(summary.goals || 0)} goals · ${Number(summary.assists || 0)} assists`,
    `${rating} average rating`,
  ];
  if (matches[0]) lines.push("", `Latest: ${matches[0].title || "Match"} · ${matchResult(matches[0])}`);
  lines.push("", "Manor Lakes FC · The Lakes, Melbourne");
  const text = lines.join("\n");
  if (navigator.share) {
    navigator.share({ title: "My Manor Lakes FC season", text }).catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(text).then(() => toastInfo("Season summary copied.")).catch(() => {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  });
}

export async function renderSeasonPage(root) {
  const user = getCachedUser();
  root.innerHTML = `
    <section class="seasonHero" aria-labelledby="seasonTitle">
      <div class="seasonHero__eyebrow">Private player dashboard</div>
      <div class="seasonHero__head">
        <div><h1 id="seasonTitle">My season</h1><p>${esc(user?.name || "Player")} · Manor Lakes FC</p></div>
        <button class="btn seasonHero__share" id="shareSeason" type="button" disabled>Share summary</button>
      </div>
      <div id="seasonSummary" class="seasonHero__loading" aria-live="polite">Loading your season…</div>
    </section>
    <section class="card seasonHistory" aria-labelledby="historyTitle">
      <div class="seasonHistory__head"><div><div class="stepEyebrow">Every appearance</div><div class="h1" id="historyTitle">Match history</div></div><span class="badge">PRIVATE</span></div>
      <div id="seasonMatches" class="seasonHistory__loading" aria-live="polite">Loading match history…</div>
    </section>`;

  const out = await API.mySeasonStats("", true).catch(() => null);
  if (!out?.ok) {
    root.querySelector("#seasonSummary").textContent = out?.error || "Could not load your season.";
    root.querySelector("#seasonMatches").textContent = "Check your connection and try again.";
    toastError(out?.error || "Could not load your season.");
    return;
  }

  const summary = out.summary || {};
  const matches = Array.isArray(out.matches) ? out.matches : [];
  const rating = summary.averageRating == null ? "—" : Number(summary.averageRating).toFixed(1);
  const latestRatings = matches.map((match) => match.rating).filter((value) => value != null).slice(0, 8);
  const best = matches.reduce((top, match) => Number(match.rating || 0) > Number(top?.rating || 0) ? match : top, null);

  const summaryHost = root.querySelector("#seasonSummary");
  summaryHost.className = "seasonDashboard";
  summaryHost.innerHTML = `
    <div class="seasonNumbers">
      <div><strong>${Number(summary.appearances || 0)}</strong><span>Appearances</span></div>
      <div><strong>${Number(summary.goals || 0)}</strong><span>Goals</span></div>
      <div><strong>${Number(summary.assists || 0)}</strong><span>Assists</span></div>
      <div><strong>${esc(rating)}</strong><span>Avg rating</span></div>
    </div>
    <div class="seasonInsights">
      <div><span>Recent form</span><div class="formStrip">${latestRatings.length ? latestRatings.map((value) => `<b class="formStrip__item formStrip__item--${formTone(value)}">${Number(value).toFixed(1)}</b>`).join("") : "<em>No ratings yet</em>"}</div></div>
      <div><span>Season highlight</span><strong>${best ? `${esc(best.title || "Match")} · ${Number(best.rating).toFixed(1)} rating` : "Your best match will appear here"}</strong></div>
    </div>`;

  const matchesHost = root.querySelector("#seasonMatches");
  matchesHost.className = "seasonMatchList";
  matchesHost.innerHTML = matches.length ? matches.map((match) => `
    <article class="seasonMatchRow">
      <div class="seasonMatchRow__date"><b>${esc(String(match.date || "").slice(8, 10) || "—")}</b><span>${esc(new Date(`${match.date || "2000-01-01"}T12:00:00`).toLocaleDateString(undefined, { month: "short" }))}</span></div>
      <div class="seasonMatchRow__main"><strong>${esc(match.title || "Match")}</strong><span>${esc(match.team || "Squad")} · ${matchResult(match)}</span></div>
      <div class="seasonMatchRow__stats"><span>${Number(match.goals || 0)} G</span><span>${Number(match.assists || 0)} A</span><span>${match.rating == null ? "—" : Number(match.rating).toFixed(1)} R</span></div>
    </article>`).join("") : `<div class="emptyState"><b>No completed appearances yet</b><span>Your match history will build here through the season.</span></div>`;

  const shareButton = root.querySelector("#shareSeason");
  shareButton.disabled = false;
  shareButton.onclick = () => shareSeason(user?.name || "Player", summary, matches);
}
