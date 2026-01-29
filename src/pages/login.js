import { API } from "../api/endpoints.js";
import { clearAuth, setCachedUser, setToken, getToken, getCachedUser, refreshMe, updateNavForUser } from "../auth.js";
import { toastSuccess, toastError, toastInfo, toastWarn } from "../ui/toast.js";
import { lsGet, lsSet } from "../storage.js";
import { isReloadFor } from "../nav_state.js";

const LS_NOTI_CACHE = "mlfc_notifications_cache_v1";

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

      <div class="card">
        <div class="h1">Change password</div>
        <div class="small">Update your password (stored in plain text in this demo build).</div>
        <input id="oldPass" type="password" class="input" placeholder="Current password" style="margin-top:10px" />
        <input id="newPass" type="password" class="input" placeholder="New password" style="margin-top:10px" />
        <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
          <button class="btn primary" id="changePass">Update password</button>
        </div>
        <div class="small" id="passMsg" style="margin-top:10px"></div>
      </div>
      <div class="card">
        <div class="h1">Notifications</div>
        <div class="small" id="notiMsg">Loading…</div>
        <div id="notiList" style="margin-top:10px"></div>
      </div>
    `;

    root.querySelector("#goMatches").onclick = () => (location.hash = "#/match");

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
      const msg = root.querySelector("#passMsg");
      if (!newPassword) { msg.textContent = "Enter a new password"; return; }
      msg.textContent = "Updating…";
      const res = await API.userSetPassword(oldPassword, newPassword).catch(() => null);
      if (!res?.ok) { msg.textContent = res?.error || "Failed"; toastError(res?.error || "Failed"); return; }
      msg.textContent = "Updated ✅";
      toastSuccess("Password updated");
      root.querySelector("#oldPass").value = "";
      root.querySelector("#newPass").value = "";
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
          (n) => `
        <div style="padding:10px 0; border-bottom:1px solid rgba(11,18,32,0.10)">
          <div style="font-weight:950">${n.message}</div>
          <div class="small">${n.createdAt}</div>
          ${(n.publicCode || n.matchCode)
            ? `<div class="row" style="margin-top:8px; gap:10px; justify-content:space-between; align-items:center"><button class="btn primary" data-open="${n.publicCode || n.matchCode}">Open match</button><button class="btn gray" data-close="${n.id}" style="padding:8px 10px; border-radius:12px">×</button></div>`
            : `<div class="row" style="margin-top:8px; justify-content:flex-end"><button class="btn gray" data-close="${n.id}" style="padding:8px 10px; border-radius:12px">×</button></div>`}
        </div>
      `
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
        const el = list.querySelector(`[data-close="${id}"]`)?.closest("div[style*='border-bottom']");
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
        const id = b.closest("div[style*='border-bottom']")?.querySelector("[data-close]")?.getAttribute("data-close");
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
      <div class="small"><b>Username</b></div>
      <input id="name" class="input" placeholder="Your name" />
      <div class="small" style="margin-top:10px"><b>Password</b></div>
      <input id="password" type="password" class="input" placeholder="Password" />
      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
        <button id="loginBtn" class="btn primary">Login</button>
        <button id="showReg" class="btn gray">Register</button>
      </div>
      <div id="msg" class="small" style="margin-top:10px"></div>
    </div>

    <div class="card" id="regCard" style="display:none">
      <div class="h1">Register</div>
      <div class="small">Create an account (passwords are stored as plain text in this demo build).</div>
      <input id="rname" class="input" placeholder="Your name" />
      <input id="rphone" class="input" placeholder="Phone (optional)" inputmode="numeric" pattern="[0-9]*" maxlength="15" style="margin-top:10px" />
      <input id="rpass" type="password" class="input" placeholder="Password" style="margin-top:10px" />
      <div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">
        <button id="regBtn" class="btn primary">Create account</button>
        <button id="hideReg" class="btn gray">Cancel</button>
      </div>
      <div id="rmsg" class="small" style="margin-top:10px"></div>
    </div>
  `;

  const nameEl = root.querySelector("#name");
  const passEl = root.querySelector("#password");
  const msgEl = root.querySelector("#msg");

  const regCard = root.querySelector("#regCard");
  root.querySelector("#showReg").onclick = () => (regCard.style.display = "block");
  root.querySelector("#hideReg").onclick = () => (regCard.style.display = "none");

  root.querySelector("#loginBtn").onclick = async () => {
    msgEl.textContent = "Signing in…";
    const name = nameEl.value.replace(/\s+/g, " ").trim();
    const password = passEl.value.trim();
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
    rmsg.textContent = "Creating account…";
    const name = root.querySelector("#rname").value.replace(/\s+/g, " ").trim();
    const phone = root.querySelector("#rphone").value.trim();
    const password = root.querySelector("#rpass").value.trim();
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
    location.hash = "#/match";
  };
}