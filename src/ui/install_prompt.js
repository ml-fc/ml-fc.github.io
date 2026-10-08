let deferredInstallPrompt = null;
const APPLE_INSTALL_DISMISSED_AT = "mlfc_apple_install_dismissed_at";
const APPLE_INSTALL_CONFIRMED = "mlfc_apple_install_confirmed";
const APPLE_INSTALL_REMINDER_MS = 30 * 24 * 60 * 60 * 1000;

function rememberAppleInstall(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function shouldShowAppleInstallPrompt() {
  try {
    if (localStorage.getItem(APPLE_INSTALL_CONFIRMED) === "true") return false;
    const dismissedAt = Number(localStorage.getItem(APPLE_INSTALL_DISMISSED_AT));
    return !dismissedAt || Date.now() - dismissedAt >= APPLE_INSTALL_REMINDER_MS;
  } catch {
    return true;
  }
}

export function isInstalledApp() {
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

function appleBrowserName() {
  const agent = navigator.userAgent;
  if (/CriOS/i.test(agent)) return "Chrome";
  if (/EdgiOS/i.test(agent)) return "Edge";
  if (/FxiOS/i.test(agent)) return "Firefox";
  return "Safari";
}

function buildDialog(mode) {
  const dialog = document.createElement("dialog");
  dialog.className = "installPrompt";
  dialog.setAttribute("aria-labelledby", "installPromptTitle");

  const appleHelp = mode === "apple"
    ? `<p class="installPrompt__help">In ${appleBrowserName()}, open the <strong>Share</strong> menu, then choose <strong>Add to Home Screen</strong>. If it is not visible, scroll down in the Share menu.</p>`
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
        ${mode === "native" ? `<button class="btn primary" type="button" data-install>Install</button>` : `<button class="btn primary" type="button" data-install-done>Already installed</button>`}
      </div>
    </div>`;

  const close = () => dialog.close();
  dialog.querySelector(".installPrompt__close")?.addEventListener("click", close);
  dialog.querySelector("[data-install-later]")?.addEventListener("click", () => {
    if (mode === "apple") rememberAppleInstall(APPLE_INSTALL_DISMISSED_AT, String(Date.now()));
    close();
  });
  dialog.querySelector("[data-install-done]")?.addEventListener("click", () => {
    rememberAppleInstall(APPLE_INSTALL_CONFIRMED, "true");
    close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      if (mode === "apple") rememberAppleInstall(APPLE_INSTALL_DISMISSED_AT, String(Date.now()));
      close();
    }
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
  if (!isMobileDevice() || isInstalledApp()) return;

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
      if (!isInstalledApp() && shouldShowAppleInstallPrompt() && !document.querySelector(".installPrompt")) buildDialog("apple");
    }, 700);
  }
}
