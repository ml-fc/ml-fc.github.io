import { API } from "../api/endpoints.js";
import { clearAuth, setCachedUser, setToken, getToken, getCachedUser, refreshMe, updateNavForUser } from "../auth.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { lsGet, lsSet } from "../storage.js";
import { isReloadFor } from "../nav_state.js";
import { ensurePushSubscribed, pushSupport } from "../push.js";
import { showInitialPushEnableReminder } from "../ui/push_reminder.js";
import { choosePhotoCrop, invalidatePlayerPhotoCaches, playerPhotoHtml } from "../ui/player_photo.js";
import { showEmailSentPrompt } from "../ui/email_sent_prompt.js";

const LS_NOTI_CACHE = "mlfc_notifications_cache_v1";
const PHONE_COUNTRIES = [
  ["61", "🇦🇺 Australia (+61)"], ["64", "🇳🇿 New Zealand (+64)"], ["91", "🇮🇳 India (+91)"],
  ["44", "🇬🇧 United Kingdom (+44)"], ["1", "🇺🇸 USA / Canada (+1)"], ["971", "🇦🇪 UAE (+971)"],
  ["65", "🇸🇬 Singapore (+65)"], ["60", "🇲🇾 Malaysia (+60)"], ["94", "🇱🇰 Sri Lanka (+94)"],
  ["63", "🇵🇭 Philippines (+63)"], ["92", "🇵🇰 Pakistan (+92)"], ["880", "🇧🇩 Bangladesh (+880)"],
];

function phoneParts(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits || digits.startsWith("0")) return { country: "61", local: digits.replace(/^0+/, "") };
  const country = PHONE_COUNTRIES.map(([code]) => code).sort((a, b) => b.length - a.length).find(code => digits.startsWith(code)) || "61";
  return { country, local: country === "61" && !digits.startsWith("61") ? digits : digits.slice(country.length) };
}

function countryOptions(selected = "61") {
  return PHONE_COUNTRIES.map(([code, label]) => `<option value="${code}"${code === selected ? " selected" : ""}>${label}</option>`).join("");
}

function internationalPhone(countrySelect, numberInput) {
  const local = String(numberInput?.value || "").replace(/\D+/g, "").replace(/^0+/, "");
  return `${String(countrySelect?.value || "61").replace(/\D+/g, "")}${local}`;
}

function phoneDisplay(parts) {
  const label = PHONE_COUNTRIES.find(([code]) => code === parts.country)?.[1] || "🌐";
  return `${label.split(" ")[0]} +${parts.country} ${parts.local}`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
}

function safeHttpsUrl(value) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}

const playerStatusIcon = status => ({ ACTIVE:"●", INJURED:"🩹", UNAVAILABLE:"×", INACTIVE:"Ⅱ" })[String(status || "ACTIVE").toUpperCase()] || "●";

export async function renderLoginPage(root, query = new URLSearchParams()) {
  const token = getToken();
  let me = getCachedUser();
  if (token && !me) me = await refreshMe().catch(() => null);
  const requestedReturn = String(query?.get?.("return") || "");
  const returnHash = requestedReturn.startsWith("#/match") ? requestedReturn : "";

  // If logged in already, show account page + logout
  if (token && me) {
    const savedPhone = phoneParts(me.phone);
    const isSuperAdmin = String(me.name || "").trim().toLowerCase() === "admin";
    updateNavForUser(me);
    root.innerHTML = `
      <div class="card">
        <div class="profileIdentity">
          ${playerPhotoHtml(me.name, me.photoUrl, "playerPhoto playerPhoto--profile")}
          <div><div class="stepEyebrow">Player profile</div><div class="h1">${esc(me.name)}</div>${me.phone ? `<div class="profilePhone">${esc(phoneDisplay(savedPhone))}</div>` : ""}${me.email ? `<div class="profilePhone">${esc(me.email)}</div>` : ""}<div class="small">${me.isAdmin ? "<span class=\"badge\">ADMIN</span> · " : ""}Your photo appears on team sheets and POTM cards.</div></div>
        </div>
        <div class="profilePhotoActions">
          <label class="btn primary" for="profilePhotoInput">${me.photoUrl ? "Change photo" : "Add photo"}</label>
          <input id="profilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          <button class="btn gray" id="changePhone" type="button">${me.phone ? "Change number" : "Add number"}</button>
          <button class="btn gray" id="changeEmail" type="button">${me.email ? "Change email" : "Add email"}</button>
          <button class="btn gray" id="openPasswordDialog" type="button">Password</button>
          <span class="small profileActionStatus" id="profilePhotoStatus" role="status" aria-live="polite">Choose a clear face photo for team sheets and POTM cards.</span>
        </div>
        <button class="profileStatusCard" id="openStatusDialog" type="button" aria-haspopup="dialog"><span><span class="field__label">Player status</span><strong><span class="profileStatusIcon profileStatusIcon--${esc(String(me.playerStatus||"ACTIVE").toLowerCase())}" aria-hidden="true">${playerStatusIcon(me.playerStatus)}</span>${esc(String(me.playerStatus||"ACTIVE")[0]+String(me.playerStatus||"ACTIVE").slice(1).toLowerCase())}</strong><small>Only Active players can update match availability.</small></span><b aria-hidden="true">Change ›</b></button>
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="goMatches">${returnHash ? "Back to availability" : "Go to matches"}</button>
          <button class="btn gray" id="goSeason">My season</button>
          <button class="btn gray" id="updateApp">Update app</button>
          <button class="btn gray" id="logout">Logout</button>
        </div>
      </div>

      <div class="card">
        <div class="notificationHeader"><div class="h1">Notifications</div><button class="btn gray" id="clearNotifications" type="button" hidden>Clear all</button></div>
        <div class="small" id="pushStatus"></div>
        <div class="row" id="pushActions" style="margin-top:10px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="enablePush">Enable phone notifications</button>
          <button class="btn gray" id="testPush" hidden>Send test notification</button>
        </div>
        <div class="small" id="notiMsg" role="status" aria-live="polite">Loading…</div>
        <div id="notiList" style="margin-top:10px"></div>
        <button class="btn gray notificationMore" id="showMoreNotifications" type="button" hidden>Show more</button>
      </div>
      <dialog id="announcementDialog" class="playerDialog" aria-label="Registration page">
        <div class="announcementViewer"><div class="announcementViewer__head"><div><div class="small">Club announcement</div><div class="h1" id="announcementDialogTitle">Registration</div></div><button class="btn gray" id="closeAnnouncementDialog">Close</button></div><iframe id="announcementFrame" title="External registration page" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe></div>
      </dialog>
      <dialog id="profileEmailDialog" class="requiredPhotoDialog" aria-labelledby="profileEmailTitle">
        <div class="requiredPhotoSheet">
          <div class="requiredEmailIcon" aria-hidden="true">@</div>
          <div class="h1" id="profileEmailTitle">Change email address</div>
          <p>This address will be used only for account recovery and important club account messages.</p>
          <input id="profileEmail" class="input" type="email" maxlength="254" autocomplete="email" value="${esc(me.email || "")}" placeholder="you@example.com" />
          <button class="btn primary requiredPhotoChoose" id="saveEmail" type="button">Save email</button>
          <div class="small" id="emailStatus" role="status" aria-live="polite"></div>
          <button class="requiredPhotoLogout" id="closeEmailDialog" type="button">Cancel</button>
        </div>
      </dialog>
      <dialog id="statusDialog" class="requiredPhotoDialog" aria-labelledby="statusDialogTitle"><div class="requiredPhotoSheet"><div class="stepEyebrow">Availability</div><div class="h1" id="statusDialogTitle">Set player status</div><p>Choose the status that best reflects whether you can play.</p><div class="profileStatus__choices" role="radiogroup" aria-label="Player status">${["ACTIVE","INJURED","UNAVAILABLE","INACTIVE"].map(status=>`<button class="profileStatus__choice${String(me.playerStatus||"ACTIVE")===status?" is-active":""}" type="button" role="radio" aria-checked="${String(me.playerStatus||"ACTIVE")===status}" data-player-status="${status}"><span class="profileStatusIcon profileStatusIcon--${status.toLowerCase()}" aria-hidden="true">${playerStatusIcon(status)}</span>${status[0]+status.slice(1).toLowerCase()}</button>`).join("")}</div><div class="small">Active lets you answer match availability. After 10 consecutive missed club matches, Active changes automatically to Inactive.</div><button class="requiredPhotoLogout" id="closeStatusDialog" type="button">Cancel</button></div></dialog>
      <dialog id="profilePhoneDialog" class="requiredPhotoDialog" aria-labelledby="profilePhoneTitle">
        <div class="requiredPhotoSheet">
          <div class="requiredPhoneIcon" aria-hidden="true">☎</div>
          <div class="h1" id="profilePhoneTitle">Change WhatsApp number</div>
          <p>Choose the country code, then enter the number without the leading zero.</p>
          <div class="phoneField"><select id="profileCountry" class="input" aria-label="Country code">${countryOptions(savedPhone.country)}</select><input id="profilePhone" class="input" inputmode="tel" pattern="[0-9]*" maxlength="14" autocomplete="tel-national" value="${esc(savedPhone.local)}" aria-label="Phone number" /></div>
          <button class="btn primary requiredPhotoChoose" id="savePhone" type="button">Save number</button>
          <div class="small" id="phoneStatus" role="status" aria-live="polite"></div>
          <button class="requiredPhotoLogout" id="closePhoneDialog" type="button">Cancel</button>
        </div>
      </dialog>
      <dialog id="passwordDialog" class="requiredPhotoDialog" aria-labelledby="passwordDialogTitle">
        <div class="requiredPhotoSheet">
          <div class="requiredPasswordIcon" aria-hidden="true"></div>
          <div class="h1" id="passwordDialogTitle">Change password</div>
          <p>Enter your current password, then choose a new one you will remember.</p>
          <div class="profileDialogFields">
            <div class="field">
              <label class="field__label" for="oldPass">Current password</label>
              <input id="oldPass" type="password" class="input" autocomplete="current-password" />
            </div>
            <div class="field">
              <label class="field__label" for="newPass">New password</label>
              <input id="newPass" type="password" class="input" autocomplete="new-password" aria-describedby="passHelp passMsg" />
              <div class="field__help" id="passHelp">Any non-empty password is accepted.</div>
            </div>
          </div>
          <button class="btn primary requiredPhotoChoose" id="changePass" type="button">Update password</button>
          <div class="field__message" id="passMsg" role="status" aria-live="polite"></div>
          <button class="requiredPhotoLogout" id="closePasswordDialog" type="button">Cancel</button>
        </div>
      </dialog>
      ${me.photoUrl && (isSuperAdmin || (me.phone && me.email && me.emailVerifiedAt)) ? "" : `<dialog id="requiredProfileDialog" class="requiredPhotoDialog" aria-labelledby="requiredProfileTitle" aria-describedby="requiredProfileHelp">
        <div class="requiredPhotoSheet">
          <div class="requiredProfileIcon" aria-hidden="true">✓</div>
          <div class="stepEyebrow">Complete your profile</div>
          <div class="h1" id="requiredProfileTitle">Update your account details</div>
          <p id="requiredProfileHelp">Complete every item below before continuing.</p>
          <div class="requiredProfileFields">
            ${me.photoUrl ? "" : `<section><strong>Player photo</strong><span>Used on team sheets and POTM cards.</span><label class="btn primary" for="profilePhotoInput">Choose photo</label><small id="requiredPhotoStatus" role="status" aria-live="polite"></small></section>`}
            ${me.phone || isSuperAdmin ? "" : `<section><strong>WhatsApp number</strong><span>Choose the country code and enter the number without the leading zero.</span><div class="phoneField"><select id="requiredCountry" class="input" aria-label="Country code">${countryOptions("61")}</select><input id="requiredPhone" class="input" inputmode="tel" pattern="[0-9]*" maxlength="14" autocomplete="tel-national" placeholder="412 345 678" aria-label="Phone number" /></div><button class="btn primary" id="requiredPhoneSave" type="button">Save number</button><small id="requiredPhoneStatus" role="status" aria-live="polite"></small></section>`}
            ${me.emailVerifiedAt || isSuperAdmin ? "" : `<section><strong>Verify email address</strong><span>We’ll send a six-digit code for secure password recovery.</span><input id="requiredEmail" class="input" type="email" maxlength="254" autocomplete="email" value="${esc(me.email || "")}" placeholder="you@example.com" /><button class="btn primary" id="requiredEmailSave" type="button">${me.email ? "Resend verification code" : "Send verification code"}</button>${me.email ? `<input id="requiredEmailOtp" class="input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="Six-digit code" /><button class="btn primary" id="requiredEmailVerify" type="button">Verify email</button>` : ""}<small id="requiredEmailStatus" role="status" aria-live="polite"></small></section>`}
          </div>
          <button class="requiredPhotoLogout" id="requiredProfileLogout" type="button">Sign out instead</button>
        </div>
      </dialog>`}
    `;

    root.querySelector("#goMatches").onclick = () => (location.hash = returnHash || "#/match");
    root.querySelector("#goSeason").onclick = () => (location.hash = "#/season");
    const statusDialog=root.querySelector("#statusDialog");
    root.querySelector("#openStatusDialog").onclick=()=>statusDialog.showModal();
    root.querySelector("#closeStatusDialog").onclick=()=>statusDialog.close();
    if(query?.get?.("status")==="1") setTimeout(()=>statusDialog.showModal(),0);
    root.querySelectorAll("[data-player-status]").forEach(button=>button.onclick=async()=>{
      const next=button.dataset.playerStatus;
      if(next===String(me.playerStatus||"ACTIVE")) return;
      const message=next==="ACTIVE"?"Return to Active? You can update match availability again.":`Change your status to ${next[0]+next.slice(1).toLowerCase()}? Your future availability and unlocked team selections will be cleared.`;
      if(!window.confirm(message)) return;
      root.querySelectorAll("[data-player-status]").forEach(item=>item.disabled=true);
      const result=await API.userSetStatus(next).catch(()=>null);
      if(!result?.ok){toastError(result?.error||"Could not update status.");root.querySelectorAll("[data-player-status]").forEach(item=>item.disabled=false);return;}
      me={...me,playerStatus:result.playerStatus};setCachedUser(me);updateNavForUser(me);
      toastSuccess(`Status changed to ${result.playerStatus[0]+result.playerStatus.slice(1).toLowerCase()}`);
      const nextQuery = new URLSearchParams(query);
      nextQuery.delete("status");
      await renderLoginPage(root, nextQuery);
    });
    const cleanPhoneInput = input => input?.addEventListener("input", () => { input.value = String(input.value || "").replace(/\D+/g, ""); });
    const savePhone = async (country, input, status) => {
      const phone = internationalPhone(country, input);
      input.removeAttribute("aria-invalid");
      if (phone.length < 8 || phone.length > 15) { input.setAttribute("aria-invalid", "true"); status.textContent = "Enter a valid WhatsApp number."; input.focus(); return; }
      status.textContent = "Saving…";
      const result = await API.userSetPhone(phone).catch(() => null);
      if (!result?.ok) { status.textContent = result?.error || "Could not save the number."; return; }
      me = { ...me, phone: result.phone };
      setCachedUser(me); updateNavForUser(me);
      toastSuccess("WhatsApp number updated");
      await renderLoginPage(root, query);
    };
    const profilePhone = root.querySelector("#profilePhone");
    cleanPhoneInput(profilePhone);
    root.querySelector("#savePhone").onclick = () => savePhone(root.querySelector("#profileCountry"), profilePhone, root.querySelector("#phoneStatus"));
    const profilePhoneDialog = root.querySelector("#profilePhoneDialog");
    root.querySelector("#changePhone").onclick = () => profilePhoneDialog.showModal();
    root.querySelector("#closePhoneDialog").onclick = () => profilePhoneDialog.close();
    const saveEmail = async (input, status) => {
      const email = String(input?.value || "").trim().toLowerCase();
      input.removeAttribute("aria-invalid");
      if (!input.checkValidity() || !email) { input.setAttribute("aria-invalid", "true"); status.textContent = "Enter a valid email address."; input.focus(); return; }
      status.textContent = "Saving…";
      const result = await API.userSetEmail(email).catch(() => null);
      if (!result?.ok) { status.textContent = result?.error || "Could not save the email address."; return; }
      me = { ...me, email: result.email, emailVerifiedAt: result.emailVerifiedAt || "" };
      setCachedUser(me); updateNavForUser(me);
      toastSuccess("Email address updated");
      if (!result.emailVerifiedAt) await showEmailSentPrompt("verification");
      await renderLoginPage(root, query);
    };
    const profileEmailDialog = root.querySelector("#profileEmailDialog");
    root.querySelector("#changeEmail").onclick = () => profileEmailDialog.showModal();
    root.querySelector("#closeEmailDialog").onclick = () => profileEmailDialog.close();
    root.querySelector("#saveEmail").onclick = () => saveEmail(root.querySelector("#profileEmail"), root.querySelector("#emailStatus"));
    const passwordDialog = root.querySelector("#passwordDialog");
    root.querySelector("#openPasswordDialog").onclick = () => passwordDialog.showModal();
    root.querySelector("#closePasswordDialog").onclick = () => passwordDialog.close();
    const photoInput = root.querySelector("#profilePhotoInput");
    const photoStatus = root.querySelector("#profilePhotoStatus");
    const requiredPhotoStatus = root.querySelector("#requiredPhotoStatus");
    const setPhotoStatus = message => {
      photoStatus.textContent = message;
      if (requiredPhotoStatus) requiredPhotoStatus.textContent = message;
    };
    photoInput.onchange = async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      photoInput.disabled = true;
      setPhotoStatus("Adjust the crop around your face…");
      try {
        const blob = await choosePhotoCrop(file, root);
        if (!blob) { setPhotoStatus("A profile photo is required. Choose a photo when you’re ready."); return; }
        setPhotoStatus("Uploading photo…");
        const result = await API.userSetPhoto(blob);
        if (!result?.ok) throw new Error(result?.error || "Could not upload photo.");
        const updated = { ...me, photoUrl: result.photoUrl, photoUpdatedAt: result.photoUpdatedAt };
        invalidatePlayerPhotoCaches();
        setCachedUser(updated); updateNavForUser(updated);
        toastSuccess("Profile photo updated");
        await renderLoginPage(root, query);
      } catch (error) {
        setPhotoStatus(error?.message || "Could not upload photo.");
        toastError(error?.message || "Could not upload photo.");
      } finally { photoInput.disabled = false; photoInput.value = ""; }
    };
    const logout = async () => {
      await API.logout().catch(() => {});
      clearAuth();
      updateNavForUser(null);
      try { localStorage.removeItem("mlfc_notifications_cache_v1"); } catch {}
      try {
        document.querySelectorAll('a[href="#/login"], [data-tab="register"], a.bottomnav__item[href="#/login"]').forEach(a => a.classList.remove("has-noti"));
      } catch {}
      toastSuccess("Logged out");
      location.hash = `#/login?logout=${Date.now()}`;
    };
    root.querySelector("#logout").onclick = logout;
    root.querySelector("#requiredProfileLogout")?.addEventListener("click", logout);
    const requiredPhone = root.querySelector("#requiredPhone");
    cleanPhoneInput(requiredPhone);
    root.querySelector("#requiredPhoneSave")?.addEventListener("click", () => savePhone(root.querySelector("#requiredCountry"), requiredPhone, root.querySelector("#requiredPhoneStatus")));
    root.querySelector("#requiredEmailSave")?.addEventListener("click", () => saveEmail(root.querySelector("#requiredEmail"), root.querySelector("#requiredEmailStatus")));
    const requiredEmailOtp = root.querySelector("#requiredEmailOtp");
    requiredEmailOtp?.addEventListener("input", () => { requiredEmailOtp.value = requiredEmailOtp.value.replace(/\D+/g, ""); });
    root.querySelector("#requiredEmailVerify")?.addEventListener("click", async () => {
      const status = root.querySelector("#requiredEmailStatus");
      const otp = String(requiredEmailOtp?.value || "").trim();
      if (!/^\d{6}$/.test(otp)) { status.textContent = "Enter the six-digit code from the email."; requiredEmailOtp?.focus(); return; }
      status.textContent = "Verifying…";
      const result = await API.userVerifyEmail(otp).catch(() => null);
      if (!result?.ok) { status.textContent = result?.error || "Could not verify the email address."; return; }
      me = { ...me, email: result.email, emailVerifiedAt: result.emailVerifiedAt };
      setCachedUser(me); updateNavForUser(me);
      toastSuccess("Email address verified");
      await renderLoginPage(root, query);
    });
    const requiredProfileDialog = root.querySelector("#requiredProfileDialog");
    if (requiredProfileDialog) {
      requiredProfileDialog.addEventListener("cancel", event => event.preventDefault());
      if (typeof requiredProfileDialog.showModal === "function") requiredProfileDialog.showModal();
    }

    // Force update: clear SW + browser Cache Storage + most local caches, then reload.
    root.querySelector("#updateApp").onclick = async () => {
      try {
        toastInfo("Updating… clearing cached assets and refreshing.");

        // Preserve auth token, but force refetch of user + all cached API/UI state.
        const keepToken = getToken();

        // Clear app local caches (keep token, drop cached user so /me refetches)
        try {
          const keys = Object.keys(localStorage || {});
          for (const k of keys) {
            if (k === "mlfc_token_v1") continue;
            // Clear all app caches (rosters, teams, notifications, leaderboard, etc.)
            if (String(k).startsWith("mlfc_")) localStorage.removeItem(k);
          }
          if (keepToken) setToken(keepToken);
        } catch {}

        // Best-effort clear sessionStorage too
        try { sessionStorage.clear(); } catch {}

        // Clear IndexedDB databases if supported (best-effort)
        try {
          if (indexedDB?.databases) {
            const dbs = await indexedDB.databases();
            await Promise.all((dbs || []).map(d => d?.name ? new Promise(res => {
              const req = indexedDB.deleteDatabase(d.name);
              req.onsuccess = req.onerror = req.onblocked = () => res();
            }) : Promise.resolve()));
          }
        } catch {}

        // Clear Cache Storage from the page context
        try {
          if ("caches" in window) {
            const ckeys = await caches.keys();
            await Promise.all(ckeys.map(k => caches.delete(k)));
          }
        } catch {}

        // Tell the SW to clear caches and activate any waiting update
        try {
          if (navigator.serviceWorker?.getRegistrations) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
              try { reg.active?.postMessage({ type: "CLEAR_CACHES" }); } catch {}
              try { reg.waiting?.postMessage({ type: "SKIP_WAITING" }); } catch {}
              try { await reg.update(); } catch {}
            }
          }
        } catch {}

        // Force fresh user info from API after caches cleared (token preserved)
        try { await refreshMe(true); } catch {}

        // Reload under the newest SW/controller
        let reloaded = false;
        const onCtrl = () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        };
        try { navigator.serviceWorker?.addEventListener("controllerchange", onCtrl); } catch {}

        // Fallback reload (if controllerchange doesn't fire)
        setTimeout(() => {
          if (!reloaded) {
            toastWarn("Reloading…");
            window.location.reload();
          }
        }, 800);
      } catch (e) {
        toastError(e?.message || "Update failed");
      }
    };
    root.querySelector("#changePass").onclick = async () => {
      const oldPassword = root.querySelector("#oldPass").value.trim();
      const newPassword = root.querySelector("#newPass").value.trim();
      const newPasswordEl = root.querySelector("#newPass");
      const msg = root.querySelector("#passMsg");
      newPasswordEl.removeAttribute("aria-invalid");
      if (!newPassword) {
        newPasswordEl.setAttribute("aria-invalid", "true");
        msg.textContent = "Enter a new password.";
        newPasswordEl.focus();
        return;
      }
      msg.textContent = "Updating…";
      const res = await API.userSetPassword(oldPassword, newPassword).catch(() => null);
      if (!res?.ok) { msg.textContent = res?.error || "Failed"; toastError(res?.error || "Failed"); return; }
      msg.textContent = "Updated ✅";
      toastSuccess("Password updated");
      root.querySelector("#oldPass").value = "";
      root.querySelector("#newPass").value = "";
      passwordDialog.close();
    };

    const pushStatus = root.querySelector("#pushStatus");
    const enablePush = root.querySelector("#enablePush");
    const testPush = root.querySelector("#testPush");
    const support = pushSupport();
    const updatePushUi = () => {
      const permission = support.supported ? Notification.permission : "unsupported";
      if (!support.supported) {
        pushStatus.textContent = support.reason;
        enablePush.hidden = true;
        return;
      }
      if (permission === "granted") {
        pushStatus.textContent = "Phone notifications are enabled on this device.";
        enablePush.hidden = true;
        testPush.hidden = false;
      } else if (permission === "denied") {
        pushStatus.textContent = "Notifications are blocked. Allow them for this app in your phone settings.";
        enablePush.textContent = "Try again";
      } else {
        pushStatus.textContent = "Enable alerts to receive updates even when the app is closed. On iPhone, first add this site to your Home Screen and open it there.";
      }
    };
    updatePushUi();

    enablePush.onclick = async () => {
      enablePush.disabled = true;
      pushStatus.textContent = "Enabling notifications…";
      try {
        const result = await ensurePushSubscribed({ requestPermission: true });
        if (!result.ok) throw new Error(result.error);
        updatePushUi();
        toastSuccess("Phone notifications enabled");
      } catch (e) {
        pushStatus.textContent = e?.message || "Could not enable phone notifications.";
        toastError(pushStatus.textContent);
      } finally {
        enablePush.disabled = false;
      }
    };

    testPush.onclick = async () => {
      testPush.disabled = true;
      pushStatus.textContent = "Sending a test notification…";
      try {
        await ensurePushSubscribed();
        const result = await API.pushTest();
        if (!result?.ok || !result.sent) throw new Error(result?.errors?.[0] || "No push subscription was reached.");
        pushStatus.textContent = "Test sent. It should appear in your phone notifications shortly.";
      } catch (e) {
        pushStatus.textContent = e?.message || "Could not send the test notification.";
        toastError(pushStatus.textContent);
      } finally {
        testPush.disabled = false;
      }
    };

    // Notifications stay visible until the player explicitly clears or opens them.
    const msg = root.querySelector("#notiMsg");
    const list = root.querySelector("#notiList");
    const clearAll = root.querySelector("#clearNotifications");
    const showMore = root.querySelector("#showMoreNotifications");
    let items = [];
    let visibleCount = 10;
    let clearing = false;
    const oneWeekAgo = () => Date.now() - 7 * 24 * 60 * 60 * 1000;
    const currentNotifications = notifications => notifications.filter(notification => {
      const createdAt = new Date(notification.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= oneWeekAgo();
    });
    const notificationGroup = createdAt => {
      const date = new Date(createdAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const dateKey = value => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
      if (dateKey(date) === dateKey(today)) return "Today";
      if (dateKey(date) === dateKey(yesterday)) return "Yesterday";
      return "Earlier this week";
    };
    const renderNoti = () => {
      items = currentNotifications(items);
      const visibleItems = items.slice(0, visibleCount);
      clearAll.hidden = !items.length;
      clearAll.disabled = clearing;
      showMore.hidden = visibleItems.length >= items.length;
      showMore.disabled = clearing;
      msg.textContent = items.length ? `${items.length} notification${items.length === 1 ? "" : "s"} · Swipe left or right to clear` : "You’re all caught up.";
      document.querySelectorAll('a[href="#/login"], [data-tab="register"]').forEach(a => a.classList.toggle("has-noti", items.length > 0));
      let activeGroup = "";
      list.innerHTML = visibleItems.map(n => {
        const link = safeHttpsUrl(n.linkUrl);
        const embed = safeHttpsUrl(n.embedUrl);
        const appLink = link && new URL(link).origin === location.origin && new URL(link).hash.startsWith("#/captain?") ? new URL(link).hash : "";
        const date = new Date(n.createdAt);
        const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const group = notificationGroup(n.createdAt);
        const groupHeading = group === activeGroup ? "" : `<div class="notificationGroupTitle">${esc(group)}</div>`;
        activeGroup = group;
        return `${groupHeading}<div class="notificationSwipe"><div class="notificationSwipe__hint" aria-hidden="true"><span>✓ Clear</span><span>Clear ✓</span></div>
          <article class="notificationCard" data-notification-id="${esc(n.id)}" tabindex="-1">
            ${safeHttpsUrl(n.imageUrl) ? `<img class="notificationCard__image" src="${esc(safeHttpsUrl(n.imageUrl))}" alt="" loading="lazy" decoding="async">` : ""}
            <div class="notificationCard__head"><div class="notificationCard__title">${esc(n.title || "Club update")}</div><button class="notificationCard__clear" type="button" data-close="${esc(n.id)}" aria-label="Clear notification: ${esc(n.title || "Club update")}"><span aria-hidden="true">×</span> Clear</button></div>
            <div class="notificationCard__message">${esc(n.message)}</div>
            <div class="small">${esc(when)}</div>
            <div class="notificationCard__actions">${appLink ? `<button class="btn primary" data-open-captain="${esc(appLink)}">Open captain page</button>` : n.publicCode || n.matchCode ? `<button class="btn primary" data-open="${esc(n.publicCode || n.matchCode)}">Open match</button>` : `${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ""}${embed ? `<button class="btn gray" data-embed-url="${esc(embed)}" data-embed-title="${esc(n.title || "Registration")}">Open here</button>` : ""}`}</div>
          </article></div>`;
      }).join("");
      list.querySelectorAll(".notificationCard").forEach(card => {
        let gesture = null;
        card.onpointerdown = event => {
          if (clearing || event.pointerType === "mouse" || !event.isPrimary || event.target.closest("button, a")) return;
          gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, axis: "" };
        };
        card.onpointermove = event => {
          if (!gesture || gesture.id !== event.pointerId) return;
          const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
          if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
            gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
            if (gesture.axis === "x") card.setPointerCapture(event.pointerId);
          }
          if (gesture.axis !== "x") return;
          gesture.dx = dx;
          card.classList.add("is-swiping");
          card.style.transform = `translateX(${dx}px)`;
        };
        const finish = event => {
          if (!gesture || gesture.id !== event.pointerId) return;
          const dismiss = event.type === "pointerup" && gesture.axis === "x" && Math.abs(gesture.dx) >= Math.min(100, card.clientWidth * .3);
          gesture = null;
          card.classList.remove("is-swiping");
          card.style.transform = "";
          if (dismiss) clearNotifications([card.dataset.notificationId]);
        };
        card.onpointerup = finish;
        card.onpointercancel = finish;
        card.onlostpointercapture = finish;
      });
    };
    const clearNotifications = async ids => {
      if (clearing || !ids.length) return false;
      clearing = true;
      clearAll.disabled = true;
      list.querySelectorAll("button").forEach(button => { button.disabled = true; });
      msg.textContent = "Clearing notifications…";
      try {
        const result = await API.notificationsMarkRead(ids);
        if (!result?.ok) throw new Error(result?.error || "Could not clear notifications. Try again.");
        const removed = new Set(ids.map(String));
        items = items.filter(n => !removed.has(String(n.id)));
        lsSet(LS_NOTI_CACHE, { ts: Date.now(), data: { ok: true, notifications: items } });
        return true;
      } catch (error) {
        toastError(error?.message || "Could not clear notifications. Try again.");
        return false;
      } finally {
        clearing = false;
        renderNoti();
        (list.querySelector("[data-close]") || msg).focus({ preventScroll: true });
      }
    };
    msg.tabIndex = -1;
    clearAll.onclick = () => clearNotifications(items.map(n => n.id));
    showMore.onclick = () => {
      visibleCount += 10;
      renderNoti();
      list.querySelectorAll(".notificationCard")[visibleCount - 10]?.focus({ preventScroll: true });
    };
    const dialog = root.querySelector("#announcementDialog");
    const frame = root.querySelector("#announcementFrame");
    root.querySelector("#closeAnnouncementDialog")?.addEventListener("click", () => { dialog.close(); frame.src = "about:blank"; });
    list.onclick = async event => {
      const button = event.target.closest("button");
      const link = event.target.closest("a");
      if (clearing) return;
      if (link && !button) {
        const card = link.closest(".notificationCard");
        if (card) clearNotifications([card.dataset.notificationId]);
        return;
      }
      if (!button) return;
      if (button.hasAttribute("data-close")) await clearNotifications([button.dataset.close]);
      else if (button.hasAttribute("data-open-captain")) {
        const destination = button.dataset.openCaptain;
        await clearNotifications([button.closest(".notificationCard").dataset.notificationId]);
        location.hash = destination;
      }
      else if (button.hasAttribute("data-open")) {
        const code = button.dataset.open;
        await clearNotifications([button.closest(".notificationCard").dataset.notificationId]);
        location.hash = `#/match?code=${encodeURIComponent(code)}`;
      } else if (button.hasAttribute("data-embed-url")) {
        const url = safeHttpsUrl(button.dataset.embedUrl);
        if (!url) return toastError("This registration link is not valid.");
        const title = button.dataset.embedTitle || "Registration";
        const notificationId = button.closest(".notificationCard").dataset.notificationId;
        await clearNotifications([notificationId]);
        root.querySelector("#announcementDialogTitle").textContent = title;
        frame.src = url;
        dialog.showModal();
      }
    };
    const cached = lsGet(LS_NOTI_CACHE)?.data?.notifications;
    if (Array.isArray(cached) && cached.length) {
      items = currentNotifications(cached);
      renderNoti();
    }
    // Keep cached cards read-only until the current list arrives.
    clearing = true;
    clearAll.disabled = true;
    const out = await API.notifications().catch(() => null);
    clearing = false;
    if (out?.ok) {
      items = currentNotifications(Array.isArray(out.notifications) ? out.notifications : []);
      lsSet(LS_NOTI_CACHE, { ts: Date.now(), data: { ...out, notifications: items } });
      renderNoti();
    } else {
      renderNoti();
      msg.textContent = out?.error || "Could not refresh notifications. Try reopening this page.";
    }
    return;
  }

  // Not logged in: show login/register
  updateNavForUser(null);
  root.innerHTML = `
    <section class="authWelcome">
      <div class="authWelcome__mark">ML</div>
      <div class="authWelcome__eyebrow">Your matchday starts here</div>
      <h1>Welcome back</h1>
      <p>Sign in to confirm availability, see your team and follow your season.</p>
    </section>

    <form class="card authForm" id="loginForm">
      <div class="field">
        <label class="field__label" for="name">Player name</label>
        <input id="name" class="input" autocomplete="username" maxlength="80" />
      </div>
      <div class="field">
        <label class="field__label" for="password">Password</label>
        <div class="passwordField"><input id="password" type="password" class="input" autocomplete="current-password" /><button class="passwordField__toggle" id="togglePassword" type="button" aria-pressed="false">Show</button></div>
      </div>
      <button id="loginBtn" class="btn primary authForm__submit" type="submit">Sign in</button>
      <button id="showReset" class="authForm__register" type="button">Forgot password?</button>
      <button id="showReg" class="authForm__register" type="button">New player? Create an account</button>
      <div id="msg" class="field__message" role="status" aria-live="polite"></div>
    </form>

    <div class="card" id="resetCard" style="display:none">
      <div class="h1">Reset password</div>
      <div class="small">Enter the email address saved on your player profile. We’ll send a six-digit code.</div>
      <div class="field"><label class="field__label" for="resetEmail">Email address</label><input id="resetEmail" class="input" type="email" maxlength="254" autocomplete="email" /></div>
      <button id="sendResetCode" class="btn primary" type="button">Send reset code</button>
      <div id="resetCodeFields" hidden>
        <div class="field"><label class="field__label" for="resetOtp">Six-digit code</label><input id="resetOtp" class="input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" /></div>
        <div class="field"><label class="field__label" for="resetNewPassword">New password</label><input id="resetNewPassword" class="input" type="password" autocomplete="new-password" /></div>
        <button id="completeReset" class="btn primary" type="button">Update password</button>
      </div>
      <button id="hideReset" class="btn gray" type="button" style="margin-top:10px">Back to sign in</button>
      <div id="resetMsg" class="field__message" role="status" aria-live="polite"></div>
    </div>

    <div class="card" id="regCard" style="display:none">
      <div class="h1">Register</div>
      <div class="small">Create your player account with any password you will remember.</div>
      <div class="field"><label class="field__label" for="rname">Player name</label><input id="rname" class="input" autocomplete="username" maxlength="80" /></div>
      <div class="field"><label class="field__label" for="rphone">WhatsApp number</label><div class="phoneField"><select id="rcountry" class="input" aria-label="Country code">${countryOptions("61")}</select><input id="rphone" class="input" inputmode="tel" pattern="[0-9]*" maxlength="14" autocomplete="tel-national" required aria-describedby="rphoneHelp rmsg" /></div><div class="field__help" id="rphoneHelp">Choose the country code, then enter the number without the leading zero.</div></div>
      <div class="field"><label class="field__label" for="rpass">Password</label><input id="rpass" type="password" class="input" autocomplete="new-password" aria-describedby="rpassHelp rmsg" /><div class="field__help" id="rpassHelp">Any non-empty password is accepted.</div></div>
      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
        <button id="regBtn" class="btn primary">Create account</button>
        <button id="hideReg" class="btn gray">Cancel</button>
      </div>
      <div id="rmsg" class="field__message" role="status" aria-live="polite"></div>
    </div>
  `;

  const nameEl = root.querySelector("#name");
  const passEl = root.querySelector("#password");
  const msgEl = root.querySelector("#msg");

  root.querySelector("#togglePassword").onclick = (event) => {
    const show = passEl.type === "password";
    passEl.type = show ? "text" : "password";
    event.currentTarget.textContent = show ? "Hide" : "Show";
    event.currentTarget.setAttribute("aria-pressed", String(show));
  };

  const regCard = root.querySelector("#regCard");
  const resetCard = root.querySelector("#resetCard");
  root.querySelector("#showReset").onclick = () => {
    regCard.style.display = "none";
    resetCard.style.display = "block";
    root.querySelector("#resetEmail")?.focus();
  };
  root.querySelector("#hideReset").onclick = () => { resetCard.style.display = "none"; nameEl.focus(); };
  root.querySelector("#sendResetCode").onclick = async () => {
    const emailInput = root.querySelector("#resetEmail");
    const resetMsg = root.querySelector("#resetMsg");
    const email = String(emailInput.value || "").trim().toLowerCase();
    emailInput.removeAttribute("aria-invalid");
    if (!emailInput.checkValidity() || !email) { emailInput.setAttribute("aria-invalid", "true"); resetMsg.textContent = "Enter a valid email address."; emailInput.focus(); return; }
    resetMsg.textContent = "Sending code…";
    const result = await API.requestPasswordReset(email).catch(() => null);
    if (!result?.ok) { resetMsg.textContent = result?.error || "Could not request a reset code."; return; }
    root.querySelector("#resetCodeFields").hidden = false;
    resetMsg.textContent = result.message || "If that email is registered, a reset code has been sent.";
    await showEmailSentPrompt("reset");
    root.querySelector("#resetOtp").focus();
  };
  root.querySelector("#resetOtp").addEventListener("input", event => { event.currentTarget.value = event.currentTarget.value.replace(/\D+/g, ""); });
  root.querySelector("#completeReset").onclick = async () => {
    const email = String(root.querySelector("#resetEmail").value || "").trim().toLowerCase();
    const otp = String(root.querySelector("#resetOtp").value || "").trim();
    const password = String(root.querySelector("#resetNewPassword").value || "").trim();
    const resetMsg = root.querySelector("#resetMsg");
    if (!/^\d{6}$/.test(otp)) { resetMsg.textContent = "Enter the six-digit code from the email."; root.querySelector("#resetOtp").focus(); return; }
    if (!password) { resetMsg.textContent = "Enter a new password."; root.querySelector("#resetNewPassword").focus(); return; }
    resetMsg.textContent = "Updating password…";
    const result = await API.resetPassword(email, otp, password).catch(() => null);
    if (!result?.ok) { resetMsg.textContent = result?.error || "Could not reset the password."; return; }
    toastSuccess("Password updated. Sign in with your new password.");
    resetCard.style.display = "none";
    nameEl.focus();
  };
  root.querySelector("#showReg").onclick = () => {
    resetCard.style.display = "none";
    regCard.style.display = "block";
    root.querySelector("#rname")?.focus();
  };
  root.querySelector("#hideReg").onclick = () => (regCard.style.display = "none");

  root.querySelector("#loginForm").onsubmit = async (event) => {
    event.preventDefault();
    const name = nameEl.value.replace(/\s+/g, " ").trim();
    const password = passEl.value.trim();
    nameEl.removeAttribute("aria-invalid");
    passEl.removeAttribute("aria-invalid");
    if (!name || !password) {
      const invalid = !name ? nameEl : passEl;
      invalid.setAttribute("aria-invalid", "true");
      msgEl.textContent = !name ? "Enter your player name." : "Enter your password.";
      invalid.focus();
      return;
    }
    msgEl.textContent = "Signing in…";
    const res = await API.login(name, password);
    if (!res?.ok) {
      msgEl.textContent = res?.error || "Sign in failed";
      toastError(res?.error || "Sign in failed");
      return;
    }
    setToken(res.token);
    setCachedUser(res.user);
    updateNavForUser(res.user);
    toastSuccess("Logged in");
    if (res.user?.photoUrl) {
      await showInitialPushEnableReminder(root);
      location.hash = "#/match";
    } else {
      location.hash = "#/login?photo=required";
    }
  };

  
  // Phone: allow digits only (no letters/symbols)
  const rphoneEl = root.querySelector("#rphone");
  if (rphoneEl) {
    rphoneEl.addEventListener("input", () => {
      const cleaned = String(rphoneEl.value || "").replace(/\D+/g, "");
      if (cleaned !== rphoneEl.value) rphoneEl.value = cleaned;
    });
  }

const rmsg = root.querySelector("#rmsg");
  root.querySelector("#regBtn").onclick = async () => {
    const rnameEl = root.querySelector("#rname");
    const rpassEl = root.querySelector("#rpass");
    const name = rnameEl.value.replace(/\s+/g, " ").trim();
    const phone = internationalPhone(root.querySelector("#rcountry"), rphoneEl);
    const password = rpassEl.value.trim();
    rnameEl.removeAttribute("aria-invalid");
    rpassEl.removeAttribute("aria-invalid");
    rphoneEl.removeAttribute("aria-invalid");
    if (!name) {
      rnameEl.setAttribute("aria-invalid", "true");
      rmsg.textContent = "Enter the player name for this account.";
      rnameEl.focus();
      return;
    }
    if (phone.length < 8 || phone.length > 15) {
      rphoneEl.setAttribute("aria-invalid", "true");
      rmsg.textContent = "Enter a valid WhatsApp number.";
      rphoneEl.focus();
      return;
    }
    if (!password) {
      rpassEl.setAttribute("aria-invalid", "true");
      rmsg.textContent = "Enter a password.";
      rpassEl.focus();
      return;
    }
    rmsg.textContent = "Creating account…";
    const res = await API.registerUser(name, password, phone);
    if (!res?.ok) {
      rmsg.textContent = res?.error || "Registration failed";
      toastError(res?.error || "Registration failed");
      return;
    }
    setToken(res.token);
    setCachedUser(res.user);
    updateNavForUser(res.user);
    toastSuccess("Registered & logged in");
    if (res.user?.photoUrl) {
      await showInitialPushEnableReminder(root);
      location.hash = "#/match";
    } else {
      location.hash = "#/login?photo=required";
    }
  };
}
