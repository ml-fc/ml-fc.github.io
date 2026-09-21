import { API } from "../api/endpoints.js";

const COUNTRY_OPTIONS = `<option value="61">🇦🇺 Australia (+61)</option><option value="64">🇳🇿 New Zealand (+64)</option><option value="91">🇮🇳 India (+91)</option><option value="44">🇬🇧 United Kingdom (+44)</option><option value="1">🇺🇸 USA / Canada (+1)</option><option value="971">🇦🇪 UAE (+971)</option><option value="65">🇸🇬 Singapore (+65)</option><option value="60">🇲🇾 Malaysia (+60)</option><option value="94">🇱🇰 Sri Lanka (+94)</option><option value="63">🇵🇭 Philippines (+63)</option><option value="92">🇵🇰 Pakistan (+92)</option><option value="880">🇧🇩 Bangladesh (+880)</option>`;

export async function renderRegisterPage(root) {
  root.innerHTML = `
    <div class="card">
      <div class="h1">Player Registration</div>
      <div class="small">Register once to appear in the match dropdown.</div>
    </div>

    <div class="card">
      <div class="field"><label class="field__label" for="name">Full name</label><input id="name" class="input" autocomplete="name" /></div>
      <div class="field"><label class="field__label" for="phone">WhatsApp number</label><div class="phoneField"><select id="country" class="input" aria-label="Country code">${COUNTRY_OPTIONS}</select><input id="phone" class="input" inputmode="tel" pattern="[0-9]*" maxlength="14" autocomplete="tel-national" required /></div><div class="field__help">Choose the country code, then enter the number without the leading zero.</div></div>
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
    const localPhone = phoneEl.value.replace(/\D+/g, "").replace(/^0+/, "");
    const phone = `${root.querySelector("#country").value}${localPhone}`;
    nameEl.removeAttribute("aria-invalid");
    phoneEl.removeAttribute("aria-invalid");
    if (!name) {
      nameEl.setAttribute("aria-invalid", "true");
      msgEl.textContent = "Enter the player's full name.";
      nameEl.focus();
      return;
    }
    if (phone.length < 8 || phone.length > 15) {
      phoneEl.setAttribute("aria-invalid", "true");
      msgEl.textContent = "Enter a valid WhatsApp number.";
      phoneEl.focus();
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
