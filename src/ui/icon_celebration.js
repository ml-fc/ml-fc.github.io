import { GOAT_THEMES, getActiveWeeklyTheme } from "../themes.js";

// These are playful visual tributes, using the original theme photographs.
const CELEBRATIONS = {
  cristiano: { title: "SIUUU!", detail: "The jump. The landing. The roar.", symbol: "7", motion: "siu" },
  messi: { title: "To the sky", detail: "Two hands raised. A little magic.", symbol: "★", motion: "sky" },
  neymar: { title: "Joga bonito", detail: "Bring the dance to the pitch.", symbol: "♫", motion: "dance" },
  r9: { title: "O Fenômeno", detail: "Arms wide. Unstoppable.", symbol: "⚽", motion: "burst" },
  maradona: { title: "El Pibe de Oro", detail: "A little left-foot magic.", symbol: "10", motion: "orbit" },
  ronaldinho: { title: "Keep smiling", detail: "A little samba. A little shaka.", symbol: "🤙", motion: "samba" },
  pele: { title: "O Rei", detail: "A champion’s leap. A king’s crown.", symbol: "♛", motion: "king" },
};

export function openIconCelebration() {
  const active = getActiveWeeklyTheme();
  if (active?.category !== "GOATS" || document.querySelector(".iconCelebration")) return;
  const players = GOAT_THEMES.filter((theme) => !theme.collective);
  const returnFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "iconCelebration";
  dialog.setAttribute("aria-labelledby", "iconCelebrationName");
  dialog.innerHTML = `<div class="iconCelebration__stage">
    <div class="iconCelebration__effects" aria-hidden="true"></div>
    <button class="iconCelebration__close" type="button" aria-label="Close photo">×</button>
    <header><small>ICON / GOAT</small><h2 id="iconCelebrationName"></h2></header>
    <button class="iconCelebration__photo" type="button" aria-label="Replay celebration"><img alt="" /></button>
    <footer><strong class="iconCelebration__shout"></strong><p></p><small>Tap the photo to celebrate again</small></footer>
    <nav class="iconCelebration__players" aria-label="Choose an icon"></nav>
  </div>`;
  const photo = dialog.querySelector(".iconCelebration__photo img");
  const effects = dialog.querySelector(".iconCelebration__effects");
  let current;
  let cleanupTimer;
  function celebrate() {
    clearTimeout(cleanupTimer);
    effects.replaceChildren();
    const style = CELEBRATIONS[current.slug];
    dialog.dataset.motion = style.motion;
    // Restart only finite animations; reduced-motion users see the still tribute.
    dialog.classList.remove("is-celebrating");
    void dialog.offsetWidth;
    dialog.classList.add("is-celebrating");
    for (let i = 0; i < 16; i++) {
      const mark = document.createElement("span");
      mark.textContent = style.symbol;
      mark.style.setProperty("--x", `${6 + (i * 29 % 88)}%`);
      mark.style.setProperty("--delay", `${i * 45}ms`);
      mark.style.setProperty("--turn", `${i % 2 ? 24 : -24}deg`);
      effects.append(mark);
    }
    cleanupTimer = setTimeout(() => { effects.replaceChildren(); dialog.classList.remove("is-celebrating"); }, 3400);
  }
  function select(theme) {
    current = theme;
    dialog.style.setProperty("--celebration-accent", theme.accent);
    dialog.style.setProperty("--celebration-bg", theme.background);
    dialog.style.setProperty("--celebration-secondary", theme.primary);
    dialog.querySelector("h2").textContent = theme.name;
    photo.src = theme.crest;
    photo.alt = `${theme.name} in ${theme.kit}`;
    dialog.querySelector(".iconCelebration__shout").textContent = CELEBRATIONS[theme.slug].title;
    dialog.querySelector("footer p").textContent = CELEBRATIONS[theme.slug].detail;
    dialog.querySelectorAll("nav button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.slug === theme.slug)));
    celebrate();
  }
  const nav = dialog.querySelector("nav");
  nav.hidden = !active.collective;
  if (active.collective) players.forEach(theme => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.slug = theme.slug;
    button.setAttribute("aria-label", theme.name);
    const image = document.createElement("img");
    image.src = theme.crest;
    image.alt = "";
    image.style.objectPosition = theme.portraitPosition;
    button.append(image);
    button.onclick = () => select(theme);
    nav.append(button);
  });
  dialog.querySelector(".iconCelebration__photo").onclick = celebrate;
  dialog.querySelector(".iconCelebration__close").onclick = () => dialog.close();
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  const closeOnNavigation = () => dialog.close();
  const previousOverflow = document.body.style.overflow;
  dialog.addEventListener("close", () => {
    clearTimeout(cleanupTimer);
    window.removeEventListener("hashchange", closeOnNavigation);
    document.body.style.overflow = previousOverflow;
    dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }, { once: true });
  window.addEventListener("hashchange", closeOnNavigation);
  document.body.append(dialog);
  dialog.showModal();
  document.body.style.overflow = "hidden";
  select(active.collective ? players[0] : active);
}
