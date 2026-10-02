import { createIconMove, ICON_MOVE_DURATION } from "./icon_moves.js";
import { GOAT_THEMES, getActiveWeeklyTheme } from "../themes.js";

// These are playful visual tributes, using the original theme photographs.
const CELEBRATIONS = {
  cristiano: { title: "SIUUU!", detail: "Bicycle kick. Airborne. Unstoppable.", symbol: "7", motion: "siu" },
  messi: { title: "MESSI MAGIC", detail: "Close control. Left foot. Pure magic.", symbol: "★", motion: "sky" },
  neymar: { title: "Joga bonito", detail: "Over the head. Rainbow flick. Joga bonito.", symbol: "♫", motion: "dance" },
  r9: { title: "O Fenômeno", detail: "The stepovers. The burst. The finish.", symbol: "⚽", motion: "burst" },
  maradona: { title: "El Pibe de Oro", detail: "The slalom. That left foot. El Diego.", symbol: "10", motion: "orbit" },
  ronaldinho: { title: "Keep smiling", detail: "Outside. Inside. The elastico.", symbol: "🤙", motion: "samba" },
  pele: { title: "O Rei", detail: "Airborne volley. Long live the King.", symbol: "♛", motion: "king" },
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
    <div class="iconCelebration__move" aria-label="Signature move"></div>
    <footer><strong class="iconCelebration__shout"></strong><p></p><small>Tap the photo to celebrate again</small></footer>
    <nav class="iconCelebration__players" aria-label="Choose an icon"></nav>
  </div>`;
  const photo = dialog.querySelector(".iconCelebration__photo img");
  const effects = dialog.querySelector(".iconCelebration__effects");
  const move = createIconMove(dialog.querySelector(".iconCelebration__move"));
  let current;
  let cleanupTimer;
  let sequenceTimer;
  function playAll(index = 0) {
    clearTimeout(sequenceTimer);
    select(players[index]);
    dialog.querySelector("footer small").textContent = `${index + 1} / ${players.length} · All icons · Tap photo to restart`;
    if (index + 1 < players.length) sequenceTimer = setTimeout(() => playAll(index + 1), ICON_MOVE_DURATION + 500);
  }
  function celebrate() {
    clearTimeout(cleanupTimer);
    effects.replaceChildren();
    const style = CELEBRATIONS[current.slug];
    move.play(current.slug);
    dialog.dataset.motion = style.motion;
    // Restart only finite animations; reduced-motion users see the still tribute.
    dialog.classList.remove("is-celebrating");
    void dialog.offsetWidth;
    dialog.classList.add("is-celebrating");
    cleanupTimer = setTimeout(() => { effects.replaceChildren(); dialog.classList.remove("is-celebrating"); }, ICON_MOVE_DURATION + 500);
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
    button.onclick = () => {
      clearTimeout(sequenceTimer);
      select(theme);
      dialog.querySelector("footer small").textContent = "Tap the photo to play all seven icons";
    };
    nav.append(button);
  });
  dialog.querySelector(".iconCelebration__photo").onclick = () => active.collective ? playAll() : celebrate();
  dialog.querySelector(".iconCelebration__close").onclick = () => dialog.close();
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  const closeOnNavigation = () => dialog.close();
  const previousOverflow = document.body.style.overflow;
  dialog.addEventListener("close", () => {
    clearTimeout(cleanupTimer);
    clearTimeout(sequenceTimer);
    move.stop();
    window.removeEventListener("hashchange", closeOnNavigation);
    document.body.style.overflow = previousOverflow;
    dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }, { once: true });
  window.addEventListener("hashchange", closeOnNavigation);
  document.body.append(dialog);
  dialog.showModal();
  document.body.style.overflow = "hidden";
  if (active.collective) playAll();
  else select(active);
}
