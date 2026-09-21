// src/prefetch.js
//
// Background warmup to make the UI feel snappy even when APIs are slow.
//
// Design:
// - Cache-first everywhere (pages read from localStorage immediately).
// - Prefetch runs in the background and only updates caches.
// - Prefetch must use the same cache keys/shapes as the pages.

import { API } from "./api/endpoints.js";
import { lsGet, lsSet } from "./storage.js";
import { isBrowserReload } from "./nav_state.js";

const LS_SELECTED_SEASON = "mlfc_selected_season_v1";

// Match page cache keys (must match src/pages/match.js)
const LS_OPEN_CACHE_PREFIX = "mlfc_open_matches_cache_v2:";   // seasonId -> {ts,matches}
const LS_MATCH_META_PREFIX = "mlfc_matches_meta_v2:";         // seasonId -> {ts,fingerprint,latestCode}

const TTL = {
  open: 60 * 1000, // 1 min
  meta: 60 * 1000, // 1 min
};

function now() { return Date.now(); }

function isFresh(obj, ttlMs) {
  return !!(obj?.ts && (now() - obj.ts) < ttlMs);
}

function openKey(seasonId) { return `${LS_OPEN_CACHE_PREFIX}${seasonId}`; }
function metaKey(seasonId) { return `${LS_MATCH_META_PREFIX}${seasonId}`; }

function pickSeasonIdFromLocalStorage() {
  return localStorage.getItem(LS_SELECTED_SEASON) || "";
}

function prefetchMatchTab(seasonId) {
  // Open matches
  const openCached = lsGet(openKey(seasonId));
  if (!openCached?.matches || !isFresh(openCached, TTL.open)) {
    API.publicOpenMatches(seasonId)
      .then(res => {
        if (res?.ok) lsSet(openKey(seasonId), { ts: now(), matches: res.matches || [] });
      })
      .catch(() => {});
  }

  // Matches meta (used for update banner)
  const metaCached = lsGet(metaKey(seasonId));
  if (!metaCached || !isFresh(metaCached, TTL.meta)) {
    API.publicMatchesMeta(seasonId)
      .then(res => {
        if (!res?.ok) return;
        lsSet(metaKey(seasonId), { ts: now(), fingerprint: res.fingerprint || "", latestCode: res.latestCode || "" });
      })
      .catch(() => {});
  }

  // Past matches are intentionally NOT prefetched.
  // They should only be loaded via the explicit "Refresh Past" button.
}

// Prefetch ONCE at app load; does not block UI.
export async function warmAppData() {
  // Per product requirement:
  // - Avoid hitting APIs automatically on normal app loads and tab switches.
  // - Only re-fetch in the background on a *browser reload*.

  if (!isBrowserReload()) return;

  // Per product requirement: re-fetch ONLY for the page the user reloaded.
  // Do NOT warm other tabs (that can make it look like their cache was cleared).
  try {
    const hash = window.location.hash || "#/match";
    const path = hash.split("?")[0];
    const seasonId = pickSeasonIdFromLocalStorage();
    if (!seasonId) return;

    if (path === "#/match") {
      prefetchMatchTab(seasonId);
    }
    // Ladder and Admin own their reload requests. A second ladder prefetch
    // duplicates work and can overwrite the FC-card result with card-less rows.
  } catch {
    // ignore
  }
}