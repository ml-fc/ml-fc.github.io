import { API } from "../api/endpoints.js";
import { clearAuth, setCachedUser, setToken, getToken, getCachedUser, refreshMe, updateNavForUser } from "../auth.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { lsGet, lsSet } from "../storage.js";
import { isReloadFor } from "../nav_state.js";
import { ensurePushSubscribed, pushSupport } from "../push.js";
import { showPushEnableReminder } from "../ui/push_reminder.js";
import { choosePhotoCrop, invalidatePlayerPhotoCaches, playerPhotoHtml } from "../ui/player_photo.js";

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

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
}

function safeHttpsUrl(value) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}

export async function renderLoginPage(root) {
  const token = getToken();
  let me = getCachedUser();
  if (token && !me) me = await refreshMe().catch(() => null);

  // If logged in already, show account page + logout
  if (token && me) {
    const savedPhone = phoneParts(me.phone);
    const isSuperAdmin = String(me.name || "").trim().toLowerCase() === "admin";
    updateNavForUser(me);
    root.innerHTML = `
      <div class="card">
        <div class="profileIdentity">
          ${playerPhotoHtml(me.name, me.photoUrl, "playerPhoto playerPhoto--profile")}
          <div><div class="stepEyebrow">Player profile</div><div class="h1">${esc(me.name)}</div><div class="small">${me.isAdmin ? "<span class=\"badge\">ADMIN</span> · " : ""}Your photo appears on team sheets and POTM cards.</div></div>
        </div>
        <div class="profilePhotoActions">
          <label class="btn primary" for="profilePhotoInput">${me.photoUrl ? "Change photo" : "Add photo"}</label>
          <input id="profilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          <span class="small" id="profilePhotoStatus" role="status" aria-live="polite">Choose a clear photo, then crop closely around your face for the best view.</span>
        </div>
        <div class="profilePhotoActions">
          <div class="field" style="flex:1 1 280px;margin:0"><label class="field__label" for="profilePhone">WhatsApp number</label><div class="phoneField"><select id="profileCountry" class="input" aria-label="Country code">${countryOptions(savedPhone.country)}</select><input id="profilePhone" class="input" inputmode="tel" pattern="[0-9]*" maxlength="14" autocomplete="tel-national" value="${esc(savedPhone.local)}" aria-label="Phone number" /></div><div class="field__help">Choose the country code, then enter the number without the leading zero.</div></div>
          <button class="btn primary" id="savePhone" type="button">${me.phone ? "Update number" : "Save number"}</button>
          <span class="small" id="phoneStatus" role="status" aria-live="polite"></span>
        </div>
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="goMatches">Go to matches</button>
          <button class="btn gray" id="goSeason">My season</button>
          <button class="btn gray" id="updateApp">Update app</button>
          <button class="btn gray" id="logout">Logout</button>
        </div>
      </div>

      <div class="card">
        <div class="h1">Change password</div>
        <div class="small">Choose any password you will remember.</div>
        <div class="field">
          <label class="field__label" for="oldPass">Current password</label>
          <input id="oldPass" type="password" class="input" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="field__label" for="newPass">New password</label>
          <input id="newPass" type="password" class="input" autocomplete="new-password" aria-describedby="passHelp passMsg" />
          <div class="field__help" id="passHelp">Any non-empty password is accepted.</div>
        </div>
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="changePass">Update password</button>
        </div>
        <div class="field__message" id="passMsg" role="status" aria-live="polite"></div>
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
      </div>
      <dialog id="announcementDialog" class="playerDialog" aria-label="Registration page">
        <div class="announcementViewer"><div class="announcementViewer__head"><div><div class="small">Club announcement</div><div class="h1" id="announcementDialogTitle">Registration</div></div><button class="btn gray" id="closeAnnouncementDialog">Close</button></div><iframe id="announcementFrame" title="External registration page" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe></div>
      </dialog>
      ${me.photoUrl ? "" : `<dialog id="requiredPhotoDialog" class="requiredPhotoDialog" aria-labelledby="requiredPhotoTitle" aria-describedby="requiredPhotoHelp">
        <div class="requiredPhotoSheet">
          <div class="requiredPhotoIcon" aria-hidden="true">${esc(String(me.name || "?").trim().slice(0, 1).toUpperCase() || "?")}</div>
          <div class="stepEyebrow">One last step</div>
          <div class="h1" id="requiredPhotoTitle">Add your player photo</div>
          <p id="requiredPhotoHelp">A clear face photo is required before continuing. It helps teammates identify you on team sheets and POTM cards.</p>
          <label class="btn primary requiredPhotoChoose" for="profilePhotoInput">Choose a photo</label>
          <div class="small" id="requiredPhotoStatus" role="status" aria-live="polite">You’ll be able to move, zoom and check the crop before uploading.</div>
          <button class="requiredPhotoLogout" id="requiredPhotoLogout" type="button">Sign out instead</button>
        </div>
      </dialog>`}
      ${me.phone || isSuperAdmin ? "" : `<dialog id="requiredPhoneDialog" class="requiredPhotoDialog" aria-labelledby="requiredPhoneTitle" aria-describedby="requiredPhoneHelp">
        <div class="requiredPhotoSheet">
          <div class="requiredPhoneIcon" aria-hidden="true">☎</div>
          <div class="stepEyebrow">One last step</div>
          <div class="h1" id="requiredPhoneTitle">Add your WhatsApp number</div>
          <p id="requiredPhoneHelp">A WhatsApp number is now required so your account is ready for future WhatsApp login.</p>
          <div class="phoneField"><select id="requiredCountry" class="input" aria-label="Country code">${countryOptions("61")}</select><input id="requiredPhone" class="input" inputmode="tel" pattern="[0-9]*" maxlength="14" autocomplete="tel-national" placeholder="412 345 678" aria-label="Phone number" /></div>
          <button class="btn primary requiredPhotoChoose" id="requiredPhoneSave" type="button">Save and continue</button>
          <div class="small" id="requiredPhoneStatus" role="status" aria-live="polite">Include the country code if this is not an Australian number.</div>
          <button class="requiredPhotoLogout" id="requiredPhoneLogout" type="button">Sign out instead</button>
        </div>
      </dialog>`}
    `;

    root.querySelector("#goMatches").onclick = () => (location.hash = "#/match");
    root.querySelector("#goSeason").onclick = () => (location.hash = "#/season");
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
      await renderLoginPage(root);
    };
    const profilePhone = root.querySelector("#profilePhone");
    cleanPhoneInput(profilePhone);
    root.querySelector("#savePhone").onclick = () => savePhone(root.querySelector("#profileCountry"), profilePhone, root.querySelector("#phoneStatus"));
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
        await renderLoginPage(root);
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
    root.querySelector("#requiredPhotoLogout")?.addEventListener("click", logout);
    root.querySelector("#requiredPhoneLogout")?.addEventListener("click", logout);
    const requiredPhone = root.querySelector("#requiredPhone");
    cleanPhoneInput(requiredPhone);
    root.querySelector("#requiredPhoneSave")?.addEventListener("click", () => savePhone(root.querySelector("#requiredCountry"), requiredPhone, root.querySelector("#requiredPhoneStatus")));
    const requiredPhoneDialog = root.querySelector("#requiredPhoneDialog");
    if (requiredPhoneDialog) {
      requiredPhoneDialog.addEventListener("cancel", event => event.preventDefault());
      if (typeof requiredPhoneDialog.showModal === "function") requiredPhoneDialog.showModal();
    }
    const requiredPhotoDialog = root.querySelector("#requiredPhotoDialog");
    if (requiredPhotoDialog && !requiredPhoneDialog) {
      requiredPhotoDialog.addEventListener("cancel", event => event.preventDefault());
      if (typeof requiredPhotoDialog.showModal === "function") requiredPhotoDialog.showModal();
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
    let items = [];
    let clearing = false;
    const renderNoti = () => {
      clearAll.hidden = !items.length;
      clearAll.disabled = clearing;
      msg.textContent = items.length ? `${items.length} notification${items.length === 1 ? "" : "s"} · Swipe left or right to clear` : "You’re all caught up.";
      document.querySelectorAll('a[href="#/login"], [data-tab="register"]').forEach(a => a.classList.toggle("has-noti", items.length > 0));
      list.innerHTML = items.map(n => {
        const link = safeHttpsUrl(n.linkUrl);
        const embed = safeHttpsUrl(n.embedUrl);
        const appLink = link && new URL(link).origin === location.origin && new URL(link).hash.startsWith("#/captain?") ? new URL(link).hash : "";
        const date = new Date(n.createdAt);
        const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        return `<div class="notificationSwipe"><div class="notificationSwipe__hint" aria-hidden="true"><span>✓ Clear</span><span>Clear ✓</span></div>
          <article class="notificationCard" data-notification-id="${esc(n.id)}">
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
    const dialog = root.querySelector("#announcementDialog");
    const frame = root.querySelector("#announcementFrame");
    root.querySelector("#closeAnnouncementDialog")?.addEventListener("click", () => { dialog.close(); frame.src = "about:blank"; });
    list.onclick = async event => {
      const button = event.target.closest("button");
      if (!button || clearing) return;
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
        root.querySelector("#announcementDialogTitle").textContent = button.dataset.embedTitle || "Registration";
        frame.src = url;
        dialog.showModal();
      }
    };
    const cached = lsGet(LS_NOTI_CACHE)?.data?.notifications;
    if (Array.isArray(cached) && cached.length) {
      items = cached;
      renderNoti();
    }
    // Keep cached cards read-only until the current list arrives.
    clearing = true;
    clearAll.disabled = true;
    const out = await API.notifications().catch(() => null);
    clearing = false;
    if (out?.ok) {
      items = Array.isArray(out.notifications) ? out.notifications : [];
      lsSet(LS_NOTI_CACHE, { ts: Date.now(), data: out });
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
      <button id="showReg" class="authForm__register" type="button">New player? Create an account</button>
      <div id="msg" class="field__message" role="status" aria-live="polite"></div>
    </form>

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
  root.querySelector("#showReg").onclick = () => {
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
      await showPushEnableReminder(root);
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
      await showPushEnableReminder(root);
      location.hash = "#/match";
    } else {
      location.hash = "#/login?photo=required";
    }
  };
}
