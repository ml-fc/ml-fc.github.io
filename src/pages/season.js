import { fcCardHtml, fcCardUpdateHtml, drawFcCard } from "../ui/fc_card.js";
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

const CARD_STATS=["PAC","SHO","PAS","DRI","DEF","PHY"];

async function fcCardFile(card,userName,seasonName){
  const canvas=document.createElement("canvas");canvas.width=1440;canvas.height=1920;const c=canvas.getContext("2d");
  const background=c.createRadialGradient(720,830,100,720,830,1200);background.addColorStop(0,"#234c43");background.addColorStop(1,"#061e25");c.fillStyle=background;c.fillRect(0,0,1440,1920);
  await drawFcCard(c,card,userName,48,38,1344,1680);
  c.textAlign="center";c.fillStyle="#f4db91";c.font="700 34px Arial";c.fillText(seasonName,720,1790,1260);c.fillStyle="#c5d6d2";c.font="24px Arial";c.fillText("MANOR LAKES FOOTBALL CLUB",720,1844);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));return blob?new File([blob],`mlfc-${String(userName).toLowerCase().replace(/[^a-z0-9]+/g,"-")}-card.png`,{type:"image/png"}):null;
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
        <button class="btn seasonHero__share" id="shareSeason" type="button" disabled>Share card</button>
      </div>
      <div class="fcCardStage" id="fcCardStage"><div class="seasonHero__loading">Building your player card…</div></div>
      <div id="seasonSummary" class="seasonHero__loading" aria-live="polite">Loading your season…</div>
    </section>
    <section class="card seasonHistory" aria-labelledby="historyTitle">
      <div class="seasonHistory__head"><div><div class="stepEyebrow">Every appearance</div><div class="h1" id="historyTitle">Match history</div></div><span class="badge">PRIVATE</span></div>
      <div id="seasonMatches" class="seasonHistory__loading" aria-live="polite">Loading match history…</div>
    </section>
    <dialog class="fcLogicDialog" id="fcLogicDialog" aria-labelledby="fcLogicTitle"><div class="fcLogicDialog__sheet"><header><div><div class="stepEyebrow">FC Card guide</div><div class="h1" id="fcLogicTitle">How your card grows</div></div><button type="button" class="fcLogicDialog__close" aria-label="Close">×</button></header><div class="fcLogicDialog__scroll"><p><b>Every card starts at 50</b> and can reach 99. The season length decides the weekly step, so a consistently excellent player can reach 99 by the final week.</p><h3>Match rating</h3><ul><li><b>9.0+:</b> 100% of the weekly step</li><li><b>8.0–8.9:</b> 80%</li><li><b>7.0–7.9:</b> 55%</li><li><b>6.0–6.9:</b> 25%</li><li><b>5.0–5.9:</b> small decrease</li><li><b>Below 5:</b> larger decrease</li></ul><p>Two matches in one week are averaged, so playing twice cannot double the weekly growth.</p><h3>Stats and Boosts</h3><p>Goals add a little to <b>SHO</b>, assists add a little to <b>PAS</b>, and a hat-trick adds an extra SHO point.</p><p>Captain and admin <b>Boosts</b> have equal strength, from −3× to +3×. Every appearance adds +0.05 to each attribute, and being assigned captain adds another +0.25 for that match. Existing appearances are included automatically. Attributes never rise above 99.</p><h3>Position and OVR</h3><p>Your most-played field position becomes the card position. OVR uses all six attributes, with extra weight on the skills important to that position—for example, SHO matters more for ST and DEF matters more for CB.</p><h3>Missing matches</h3><p>After 10 appearances, an Injured player receives reduced protected growth based on their own season average. Unavailable and Inactive players receive no protected growth. An Active player who misses 10 consecutive club matches is marked Inactive automatically.</p><h3>Example</h3><p>In a 16-week season, a 9.0 week gives about +3.1 development. If you play twice and receive 8.0 and 9.0, the week uses the 8.5 average. Your card becomes Final when the season closes.</p></div></div></dialog>`;

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
  const card=out.fcCard||{overall:50,position:"CM",attributes:Object.fromEntries(CARD_STATS.map(key=>[key,50])),status:"LIVE",appearances:0};
  const hasCardChanges=[card.latestChanges?.overall,...CARD_STATS.map(stat=>card.latestChanges?.attributes?.[stat])].some(value=>Number(value)!==0);
  const cardStage=root.querySelector("#fcCardStage");
  cardStage.innerHTML=`<div class="fcCardStage__head"><span>${esc(out.season?.name||"Current season")}</span><button class="fcCardInfo" id="fcCardInfo" type="button" aria-label="How FC Card ratings work">i</button></div>${fcCardHtml(card,user?.name||"Player")}<div class="fcCardStage__note">${card.status==="FINAL"?"Season card locked":hasCardChanges?"Green/red badges show your latest match-week changes":"Updates after completed match weeks"}</div>${fcCardUpdateHtml(card)}`;
  const logicDialog=root.querySelector("#fcLogicDialog");root.querySelector("#fcCardInfo").onclick=()=>logicDialog.showModal();logicDialog.querySelector(".fcLogicDialog__close").onclick=()=>logicDialog.close();logicDialog.addEventListener("click",event=>{if(event.target===logicDialog)logicDialog.close();});

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
  shareButton.onclick = async () => {shareButton.disabled=true;shareButton.textContent="Preparing…";try{const file=await fcCardFile(card,user?.name||"Player",out.season?.name||"MLFC season");const text=`⚽ ${user?.name||"Player"}'s ${card.overall} OVR ${card.position} MLFC card`;
    if(file&&navigator.canShare?.({files:[file]})){await navigator.share({title:"My MLFC player card",text,files:[file]});}
    else if(file){const link=document.createElement("a");link.href=URL.createObjectURL(file);link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);toastInfo("Card downloaded—share it in WhatsApp.");}
    else shareSeason(user?.name||"Player",summary,matches);
  }catch(error){if(error?.name!=="AbortError")toastError("Could not share the card.");}finally{shareButton.disabled=false;shareButton.textContent="Share card";}};
}
