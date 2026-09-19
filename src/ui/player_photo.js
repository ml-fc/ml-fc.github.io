const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

export function safePhotoUrl(value) {
  try {
    const url = new URL(String(value || ""), location.origin);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ? url.href : "";
  } catch { return ""; }
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "?";
}

export function playerPhotoHtml(name, url, className = "playerPhoto") {
  const safe = safePhotoUrl(url);
  const photoStyle = safe ? ` style="--player-photo:url('${esc(safe)}')"` : "";
  return `<span class="${esc(className)}${safe ? " hasPhoto" : ""}"${photoStyle} aria-hidden="true"><span class="playerPhoto__initials">${esc(initials(name))}</span></span>`;
}

async function encodePhotoCanvas(canvas) {
  const webp = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .82));
  if (webp?.type === "image/webp") return webp;
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82));
}

export async function cropPhotoFile(file, size = 384) {
  if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose a photo smaller than 8 MB.");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) { bitmap.close(); throw new Error("This browser could not prepare the photo."); }
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale, height = bitmap.height * scale;
  context.fillStyle = "#dbe5ea"; context.fillRect(0, 0, size, size);
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close();
  const blob = await encodePhotoCanvas(canvas);
  if (!blob) throw new Error("This browser could not prepare the photo.");
  if (blob.size > 256 * 1024) return cropPhotoFile(file, 300);
  return blob;
}

export async function choosePhotoCrop(file, container = document.body) {
  if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose a photo smaller than 8 MB.");

  const bitmap = await createImageBitmap(file);
  const previewSize = 320;
  const dialog = document.createElement("dialog");
  dialog.className = "photoCropDialog";
  dialog.setAttribute("aria-labelledby", "photoCropTitle");
  dialog.innerHTML = `
    <div class="photoCropSheet">
      <div class="stepEyebrow">Profile photo</div>
      <div class="h1" id="photoCropTitle">Crop around your face</div>
      <p class="photoCropHelp" id="photoCropHelp">Move and zoom so your face fills the circle. It reaches the photo edge and turns green when ready or red when it needs adjusting.</p>
      <div class="photoCropViewport">
        <canvas width="${previewSize}" height="${previewSize}" aria-label="Photo crop preview" aria-describedby="photoCropHelp"></canvas>
        <span class="photoCropGuide" aria-hidden="true"></span>
      </div>
      <label class="photoCropZoom">Zoom <input type="range" min="1" max="6" step="0.01" value="1" aria-label="Photo zoom"></label>
      <div class="photoCropCheck isChecking" role="status" aria-live="polite"><span aria-hidden="true"></span><b>Loading private face check…</b></div>
      <p class="photoCropPrivacy">Face detection runs only on this device. Nothing is uploaded until you use the crop.</p>
      <div class="photoCropActions">
        <button class="btn gray" type="button" data-cancel>Cancel</button>
        <button class="btn primary" type="button" data-use disabled>Use this crop</button>
      </div>
    </div>`;

  const canvas = dialog.querySelector("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) { bitmap.close(); throw new Error("This browser could not prepare the photo."); }
  const zoom = dialog.querySelector("input[type=range]");
  const check = dialog.querySelector(".photoCropCheck");
  const checkMessage = check.querySelector("b");
  const useButton = dialog.querySelector("[data-use]");
  let zoomLevel = 1;
  let offsetX = 0;
  let offsetY = 0;
  let pointer = null;
  let checkTimer = null;
  let checkSequence = 0;
  let faceCheckReady = false;
  let cropQuality = "checking";

  const dimensions = () => {
    const baseScale = Math.max(previewSize / bitmap.width, previewSize / bitmap.height);
    const scale = baseScale * zoomLevel;
    return { scale, width: bitmap.width * scale, height: bitmap.height * scale };
  };
  const clampOffsets = () => {
    const { width, height } = dimensions();
    offsetX = Math.max((previewSize - width) / 2, Math.min((width - previewSize) / 2, offsetX));
    offsetY = Math.max((previewSize - height) / 2, Math.min((height - previewSize) / 2, offsetY));
  };
  const draw = () => {
    clampOffsets();
    const { width, height } = dimensions();
    context.fillStyle = "#dbe5ea";
    context.fillRect(0, 0, previewSize, previewSize);
    context.drawImage(bitmap, (previewSize - width) / 2 + offsetX, (previewSize - height) / 2 + offsetY, width, height);
  };
  const updateCheck = (quality, message) => {
    cropQuality = quality;
    dialog.dataset.cropQuality = quality;
    check.className = `photoCropCheck is${quality[0].toUpperCase()}${quality.slice(1)}`;
    checkMessage.textContent = message;
    useButton.disabled = quality !== "good" && quality !== "unavailable";
    useButton.textContent = quality === "warning"
      ? "Adjust crop first"
      : quality === "checking"
        ? "Checking photo…"
        : quality === "unavailable"
          ? "Use without face check"
          : "Use this crop";
  };
  const runFaceCheck = async () => {
    const sequence = ++checkSequence;
    updateCheck("checking", faceCheckReady ? "Checking this crop…" : "Loading private face check…");
    try {
      const { checkFaceCrop } = await import("./face_detection.js");
      let timeout;
      const result = await Promise.race([
        checkFaceCrop(canvas),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Face check timed out")), 10000); }),
      ]).finally(() => clearTimeout(timeout));
      if (sequence !== checkSequence || !dialog.isConnected) return;
      faceCheckReady = true;
      updateCheck(result.quality, result.message);
    } catch {
      if (sequence !== checkSequence || !dialog.isConnected) return;
      updateCheck("unavailable", "Face check is unavailable. You can still review and use this crop.");
    }
  };
  const scheduleFaceCheck = (delay = 350) => {
    clearTimeout(checkTimer);
    ++checkSequence;
    updateCheck("checking", faceCheckReady ? "Checking this crop…" : "Loading private face check…");
    checkTimer = setTimeout(runFaceCheck, delay);
  };
  const encodeCrop = async (size = 384) => {
    const output = document.createElement("canvas");
    output.width = size; output.height = size;
    const outputContext = output.getContext("2d", { alpha: false });
    if (!outputContext) throw new Error("This browser could not prepare the photo.");
    outputContext.fillStyle = "#dbe5ea";
    outputContext.fillRect(0, 0, size, size);
    const ratio = size / previewSize;
    const { width, height } = dimensions();
    outputContext.drawImage(bitmap, ((previewSize - width) / 2 + offsetX) * ratio, ((previewSize - height) / 2 + offsetY) * ratio, width * ratio, height * ratio);
    const blob = await encodePhotoCanvas(output);
    if (!blob) throw new Error("This browser could not prepare the photo.");
    return blob.size > 256 * 1024 && size > 300 ? encodeCrop(300) : blob;
  };

  zoom.oninput = () => { zoomLevel = Number(zoom.value); draw(); scheduleFaceCheck(); };
  canvas.addEventListener("pointerdown", event => {
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("isDragging");
  });
  canvas.addEventListener("pointermove", event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const ratio = previewSize / canvas.getBoundingClientRect().width;
    offsetX += (event.clientX - pointer.x) * ratio;
    offsetY += (event.clientY - pointer.y) * ratio;
    pointer.x = event.clientX; pointer.y = event.clientY;
    draw();
    scheduleFaceCheck();
  });
  const stopDragging = event => {
    if (pointer?.id === event.pointerId) pointer = null;
    canvas.classList.remove("isDragging");
    scheduleFaceCheck(100);
  };
  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);

  container.appendChild(dialog);
  draw();
  if (typeof dialog.showModal !== "function") {
    dialog.remove(); bitmap.close();
    return cropPhotoFile(file);
  }

  return new Promise((resolve, reject) => {
    const finish = value => {
      clearTimeout(checkTimer);
      ++checkSequence;
      if (dialog.open) dialog.close();
      dialog.remove(); bitmap.close();
      resolve(value);
    };
    dialog.querySelector("[data-cancel]").onclick = () => finish(null);
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    useButton.onclick = async event => {
      if (cropQuality !== "good" && cropQuality !== "unavailable") return;
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = "Preparing…";
      try { finish(await encodeCrop()); }
      catch (error) { dialog.remove(); bitmap.close(); reject(error); }
    };
    dialog.showModal();
    scheduleFaceCheck(0);
  });
}

export function loadCanvasImage(url) {
  const safe = safePhotoUrl(url);
  if (!safe) return Promise.resolve(null);
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = safe;
  });
}

export function invalidatePlayerPhotoCaches() {
  const prefixes = [
    "mlfc_match_detail_cache_v2:",
    "mlfc_admin_manage_cache_v3:",
    "mlfc_captain_roster_v1:",
    "mlfc_captain_teams_v1:",
  ];
  const exact = new Set(["mlfc_players_cache_v2"]);
  try {
    Object.keys(localStorage).forEach(key => {
      if (exact.has(key) || prefixes.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
    });
  } catch {}
  try { sessionStorage.removeItem("mlfc_match_list_ui_v1"); } catch {}
  window.dispatchEvent(new CustomEvent("mlfc:player-photo-updated"));
}
