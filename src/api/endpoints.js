// src/api/endpoints.js
import { apiGet, apiPost } from "./client.js";

export const API = {
  // auth
  me: () => apiGet({ action: "me" }),
  login: (name, password) => apiPost({ action: "login", name, password }),
  registerUser: (name, password, phone = "") => apiPost({ action: "register_user", name, password, phone }),
  logout: () => apiPost({ action: "logout" }),

  // notifications
  notifications: () => apiGet({ action: "notifications" }),
  notificationsMarkRead: (ids) => apiPost({ action: "notifications_mark_read", ids }),
  // seasons
  seasons: () => apiGet({ action: "seasons" }),
  leaderboardSeason: (seasonId) => apiGet({ action: "leaderboard_season", seasonId }),

  // public matches (season-scoped)
  publicOpenMatches: (seasonId) => apiGet({ action: "public_open_matches", seasonId }),
  publicPastMatches: (seasonId, page, pageSize) => apiGet({ action: "public_past_matches", seasonId, page, pageSize }),
  publicMatchesMeta: (seasonId) => apiGet({ action: "public_matches_meta", seasonId }),

  // players / public match
  players: () => apiGet({ action: "players" }),
  getPublicMatch: (code) => apiGet({ action: "public_match", code }),
  setAvailability: (code, availability) => apiPost({ action: "set_availability", code, availability }),
  // admin
  adminListMatches: (seasonId) => apiGet({ action: "admin_list_matches", seasonId }),
  adminCreateMatch: (payload) => apiPost({ action: "admin_create_match", ...payload }),
  adminCreateSeason: (payload) => apiPost({ action: "admin_create_season", ...payload }),
  adminUpdateSeason: (payload) => apiPost({ action: "admin_update_season", ...payload }),
  adminDeleteSeason: (seasonId) => apiPost({ action: "admin_delete_season", seasonId }),
  adminLockRatings: (matchId) => apiPost({ action: "admin_lock_ratings", matchId }),
  adminUnlockMatch: (matchId) => apiPost({ action: "admin_unlock_match", matchId }),
  adminCloseAvailability: (matchId) => apiPost({ action: "admin_close_availability", matchId }),
  adminOpenAvailability: (matchId) => apiPost({ action: "admin_open_availability", matchId }),
  adminUpdateAvailabilityLimit: (matchId, availabilityLimit) =>
    apiPost({ action: "admin_update_availability_limit", matchId, availabilityLimit }),
  adminDeleteMatch: (matchId) => apiPost({ action: "admin_delete_match", matchId }),
  adminSetupInternal: (payload) => apiPost({ action: "admin_setup_internal", ...payload }),
  adminSetupOpponent: (payload) => apiPost({ action: "admin_setup_opponent", ...payload }),
  adminUsers: () => apiGet({ action: "admin_users" }),
  adminSetAdmin: (name, isAdmin) => apiPost({ action: "admin_set_admin", name, isAdmin: isAdmin ? 1 : 0 }),
  adminSetPassword: (name, password) => apiPost({ action: "admin_set_password", name, password }),
  adminDeleteUser: (name) => apiPost({ action: "admin_delete_user", name }),

  // admin: match availability management (for adding players who may not have the app)
  adminSetAvailabilityFor: (matchId, playerName, availability, note = "") =>
    apiPost({ action: "admin_set_availability_for", matchId, playerName, availability, note }),

  // user self-service
  userSetPassword: (oldPassword, newPassword) => apiPost({ action: "user_set_password", oldPassword, newPassword }),

  // captain
  captainSubmitScore: (code, mode, a, b, scope = "CAPTAIN") => apiPost({ action: "captain_submit_score", code, mode, scoreA: a, scoreB: b, scope }),
  adminSubmitScore: (code, mode, a, b) => apiPost({ action: "admin_submit_score", code, mode, scoreA: a, scoreB: b }),
  captainSubmitRatingsBatch: (code, rows, scope = "CAPTAIN") => apiPost({ action: "captain_submit_ratings_batch", code, rows, scope }),
  adminSubmitRatingsBatch: (code, rows) => apiPost({ action: "admin_submit_ratings_batch", code, rows }),

    pushPublicKey: () => apiGet({ action: "push_public_key" }),
  pushSubscribe: (subscription, userAgent) =>
    apiPost({ action: "push_subscribe", subscription, userAgent }),
  pushUnsubscribe: (endpoint) =>
    apiPost({ action: "push_unsubscribe", endpoint }),

};
