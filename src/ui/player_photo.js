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
  return `<span class="${esc(className)}${safe ? " hasPhoto" : ""}" aria-hidden="true">${safe ? `<img src="${esc(safe)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span>${esc(initials(name))}</span>`}</span>`;
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
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .82));
  if (!blob) throw new Error("This browser could not prepare the photo.");
  if (blob.size > 256 * 1024) return cropPhotoFile(file, 300);
  return blob;
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
