// One scalable design for the season, leaderboard, and high-resolution exports.
const STATS = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
const SHAPE = "M24 93 Q73 89 88 53 Q300 -17 512 53 Q527 89 576 93 L576 626 Q576 675 526 684 Q364 698 300 737 Q236 698 74 684 Q24 675 24 626 Z";
let sequence = 0;
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const score = value => Math.max(0, Math.min(99, Number(value) || 50));

function ratingChange(value, x, y, size = "stat") {
  const change = Math.max(-99, Math.min(99, Math.round(Number(value) || 0)));
  if (!change) return "";
  const positive = change > 0;
  const label = `${positive ? "+" : "−"}${Math.abs(change)}`;
  const width = size === "overall" ? 46 : 36;
  const height = size === "overall" ? 30 : 22;
  return `<g transform="translate(${x} ${y})" role="img" aria-label="${positive ? "Up" : "Down"} ${Math.abs(change)}"><title>${positive ? "Increased" : "Decreased"} by ${Math.abs(change)}</title><rect width="${width}" height="${height}" rx="${height/2}" fill="${positive ? "#08783e" : "#b42318"}" stroke="#fff6c8" stroke-width="2"/><text x="${width/2}" y="${size === "overall" ? 21 : 16}" fill="#fff" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size === "overall" ? 17 : 14}" font-weight="900">${label}</text></g>`;
}

function playerStatusBadge(status) {
  if (status === "INJURED") return `<g aria-label="Injured"><title>Injured</title><circle r="31" fill="#fff" stroke="#d71920" stroke-width="5"/><g transform="rotate(-42)"><rect x="-21" y="-9" width="42" height="18" rx="7" fill="#d71920"/><rect x="-6" y="-9" width="12" height="18" fill="#fff"/><circle cx="-14" cy="0" r="2.2" fill="#fff"/><circle cx="14" cy="0" r="2.2" fill="#fff"/></g></g>`;
  if (status === "INACTIVE") return `<g aria-label="Inactive"><title>Inactive</title><circle r="31" fill="#f4f7f8" stroke="#52616b" stroke-width="5"/><rect x="-10" y="-14" width="7" height="28" rx="2" fill="#52616b"/><rect x="3" y="-14" width="7" height="28" rx="2" fill="#52616b"/></g>`;
  return "";
}

export function fcCardSvg(card, name, photo = card.photoUrl) {
  const id = `fc-${++sequence}`;
  const playerStatus = String(card.playerStatus || "ACTIVE").toUpperCase();
  const playerStatusLabel = ({ACTIVE:"Active",INJURED:"Injured",UNAVAILABLE:"Unavailable",INACTIVE:"Inactive"})[playerStatus] || "Active";
  const nameSize = Math.min(49, 760 / Math.max(14, String(name).length));
  const latestChanges = card.latestChanges || {};
  const changedRatings = [["OVR",latestChanges.overall],...STATS.map(stat => [stat,latestChanges.attributes?.[stat]])]
    .map(([stat,value]) => [stat,Math.round(Number(value) || 0)]).filter(([,value]) => value);
  const changeLabel = changedRatings.length ? ` · Latest changes ${changedRatings.map(([stat,value]) => `${stat} ${value > 0 ? "plus" : "minus"} ${Math.abs(value)}`).join(", ")}` : "";
  const lines = Array.from({length: 95}, (_, i) => `<path d="M${-550+i*14} 530 L${180+i*14} -30"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750" role="img" aria-label="${escape(name)} · ${score(card.overall)} OVR · ${escape(card.position || "CM")} · ${playerStatusLabel}${changeLabel}">
    <defs>
      <linearGradient id="${id}-gold" x2=".85" y2="1"><stop stop-color="#fff5b7"/><stop offset=".28" stop-color="#f6d86d"/><stop offset=".52" stop-color="#cf961e"/><stop offset=".73" stop-color="#ffe68d"/><stop offset="1" stop-color="#bb821c"/></linearGradient>
      <linearGradient id="${id}-panel" x2=".8" y2="1"><stop stop-color="#ffe99a"/><stop offset=".48" stop-color="#edc85d"/><stop offset="1" stop-color="#d4a039"/></linearGradient>
      <linearGradient id="${id}-edge" x2="1" y2="1"><stop stop-color="#fffad1"/><stop offset=".48" stop-color="#fff0a5"/><stop offset=".75" stop-color="#967023"/><stop offset="1" stop-color="#322809"/></linearGradient>
      <clipPath id="${id}-portrait"><circle cx="300" cy="272" r="180"/></clipPath>
      <clipPath id="${id}-clip"><path d="${SHAPE}"/></clipPath>
    </defs>
    <g clip-path="url(#${id}-clip)">
      <path d="${SHAPE}" fill="url(#${id}-gold)"/>
      <g stroke="#fff3b2" stroke-width="2" opacity=".42">${lines}</g>
      <g fill="none"><path d="M-40 386 Q250 340 655 104" stroke="#986218" stroke-width="23" opacity=".35"/><path d="M-40 374 Q250 328 655 92" stroke="#fff1a6" stroke-width="15"/><path d="M-60 404 Q274 420 648 243" stroke="#fff5be" stroke-width="5"/><path d="M-50 428 Q325 547 635 338" stroke="#b57818" stroke-width="24" opacity=".45"/><path d="M-50 416 Q325 535 635 326" stroke="#ffe995" stroke-width="19"/></g>
      ${photo ? `<g><circle cx="300" cy="272" r="184" fill="#f8dc79" opacity=".72"/><image href="${escape(photo)}" x="120" y="92" width="360" height="360" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}-portrait)"/><circle cx="300" cy="272" r="180" fill="none" stroke="#fff0a2" stroke-width="4" opacity=".9"/></g>` : `<g fill="#8b681f" opacity=".32"><circle cx="335" cy="223" r="90"/><path d="M156 490 Q155 322 335 322 Q515 322 514 490Z"/></g>`}
      <path d="M24 480 H576 V750 H24Z" fill="url(#${id}-panel)"/>
      <path d="M24 480 H576" stroke="#fff3b7" stroke-width="4"/>
      <g fill="#302609" text-anchor="middle" font-family="'Arial Narrow',Arial,sans-serif">
        <text x="82" y="169" font-size="83" font-weight="900" letter-spacing="-5">${score(card.overall)}</text>
        ${ratingChange(latestChanges.overall, 116, 116, "overall")}
        <text x="82" y="208" font-size="34" font-weight="800">${escape(card.position || "CM")}</text>
        <text x="300" y="537" font-size="${nameSize}" font-weight="800">${escape(name)}</text>
        ${STATS.map((stat,i) => `<text x="${76+i*90}" y="583" font-size="26" font-weight="700">${stat}</text><text x="${76+i*90}" y="628" font-size="43" font-weight="800" letter-spacing="-1.5">${score(card.attributes?.[stat])}</text>${ratingChange(latestChanges.attributes?.[stat],58+i*90,637)}`).join("")}
        <text x="184" y="672" font-size="13" font-weight="700" letter-spacing="1">${escape(card.status || "LIVE")}</text>
        <text x="416" y="672" font-size="13" font-weight="700" letter-spacing="1">${Number(card.appearances) || 0} APPS</text>
        <path d="M277 648 H323 V674 L300 688 L277 674Z" fill="#302609"/>
        <text x="300" y="669" fill="#f8db7c" font-size="12" font-weight="900">MLFC</text>
      </g>
    </g>
    <path d="${SHAPE}" fill="none" stroke="url(#${id}-edge)" stroke-width="5"/>
    <g transform="translate(530 95) scale(1.8)" style="filter:drop-shadow(0 4px 4px rgba(0,0,0,.48))">${playerStatusBadge(playerStatus)}</g>
  </svg>`;
}

export function fcCardHtml(card, name) {
  return `<article class="fcPlayerCard">${fcCardSvg(card, name)}</article>`;
}

function cardDate(value) {
  const match = String(value || "").slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "Date not recorded";
  return new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"})
    .format(new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))));
}

function signed(value, digits = 2) {
  const number = Number(value) || 0;
  const amount = Math.abs(number).toFixed(digits).replace(/\.00$/,"").replace(/(\.\d)0$/,"$1");
  return `${number >= 0 ? "+" : "−"}${amount}`;
}

function updateChips(change) {
  const values = [["OVR",change?.overall],...STATS.map(stat=>[stat,change?.attributes?.[stat]])]
    .map(([stat,value])=>[stat,Math.round(Number(value)||0)]).filter(([,value])=>value);
  if (!values.length) return `<span class="fcUpdateSummary__noChange">Building progress—no whole-number change yet</span>`;
  return values.map(([stat,value])=>`<span class="fcUpdateChip fcUpdateChip--${value>0?"up":"down"}">${stat} ${value>0?"+":"−"}${Math.abs(value)}</span>`).join("");
}

export function fcCardUpdateHtml(card) {
  const update = card?.latestUpdate;
  const injury = card?.injuryProtection;
  if (!update && !injury) return "";
  let latestHtml = "";
  if (update) {
    const reasons = [
      `<li><b>${Number(update.averageRating||0).toFixed(1)} average rating</b><span>${signed(update.ratingChange)} development to every attribute</span></li>`,
      `<li><b>${Number(update.appearances||0)} ${Number(update.appearances)===1?"appearance":"appearances"}</b><span>${signed(update.appearanceChange)} participation development to every attribute</span></li>`,
    ];
    if (Number(update.goals)>0) reasons.push(`<li><b>${Number(update.goals)} ${Number(update.goals)===1?"goal":"goals"}</b><span>${signed(update.shootingChange)} extra SHO development</span></li>`);
    if (Number(update.assists)>0) reasons.push(`<li><b>${Number(update.assists)} ${Number(update.assists)===1?"assist":"assists"}</b><span>${signed(update.passingChange)} extra PAS development</span></li>`);
    if (Number(update.captainAppearances)>0) reasons.push(`<li><b>Captain assignment</b><span>${signed(update.captainChange)} to every attribute</span></li>`);
    for (const boost of update.boosts||[]) {
      const authority=String(boost.authority||"").toUpperCase()==="ADMIN"?"Admin":"Captain";
      reasons.push(`<li><b>${authority} boost · ${escape(boost.attribute)}</b><span>${signed(boost.change)} (${signed(boost.multiplier,0)}×) · added ${escape(cardDate(boost.addedAt||boost.date))}</span></li>`);
    }
    const matches=(update.matches||[]).map(match=>`<div><time datetime="${escape(String(match.date||"").slice(0,10))}">${escape(cardDate(match.date))}</time><b>${escape(match.title||"Match")}</b></div>`).join("");
    latestHtml=`<section class="fcUpdateSummary__section" aria-labelledby="fcLatestUpdateTitle"><header><div><span>Last rating update</span><h3 id="fcLatestUpdateTitle">What changed</h3></div><small>Added ${escape(cardDate(update.addedAt||update.date))}</small></header><div class="fcUpdateSummary__matches">${matches}</div><div class="fcUpdateSummary__chips">${updateChips(card.latestChanges)}</div><ul class="fcUpdateSummary__reasons">${reasons.join("")}</ul></section>`;
  }
  let injuryHtml="";
  if (injury) {
    let explanation="";
    if (injury.status==="APPLIED") explanation=`${Number(injury.protectedWeeks)} missed ${Number(injury.protectedWeeks)===1?"week was":"weeks were"} protected at 50% of the player’s ${Number(injury.averageRating||0).toFixed(1)} established rating. ${signed(injury.attributeChange)} was added to every attribute.`;
    else if (injury.status==="NOT_ELIGIBLE") explanation=`Automatic protection starts after 10 appearances. This player currently has ${Number(injury.appearances||0)}.`;
    else if (injury.status==="NO_GROWTH") explanation=`Protected weeks were checked, but the established ${Number(injury.averageRating||0).toFixed(1)} rating did not produce a positive automatic increase.`;
    else explanation="The player is eligible, but no completed week after the injury date has needed automatic protection yet.";
    injuryHtml=`<section class="fcUpdateSummary__section fcUpdateSummary__section--injury" aria-labelledby="fcInjuryUpdateTitle"><header><div><span>Automatic injury boost</span><h3 id="fcInjuryUpdateTitle">${injury.status==="APPLIED"?"Protection added":"Protection status"}</h3></div><small>Calculated ${escape(cardDate(injury.calculatedThrough))}</small></header><div class="fcUpdateSummary__source"><b>No match</b><span>Automatic protection while injured${injury.startedAt?` · injured since ${escape(cardDate(injury.startedAt))}`:""}</span></div>${injury.status==="APPLIED"?`<div class="fcUpdateSummary__chips">${updateChips(injury)}</div>`:""}<p>${escape(explanation)}</p></section>`;
  }
  return `<aside class="fcUpdateSummary">${latestHtml}${injuryHtml}</aside>`;
}

function imageFrom(url) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.crossOrigin = "anonymous";
    image.onload = () => resolve(image); image.onerror = reject; image.src = url;
  });
}

export async function drawFcCard(context, card, name, x, y, width, height) {
  let photo = "";
  if (card.photoUrl) {
    try {
      const image = await imageFrom(card.photoUrl);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      photo = canvas.toDataURL("image/png");
    } catch { /* Keep a silhouette when the photo is unavailable or disallows export. */ }
  }
  const url = URL.createObjectURL(new Blob([fcCardSvg(card, name, photo)], {type:"image/svg+xml;charset=utf-8"}));
  try { context.drawImage(await imageFrom(url), x, y, width, height); }
  finally { URL.revokeObjectURL(url); }
}
