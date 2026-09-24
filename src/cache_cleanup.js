// Keep bounded, recent copies of the app's real localStorage caches.

const DAY_MS = 864e5;
const CACHE_RULES = [
  { prefix: "mlfc_match_detail_cache_v2:", maxItems: 80, maxAgeMs: 30 * DAY_MS },
  { prefix: "mlfc_open_matches_cache_v2:", maxItems: 24, maxAgeMs: 30 * DAY_MS },
  { prefix: "mlfc_past_matches_cache_v2:", maxItems: 24, maxAgeMs: 30 * DAY_MS },
  { prefix: "mlfc_matches_meta_v2:", maxItems: 24, maxAgeMs: 30 * DAY_MS },
  { prefix: "mlfc_admin_matches_cache_v3:", maxItems: 24, maxAgeMs: 14 * DAY_MS },
  { prefix: "mlfc_admin_manage_cache_v3:", maxItems: 80, maxAgeMs: 14 * DAY_MS },
  { prefix: "mlfc_next_match_cache_v1:", maxItems: 30, maxAgeMs: 14 * DAY_MS },
  { prefix: "mlfc_leaderboard_v2:", maxItems: 24, maxAgeMs: 14 * DAY_MS },
];

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function prunePrefix(prefix, maxItems, maxAgeMs, now) {
  const entries = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const timestamp = Number(safeJsonParse(localStorage.getItem(key))?.ts || 0);
    entries.push({ key, timestamp });
  }
  const recent = entries.filter(({ key, timestamp }) => {
    if (timestamp && now - timestamp <= maxAgeMs) return true;
    localStorage.removeItem(key);
    return false;
  });
  recent.sort((left, right) => right.timestamp - left.timestamp);
  recent.slice(maxItems).forEach(({ key }) => localStorage.removeItem(key));
}

export function cleanupCaches() {
  try {
    const now = Date.now();
    CACHE_RULES.forEach((rule) => prunePrefix(rule.prefix, rule.maxItems, rule.maxAgeMs, now));
  } catch {
    // Storage may be unavailable in privacy modes; cleanup is best-effort.
  }
}
