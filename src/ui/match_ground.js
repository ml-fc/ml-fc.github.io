function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

export function groundLocationUrl(value) {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    return raw.length <= 2048 && !/[\u0000-\u0020\u007F]/.test(raw) && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function groundValidation(name, url) {
  if (name.length > 140 || /[\u0000-\u001F\u007F]/.test(name)) return "Ground name must be 140 characters or fewer and contain no line breaks.";
  if (url && !name) return "Enter a ground name for the location URL.";
  if (url && !groundLocationUrl(url)) return "Ground location must be a valid HTTP or HTTPS URL.";
  return "";
}

export function matchGroundHtml(match) {
  const name = String(match?.groundName || "").trim();
  if (!name) return "";
  const url = groundLocationUrl(match.groundUrl);
  return `<div class="matchGround"><span aria-hidden="true">📍</span> ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>` : escapeHtml(name)}</div>`;
}

// WhatsApp messages use plain text; keep the location URL beside its name.
export function matchGroundText(match) {
  const name = String(match?.groundName || "").trim();
  if (!name) return "";
  const url = groundLocationUrl(match.groundUrl);
  return `📍 ${name}${url ? `\n${url}` : ""}`;
}
