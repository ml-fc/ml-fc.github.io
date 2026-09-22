let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.matchMedia("(max-width: 900px)").matches);
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function buildDialog(mode) {
  const dialog = document.createElement("dialog");
  dialog.className = "installPrompt";
  dialog.setAttribute("aria-labelledby", "installPromptTitle");

  const appleHelp = mode === "apple"
    ? `<p class="installPrompt__help">Tap the <strong>Share</strong> button in Safari, then choose <strong>Add to Home Screen</strong>.</p>`
    : `<p class="installPrompt__help">Install the club app for quick access from your home screen.</p>`;

  dialog.innerHTML = `
    <div class="installPrompt__sheet">
      <button class="installPrompt__close" type="button" aria-label="Close install prompt">×</button>
      <img class="installPrompt__icon" src="./assets/icons/icon-192.png" alt="" />
      <div>
        <div class="installPrompt__eyebrow">Manor Lakes FC</div>
        <h2 id="installPromptTitle">Install the app</h2>
        ${appleHelp}
      </div>
      <div class="installPrompt__actions">
        <button class="btn" type="button" data-install-later>Not now</button>
        ${mode === "native" ? `<button class="btn primary" type="button" data-install>Install</button>` : `<button class="btn primary" type="button" data-install-done>Got it</button>`}
      </div>
    </div>`;

  const close = () => dialog.close();
  dialog.querySelector(".installPrompt__close")?.addEventListener("click", close);
  dialog.querySelector("[data-install-later]")?.addEventListener("click", close);
  dialog.querySelector("[data-install-done]")?.addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", () => dialog.remove());

  dialog.querySelector("[data-install]")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
    close();
  });

  document.body.append(dialog);
  dialog.showModal();
}

export function initInstallPrompt() {
  if (!isMobileDevice() || isStandalone()) return;

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.querySelector(".installPrompt")?.close();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!document.querySelector(".installPrompt")) buildDialog("native");
  });

  // iOS does not expose beforeinstallprompt, so explain its manual install flow.
  if (isAppleMobile()) {
    window.setTimeout(() => {
      if (!isStandalone() && !document.querySelector(".installPrompt")) buildDialog("apple");
    }, 700);
  }
}
