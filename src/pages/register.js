import { API } from "../api/endpoints.js";

export async function renderRegisterPage(root) {
  root.innerHTML = `
    <div class="card">
      <div class="h1">Player Registration</div>
      <div class="small">Register once to appear in the match dropdown.</div>
    </div>

    <div class="card">
      <div class="field"><label class="field__label" for="name">Full name</label><input id="name" class="input" autocomplete="name" /></div>
      <div class="field"><label class="field__label" for="phone">Phone <span class="field__optional">Optional</span></label><input id="phone" class="input" inputmode="numeric" pattern="[0-9]*" maxlength="15" autocomplete="tel" /></div>
      <button id="btn" class="btn primary" style="margin-top:10px">Register</button>
      <div id="msg" class="field__message" role="status" aria-live="polite"></div>
    </div>
  `;

  const nameEl = root.querySelector("#name");
  const phoneEl = root.querySelector("#phone");

  // Phone: allow digits only
  phoneEl.addEventListener("input", () => {
    const cleaned = String(phoneEl.value || "").replace(/\D+/g, "");
    if (cleaned !== phoneEl.value) phoneEl.value = cleaned;
  });
  const msgEl = root.querySelector("#msg");

  root.querySelector("#btn").onclick = async () => {
    const name = nameEl.value.replace(/\s+/g, " ").trim();
    const phone = phoneEl.value.trim();
    nameEl.removeAttribute("aria-invalid");
    if (!name) {
      nameEl.setAttribute("aria-invalid", "true");
      msgEl.textContent = "Enter the player's full name.";
      nameEl.focus();
      return;
    }
    msgEl.textContent = "Registering player…";
    const res = await API.registerPlayer(name, phone);
    if (!res.ok) {
      msgEl.textContent = res.error || "Registration could not be completed. Check your details and try again.";
      return;
    }
    if (res.existing) {
      msgEl.textContent = "Already registered ✅ You can now select your name in match availability.";
    } else {
      msgEl.textContent = "Registered ✅ You can now select your name in match availability.";
    }
    nameEl.value = "";
    phoneEl.value = "";
  };
}
