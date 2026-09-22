import { ensurePushSubscribed, pushSupport } from "../push.js";
import { isInstalledApp } from "./install_prompt.js";
import { toastSuccess } from "./toast.js";

const LS_INITIAL_PUSH_REMINDER_SHOWN = "mlfc_initial_push_reminder_shown_v1";
let activeReminder = null;
let initialReminderShownThisSession = false;

export async function showInitialPushEnableReminder(container = document.body) {
  if (!isInstalledApp() || initialReminderShownThisSession) return;

  try {
    if (localStorage.getItem(LS_INITIAL_PUSH_REMINDER_SHOWN)) return;
    localStorage.setItem(LS_INITIAL_PUSH_REMINDER_SHOWN, "1");
  } catch {
    // Still prevent repeat prompts during this session if storage is unavailable.
  }
  initialReminderShownThisSession = true;
  return showPushEnableReminder(container);
}

export async function showPushEnableReminder(container = document.body) {
  const support = pushSupport();
  if (!support.supported) return;
  if (Notification.permission === "granted") return;
  if (activeReminder) return activeReminder;

  activeReminder = new Promise((resolve) => {
    const blocked = Notification.permission === "denied";
    const dialog = document.createElement("dialog");
    dialog.className = "playerDialog";
    dialog.setAttribute("aria-labelledby", "pushReminderTitle");
    dialog.innerHTML = `
      <div class="playerSheet">
        <div class="small">Stay informed</div>
        <div class="h1" id="pushReminderTitle">Enable phone notifications</div>
        <p id="pushReminderMessage" class="small">${blocked
          ? "Notifications are blocked. Enable them for MLFC in your phone settings, return to the app, then tap Check again."
          : "Turn on notifications so you receive availability, team and match updates even when the app is closed."}</p>
        <div class="row" style="margin-top:16px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" type="button" data-enable-push>${blocked ? "Check again" : "Enable notifications"}</button>
          <button class="btn gray" type="button" data-continue>Later</button>
        </div>
      </div>`;

    const finish = () => {
      if (dialog.open) dialog.close();
      dialog.remove();
      activeReminder = null;
      resolve();
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });
    const continueButton = dialog.querySelector("[data-continue]");
    if (continueButton) continueButton.onclick = finish;

    const enable = dialog.querySelector("[data-enable-push]");
    if (enable) {
      const tryEnable = async () => {
        enable.disabled = true;
        enable.textContent = Notification.permission === "denied" ? "Checking…" : "Enabling…";
        try {
          const result = await ensurePushSubscribed({ requestPermission: true });
          if (!result?.ok) throw new Error(result?.error || "Could not enable notifications.");
          toastSuccess("Phone notifications enabled");
          finish();
        } catch (error) {
          const message = dialog.querySelector("#pushReminderMessage");
          if (message) message.textContent = error?.message || "Could not enable notifications.";
          enable.disabled = false;
          enable.textContent = Notification.permission === "denied" ? "Check again" : "Try again";
        }
      };
      enable.onclick = tryEnable;

      const checkAfterSettings = () => {
        if (document.visibilityState === "visible" && Notification.permission === "granted") tryEnable();
      };
      document.addEventListener("visibilitychange", checkAfterSettings);
      dialog.addEventListener("close", () => document.removeEventListener("visibilitychange", checkAfterSettings), { once: true });
    }

    container.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else finish();
  });

  return activeReminder;
}
