import { ensurePushSubscribed, pushSupport } from "../push.js";
import { toastSuccess } from "./toast.js";

let activeReminder = null;

export async function showPushEnableReminder(container = document.body, { required = false } = {}) {
  const support = pushSupport();
  if (!support.supported) return;
  if (Notification.permission === "granted") {
    if (!required) return;
    const subscribed = await ensurePushSubscribed().catch(() => null);
    if (subscribed?.ok) return;
  }
  if (activeReminder) return activeReminder;

  activeReminder = new Promise((resolve) => {
    const blocked = Notification.permission === "denied";
    const dialog = document.createElement("dialog");
    dialog.className = `playerDialog${required ? " pushReminder--required" : ""}`;
    dialog.setAttribute("aria-labelledby", "pushReminderTitle");
    dialog.innerHTML = `
      <div class="playerSheet">
        <div class="small">Stay informed</div>
        <div class="h1" id="pushReminderTitle">Enable phone notifications</div>
        <p id="pushReminderMessage" class="small">${blocked
          ? "Notifications are blocked. Enable them for MLFC in your phone settings, return to the app, then tap Check again."
          : "Turn on notifications so you receive availability, team and match updates even when the app is closed."}</p>
        ${required ? `<p class="pushReminder__required">Notifications are required to use the installed app.</p>` : ""}
        <div class="row" style="margin-top:16px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" type="button" data-enable-push>${blocked ? "Check again" : "Enable notifications"}</button>
          ${required ? "" : `<button class="btn gray" type="button" data-continue>Continue</button>`}
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
      if (!required) finish();
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
