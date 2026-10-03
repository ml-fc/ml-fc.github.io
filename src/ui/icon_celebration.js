import { createIconMove } from "./icon_moves.js";
import { GOAT_THEMES, getActiveWeeklyTheme } from "../themes.js";

// These are playful visual tributes, using the original theme photographs.
const CELEBRATIONS = {
  cristiano: { title: "SIUUU!", detail: "Bicycle kick. Airborne. Unstoppable.", symbol: "7", motion: "siu" },
  messi: { title: "MESSI MAGIC", detail: "Close control. Left foot. Pure magic.", symbol: "★", motion: "sky" },
  neymar: { title: "Joga bonito", detail: "The one-two. The cut. The Santos solo.", symbol: "♫", motion: "dance" },
  r9: { title: "O Fenômeno", detail: "Receive. Set. Finish. The 2002 final.", symbol: "⚽", motion: "burst" },
  maradona: { title: "El Pibe de Oro", detail: "The slalom. That left foot. El Diego.", symbol: "10", motion: "orbit" },
  ronaldinho: { title: "Keep smiling", detail: "The body feint. The Chelsea toe-poke.", symbol: "🤙", motion: "samba" },
  pele: { title: "O Rei", detail: "Chest. Flick. Volley. Sweden, 1958.", symbol: "♛", motion: "king" },
};
const ORIGINAL_CLIPS = {
  cristiano: 'https://www.youtube.com/watch?v=Nt8198a0acA',
  messi: 'https://www.youtube.com/watch?v=_OlTuc_t_BY',
  neymar: 'https://www.youtube.com/watch?v=aV3W_DLMko8',
  r9: 'https://www.youtube.com/watch?v=O8dUhMGtUtw',
  maradona: 'https://www.youtube.com/watch?v=Da_CDPRG2j0',
  ronaldinho: 'https://www.youtube.com/watch?v=fygu4KrxJqc',
  pele: 'https://www.youtube.com/watch?v=TYNsrKtV6Mc',
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
    <header>
      <button class="iconCelebration__photo" type="button" aria-label="Expand player photo" aria-expanded="false"><img alt="" /></button>
      <div><small>ICON / GOAT</small><h2 id="iconCelebrationName"></h2><span class="iconCelebration__subtitle">The signature collection</span></div>
    </header>
    <div class="iconCelebration__move" aria-label="Signature move"></div>
    <div class="iconCelebration__transport">
      <button type="button" data-replay>↻ Replay</button>
      <button type="button" data-pause aria-pressed="false">Pause</button>
      <button type="button" data-speed aria-pressed="false">0.5× slow motion</button>
      <input type="range" min="0" max="1000" step="1" value="0" aria-label="Animation progress" />
    </div>
    <footer><strong class="iconCelebration__shout"></strong><p></p><small>Tap the portrait to view the full photo</small><a class="iconCelebration__reference" target="_blank" rel="noopener noreferrer">Watch the original move ↗</a></footer>
    <nav class="iconCelebration__players" aria-label="Choose an icon"></nav>
  </div>`;
  const photo = dialog.querySelector(".iconCelebration__photo img");
  const effects = dialog.querySelector(".iconCelebration__effects");
  let current;
  let sequenceTimer;
  let sequenceIndex=-1,paused=false;
  const progress=dialog.querySelector('input[type="range"]');
  const pauseButton=dialog.querySelector('[data-pause]');
  const move = createIconMove(dialog.querySelector(".iconCelebration__move"), {
    onProgress(value){progress.value=String(Math.round(value*1000));},
    onFinish(){
      pauseButton.textContent="Play";
      if(sequenceIndex>=0 && sequenceIndex+1<players.length)sequenceTimer=setTimeout(()=>playAll(sequenceIndex+1),650);
    }
  });
  function playAll(index = 0) {
    clearTimeout(sequenceTimer);
    sequenceIndex=index;
    select(players[index]);
    dialog.querySelector("footer small").textContent = `${index + 1} / ${players.length} · All icons · Replay starts the collection again`;
  }
  function celebrate() {
    clearTimeout(sequenceTimer);
    effects.replaceChildren();
    const style = CELEBRATIONS[current.slug];
    move.play(current.slug);
    paused=false;pauseButton.textContent="Pause";pauseButton.setAttribute("aria-pressed","false");
    dialog.dataset.motion = style.motion;
    // Restart only finite animations; reduced-motion users see the still tribute.
    dialog.classList.remove("is-celebrating");
    void dialog.offsetWidth;
    dialog.classList.add("is-celebrating");
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
    const reference=dialog.querySelector('.iconCelebration__reference');
    reference.href=ORIGINAL_CLIPS[theme.slug];
    reference.setAttribute('aria-label',`Watch ${theme.name}'s original move (opens a new tab)`);
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
      sequenceIndex=-1;
      select(theme);
      dialog.querySelector("footer small").textContent = "Replay plays all seven icons";
    };
    nav.append(button);
  });
  dialog.querySelector('[data-replay]').onclick=()=>active.collective?playAll():celebrate();
  pauseButton.onclick=()=>{
    clearTimeout(sequenceTimer);
    if(Number(progress.value)>=1000){celebrate();return;}
    paused=!paused;move.pause(paused);pauseButton.textContent=paused?"Play":"Pause";pauseButton.setAttribute('aria-pressed',String(paused));
  };
  dialog.querySelector('[data-speed]').onclick=event=>{
    const button=event.currentTarget,slow=button.getAttribute('aria-pressed')!=='true';
    button.setAttribute('aria-pressed',String(slow));move.speed(slow?.5:1);
  };
  progress.oninput=()=>{clearTimeout(sequenceTimer);move.seek(Number(progress.value)/1000);};
  dialog.querySelector(".iconCelebration__photo").onclick=event=>{
    const expanded=dialog.classList.toggle('is-photo-expanded');
    event.currentTarget.setAttribute('aria-expanded',String(expanded));
    event.currentTarget.setAttribute('aria-label',expanded?'Collapse player photo':'Expand player photo');
  };
  dialog.querySelector(".iconCelebration__close").onclick = () => dialog.close();
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  const closeOnNavigation = () => dialog.close();
  const previousOverflow = document.body.style.overflow;
  dialog.addEventListener("close", () => {
    clearTimeout(sequenceTimer);
    move.dispose();
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
