// One scalable design for the season, leaderboard, and high-resolution exports.
const STATS = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
const SHAPE = "M24 93 Q73 89 88 53 Q300 -17 512 53 Q527 89 576 93 L576 626 Q576 675 526 684 Q364 698 300 737 Q236 698 74 684 Q24 675 24 626 Z";
let sequence = 0;
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const score = value => Math.max(0, Math.min(99, Number(value) || 50));

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
  const lines = Array.from({length: 95}, (_, i) => `<path d="M${-550+i*14} 530 L${180+i*14} -30"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750" role="img" aria-label="${escape(name)} · ${score(card.overall)} OVR · ${escape(card.position || "CM")} · ${playerStatusLabel}">
    <defs>
      <linearGradient id="${id}-gold" x2=".85" y2="1"><stop stop-color="#fff5b7"/><stop offset=".28" stop-color="#f6d86d"/><stop offset=".52" stop-color="#cf961e"/><stop offset=".73" stop-color="#ffe68d"/><stop offset="1" stop-color="#bb821c"/></linearGradient>
      <linearGradient id="${id}-panel" x2=".8" y2="1"><stop stop-color="#ffe99a"/><stop offset=".48" stop-color="#edc85d"/><stop offset="1" stop-color="#d4a039"/></linearGradient>
      <linearGradient id="${id}-edge" x2="1" y2="1"><stop stop-color="#fffad1"/><stop offset=".48" stop-color="#fff0a5"/><stop offset=".75" stop-color="#967023"/><stop offset="1" stop-color="#322809"/></linearGradient>
      <linearGradient id="${id}-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="black"/><stop offset=".13" stop-color="white"/><stop offset=".83" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient>
      <linearGradient id="${id}-sides"><stop stop-color="black"/><stop offset=".14" stop-color="white"/><stop offset=".88" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient>
      <mask id="${id}-portrait"><rect x="125" y="62" width="440" height="430" fill="url(#${id}-fade)"/></mask>
      <mask id="${id}-soft"><rect x="125" y="62" width="440" height="430" fill="url(#${id}-sides)"/></mask>
      <clipPath id="${id}-clip"><path d="${SHAPE}"/></clipPath>
    </defs>
    <g clip-path="url(#${id}-clip)">
      <path d="${SHAPE}" fill="url(#${id}-gold)"/>
      <g stroke="#fff3b2" stroke-width="2" opacity=".42">${lines}</g>
      <g fill="none"><path d="M-40 386 Q250 340 655 104" stroke="#986218" stroke-width="23" opacity=".35"/><path d="M-40 374 Q250 328 655 92" stroke="#fff1a6" stroke-width="15"/><path d="M-60 404 Q274 420 648 243" stroke="#fff5be" stroke-width="5"/><path d="M-50 428 Q325 547 635 338" stroke="#b57818" stroke-width="24" opacity=".45"/><path d="M-50 416 Q325 535 635 326" stroke="#ffe995" stroke-width="19"/></g>
      ${photo ? `<g mask="url(#${id}-soft)"><image href="${escape(photo)}" x="125" y="62" width="440" height="445" preserveAspectRatio="xMidYMid slice" mask="url(#${id}-portrait)"/></g>` : `<g fill="#8b681f" opacity=".32"><circle cx="335" cy="223" r="90"/><path d="M156 490 Q155 322 335 322 Q515 322 514 490Z"/></g>`}
      <path d="M24 480 H576 V750 H24Z" fill="url(#${id}-panel)"/>
      <path d="M24 480 H576" stroke="#fff3b7" stroke-width="4"/>
      <g fill="#302609" text-anchor="middle" font-family="'Arial Narrow',Arial,sans-serif">
        <text x="100" y="169" font-size="83" font-weight="900" letter-spacing="-5">${score(card.overall)}</text>
        <text x="100" y="208" font-size="34" font-weight="800">${escape(card.position || "CM")}</text>
        <text x="300" y="537" font-size="${nameSize}" font-weight="800">${escape(name)}</text>
        ${STATS.map((stat,i) => `<text x="${76+i*90}" y="583" font-size="26" font-weight="700">${stat}</text><text x="${76+i*90}" y="628" font-size="43" font-weight="800" letter-spacing="-1.5">${score(card.attributes?.[stat])}</text>`).join("")}
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
