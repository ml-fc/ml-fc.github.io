import { API } from "../api/endpoints.js";
import { clearAuth, setCachedUser, setToken, getToken, getCachedUser, refreshMe, updateNavForUser } from "../auth.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { lsGet, lsSet } from "../storage.js";
import { isReloadFor } from "../nav_state.js";
import { ensurePushSubscribed, pushSupport } from "../push.js";
import { showPushEnableReminder } from "../ui/push_reminder.js";

const LS_NOTI_CACHE = "mlfc_notifications_cache_v1";

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
    updateNavForUser(me);
    root.innerHTML = `
      <div class="card">
        <div class="h1">Account</div>
        <div class="small">Logged in as <b>${me.name}</b>${me.isAdmin ? " • <span class=\"badge\">ADMIN</span>" : ""}</div>
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="goMatches">Go to matches</button>
          <button class="btn gray" id="updateApp">Update app</button>
          <button class="btn gray" id="logout">Logout</button>
        </div>
      </div>

      <section class="profileStats" aria-labelledby="profileStatsTitle">
        <div class="profileStats__head"><div><div class="small">Your season</div><div class="h1" id="profileStatsTitle">Personal statistics</div></div><span class="badge">PRIVATE</span></div>
        <div id="profileStatsBody" class="profileStats__loading" aria-live="polite">Loading your season…</div>
      </section>

      <div class="card">
        <div class="h1">Change password</div>
        <div class="small">Use at least 8 characters. Updating it signs in securely on this device.</div>
        <div class="field">
          <label class="field__label" for="oldPass">Current password</label>
          <input id="oldPass" type="password" class="input" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="field__label" for="newPass">New password</label>
          <input id="newPass" type="password" class="input" autocomplete="new-password" minlength="8" aria-describedby="passHelp passMsg" />
          <div class="field__help" id="passHelp">At least 8 characters.</div>
        </div>
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="changePass">Update password</button>
        </div>
        <div class="field__message" id="passMsg" role="status" aria-live="polite"></div>
      </div>
      <div class="card">
        <div class="h1">Notifications</div>
        <div class="small" id="pushStatus"></div>
        <div class="row" id="pushActions" style="margin-top:10px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="enablePush">Enable phone notifications</button>
          <button class="btn gray" id="testPush" hidden>Send test notification</button>
        </div>
        <div class="small" id="notiMsg">Loading…</div>
        <div id="notiList" style="margin-top:10px"></div>
      </div>
      <dialog id="announcementDialog" class="playerDialog" aria-label="Registration page">
        <div class="announcementViewer"><div class="announcementViewer__head"><div><div class="small">Club announcement</div><div class="h1" id="announcementDialogTitle">Registration</div></div><button class="btn gray" id="closeAnnouncementDialog">Close</button></div><iframe id="announcementFrame" title="External registration page" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe></div>
      </dialog>
    `;

    root.querySelector("#goMatches").onclick = () => (location.hash = "#/match");

    API.mySeasonStats().then((out) => {
      const host = root.querySelector("#profileStatsBody");
      if (!host) return;
      if (!out?.ok) { host.textContent = out?.error || "Could not load statistics."; return; }
      const s = out.summary || {};
      const rating = s.averageRating == null ? "—" : Number(s.averageRating).toFixed(1);
      const matches = out.matches || [];
      host.className = "";
      host.innerHTML = `
        <div class="profileStatGrid">
          <div><strong>${Number(s.appearances || 0)}</strong><span>Appearances</span></div>
          <div><strong>${Number(s.goals || 0)}</strong><span>Goals</span></div>
          <div><strong>${Number(s.assists || 0)}</strong><span>Assists</span></div>
          <div><strong>${esc(rating)}</strong><span>Avg rating</span></div>
        </div>
        <div class="profileStats__matches">
          ${matches.length ? matches.map((m) => `<article class="profileMatch">
            <div><b>${esc(m.title || "Match")}</b><span>${esc(m.date || "")} · ${esc(m.team || "Squad")}</span></div>
            <div class="profileMatch__score">${esc(m.scoreHome)}–${esc(m.scoreAway)}</div>
            <div class="profileMatch__numbers"><span>${Number(m.goals || 0)} G</span><span>${Number(m.assists || 0)} A</span><span>${m.rating == null ? "—" : Number(m.rating).toFixed(1)} ★</span></div>
          </article>`).join("") : `<div class="small">No completed appearances in this season yet.</div>`}
        </div>`;
    }).catch(() => {
      const host = root.querySelector("#profileStatsBody");
      if (host) host.textContent = "Could not load statistics.";
    });

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
    root.querySelector("#logout").onclick = async () => {
      await API.logout().catch(() => {});
      clearAuth();
      updateNavForUser(null);
      // Clear notifications cache + badge immediately on logout
      try { localStorage.removeItem("mlfc_notifications_cache_v1"); } catch {}
      try {
        document.querySelectorAll('a[href="#/login"], [data-tab="register"], a.bottomnav__item[href="#/login"]').forEach(a => a.classList.remove("has-noti"));
      } catch {}
      toastSuccess("Logged out");
      // Force a re-render even if we're already on #/login
      location.hash = `#/login?logout=${Date.now()}`;
    };

    root.querySelector("#changePass").onclick = async () => {
      const oldPassword = root.querySelector("#oldPass").value.trim();
      const newPassword = root.querySelector("#newPass").value.trim();
      const newPasswordEl = root.querySelector("#newPass");
      const msg = root.querySelector("#passMsg");
      newPasswordEl.removeAttribute("aria-invalid");
      if (newPassword.length < 8) {
        newPasswordEl.setAttribute("aria-invalid", "true");
        msg.textContent = "Enter a new password with at least 8 characters.";
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

    // notifications
    const msg = root.querySelector("#notiMsg");
    const list = root.querySelector("#notiList");

    const renderNoti = (items = []) => {
      if (!items.length) {
        msg.textContent = "No notifications.";
        list.innerHTML = "";
        try {
          document
            .querySelectorAll('a[href="#/login"], [data-tab="register"], nav.bottomnav a[href="#/login"], a.bottomnav__item[href="#/login"]')
            .forEach((a) => a.classList.remove("has-noti"));
        } catch {}
        return;
      }

      msg.textContent = "";
      list.innerHTML = items
        .map(
          (n) => {
          const linkUrl = safeHttpsUrl(n.linkUrl);
          const embedUrl = safeHttpsUrl(n.embedUrl);
          return `
        <article class="notificationCard">
          <div class="notificationCard__title">${esc(n.title || "Club update")}</div>
          <div class="notificationCard__message">${esc(n.message)}</div>
          <div class="small">${esc(n.createdAt)}</div>
          ${(n.publicCode || n.matchCode)
            ? `<div class="notificationCard__actions"><button class="btn primary" data-open="${esc(n.publicCode || n.matchCode)}">Open match</button><button class="btn gray iconButton" data-close="${esc(n.id)}" aria-label="Dismiss notification">×</button></div>`
            : `<div class="notificationCard__actions">${linkUrl ? `<a class="btn primary" href="${esc(linkUrl)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ""}${embedUrl ? `<button class="btn gray" data-embed-url="${esc(embedUrl)}" data-embed-title="${esc(n.title || "Registration")}">Open here</button>` : ""}<button class="btn gray iconButton" data-close="${esc(n.id)}" aria-label="Dismiss notification">×</button></div>`}
        </article>`; }
        )
        .join("");
    };

    // Fast path: show cached notifications immediately (if any), BUT always refetch.
    try {
      const cachedNoti = lsGet(LS_NOTI_CACHE);
      const cachedItems = cachedNoti?.data?.notifications || [];
      if (Array.isArray(cachedItems) && cachedItems.length) {
        renderNoti(cachedItems);
      } else {
        msg.textContent = "Loading…";
      }
    } catch {
      msg.textContent = "Loading…";
    }

    // Always refetch to avoid misleading badge vs. list mismatch.
    const out = await API.notifications().catch(() => null);
    if (!out?.ok) {
      msg.textContent = out?.error || "Failed to load notifications";
      list.innerHTML = "";
      return;
    }

    const items = out.notifications || [];
    lsSet(LS_NOTI_CACHE, { ts: Date.now(), data: out });
    renderNoti(items);
    const removeNoti = (id) => {
      try {
        const el = list.querySelector(`[data-close="${id}"]`)?.closest(".notificationCard");
        if (el) el.remove();
      } catch {}
      // Update cached notifications so it doesn't reappear.
      try {
        const c = lsGet(LS_NOTI_CACHE);
        const remaining = (c?.data?.notifications || items).filter(x => String(x.id) !== String(id));
        lsSet(LS_NOTI_CACHE, { ts: Date.now(), data: { ok: true, notifications: remaining } });
        try {
          document
            .querySelectorAll('a[href="#/login"], [data-tab="register"], nav.bottomnav a[href="#/login"], a.bottomnav__item[href="#/login"]')
            .forEach((a) => a.classList.toggle("has-noti", remaining.length > 0));
        } catch {}
      } catch {}
    };

    list.querySelectorAll("[data-open]").forEach((b) => {
      b.onclick = async () => {
        const code = b.getAttribute("data-open");
        const id = b.closest(".notificationCard")?.querySelector("[data-close]")?.getAttribute("data-close");
        if (id) {
          await API.notificationsMarkRead([id]).catch(() => {});
          removeNoti(id);
        }
        if (code) location.hash = `#/match?code=${encodeURIComponent(code)}`;
        else location.hash = "#/match";
      };
    });

    list.querySelectorAll("[data-close]").forEach((b) => {
      b.onclick = async () => {
        const id = b.getAttribute("data-close");
        if (!id) return;
        await API.notificationsMarkRead([id]).catch(() => {});
        removeNoti(id);
      };
    });

    const dialog = root.querySelector("#announcementDialog");
    const frame = root.querySelector("#announcementFrame");
    root.querySelector("#closeAnnouncementDialog")?.addEventListener("click", () => { dialog.close(); frame.src = "about:blank"; });
    list.querySelectorAll("[data-embed-url]").forEach(button => {
      button.onclick = () => {
        const url = safeHttpsUrl(button.dataset.embedUrl);
        if (!url) return toastError("This registration link is not valid.");
        root.querySelector("#announcementDialogTitle").textContent = button.dataset.embedTitle || "Registration";
        frame.src = url;
        dialog.showModal();
      };
    });

    await API.notificationsMarkRead(items.map((x) => x.id)).catch(() => {});
    return;
  }

  // Not logged in: show login/register
  updateNavForUser(null);
  root.innerHTML = `
    <div class="card">
      <div class="h1">Login</div>
      <div class="small">Login to post availability, view captain tools, and (if admin) access the admin panel.</div>
    </div>

    <div class="card">
      <div class="field">
        <label class="field__label" for="name">Player name</label>
        <input id="name" class="input" autocomplete="username" maxlength="80" />
      </div>
      <div class="field">
        <label class="field__label" for="password">Password</label>
        <input id="password" type="password" class="input" autocomplete="current-password" />
      </div>
      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
        <button id="loginBtn" class="btn primary">Login</button>
        <button id="showReg" class="btn gray">Register</button>
      </div>
      <div id="msg" class="field__message" role="status" aria-live="polite"></div>
    </div>

    <div class="card" id="regCard" style="display:none">
      <div class="h1">Register</div>
      <div class="small">Create your player account. Use at least 8 characters for your password.</div>
      <div class="field"><label class="field__label" for="rname">Player name</label><input id="rname" class="input" autocomplete="username" maxlength="80" /></div>
      <div class="field"><label class="field__label" for="rphone">Phone <span class="field__optional">Optional</span></label><input id="rphone" class="input" inputmode="numeric" pattern="[0-9]*" maxlength="15" autocomplete="tel" /></div>
      <div class="field"><label class="field__label" for="rpass">Password</label><input id="rpass" type="password" class="input" autocomplete="new-password" minlength="8" maxlength="128" aria-describedby="rpassHelp rmsg" /><div class="field__help" id="rpassHelp">Use at least 8 characters.</div></div>
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

  const regCard = root.querySelector("#regCard");
  root.querySelector("#showReg").onclick = () => {
    regCard.style.display = "block";
    root.querySelector("#rname")?.focus();
  };
  root.querySelector("#hideReg").onclick = () => (regCard.style.display = "none");

  root.querySelector("#loginBtn").onclick = async () => {
    const name = nameEl.value.replace(/\s+/g, " ").trim();
    const password = passEl.value;
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
      msgEl.textContent = res?.error || "Login failed";
      toastError(res?.error || "Login failed");
      return;
    }
    setToken(res.token);
    setCachedUser(res.user);
    updateNavForUser(res.user);
    toastSuccess("Logged in");
    await showPushEnableReminder(root);
    location.hash = "#/match";
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
    const phone = root.querySelector("#rphone").value.trim();
    const password = rpassEl.value;
    rnameEl.removeAttribute("aria-invalid");
    rpassEl.removeAttribute("aria-invalid");
    if (!name) {
      rnameEl.setAttribute("aria-invalid", "true");
      rmsg.textContent = "Enter the player name for this account.";
      rnameEl.focus();
      return;
    }
    if (password.length < 8) {
      rpassEl.setAttribute("aria-invalid", "true");
      rmsg.textContent = "Enter a password with at least 8 characters.";
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
    await showPushEnableReminder(root);
    location.hash = "#/match";
  };
}
