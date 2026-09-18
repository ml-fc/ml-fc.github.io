import { ensurePushSubscribed, pushSupport } from "../push.js";
import { toastSuccess } from "./toast.js";

let activeReminder = null;

export async function showPushEnableReminder(container = document.body) {
  const support = pushSupport();
  if (!support.supported || Notification.permission === "granted") return;
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
          ? "Notifications are blocked. Enable them for MLFC in your phone or browser settings so you don’t miss club updates."
          : "Turn on notifications so you receive availability, team and match updates even when the app is closed."}</p>
        <div class="row" style="margin-top:16px; gap:10px; flex-wrap:wrap">
          ${blocked ? "" : `<button class="btn primary" type="button" data-enable-push>Enable notifications</button>`}
          <button class="btn gray" type="button" data-continue>Continue</button>
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
    dialog.querySelector("[data-continue]").onclick = finish;

    const enable = dialog.querySelector("[data-enable-push]");
    if (enable) {
      enable.onclick = async () => {
        enable.disabled = true;
        enable.textContent = "Enabling…";
        try {
          const result = await ensurePushSubscribed({ requestPermission: true });
          if (!result?.ok) throw new Error(result?.error || "Could not enable notifications.");
          toastSuccess("Phone notifications enabled");
          finish();
        } catch (error) {
          const message = dialog.querySelector("#pushReminderMessage");
          if (message) message.textContent = error?.message || "Could not enable notifications.";
          enable.disabled = false;
          enable.textContent = "Try again";
        }
      };
    }

    container.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else finish();
  });

  return activeReminder;
}
