// src/api/endpoints.js
import { apiGet, apiPost, apiUpload } from "./client.js";

export const API = {
  // auth
  me: () => apiGet({ action: "me" }),
  login: (name, password) => apiPost({ action: "login", name, password }),
  requestPasswordReset: (email) => apiPost({ action: "request_password_reset", email }),
  resetPassword: (email, otp, newPassword) => apiPost({ action: "reset_password", email, otp, newPassword }),
  registerUser: (name, password, phone = "") => apiPost({ action: "register_user", name, password, phone }),
  logout: () => apiPost({ action: "logout" }),

  // notifications
  notifications: () => apiGet({ action: "notifications" }),
  notificationsMarkRead: (ids) => apiPost({ action: "notifications_mark_read", ids }),
  myNextMatch: () => apiGet({ action: "my_next_match" }),
  mySeasonStats: (seasonId = "", includeHistory = false) =>
    apiGet({ action: "my_season_stats", seasonId, includeHistory: includeHistory ? 1 : 0 }),
  // seasons
  seasons: () => apiGet({ action: "seasons" }),
  leaderboardSeason: (seasonId, includeCards = false) => apiGet({ action: "leaderboard_season", seasonId, includeCards: includeCards ? 1 : 0 }),
  playerHistory: (seasonId, playerName) => apiGet({ action: "player_history", seasonId, playerName }),
  playerFcCard: (seasonId, playerName) => apiGet({ action: "player_fc_card", seasonId, playerName }),
  adminFcCardLeaders: (seasonId) => apiGet({ action: "admin_fc_card_leaders", seasonId }),

  // public matches (season-scoped)
  publicOpenMatches: (seasonId) => apiGet({ action: "public_open_matches", seasonId }),
  publicPastMatches: (seasonId, page, pageSize) => apiGet({ action: "public_past_matches", seasonId, page, pageSize }),
  publicMatchesMeta: (seasonId) => apiGet({ action: "public_matches_meta", seasonId }),

  // players / public match
  registerPlayer: (name, phone) => apiPost({ action: "register_player", name, phone }),
  players: () => apiGet({ action: "players" }),
  getPublicMatch: (code) => apiGet({ action: "public_match", code }),
  setAvailability: (code, availability) => apiPost({ action: "set_availability", code, availability }),
  votePotm: (code, candidateName) => apiPost({ action: "potm_vote", code, candidateName }),
  // admin
  adminListMatches: (seasonId) => apiGet({ action: "admin_list_matches", seasonId }),
  adminUpdateTeamNames: (payload) => apiPost({ action: "admin_update_team_names", ...payload }),
  adminCreateMatch: (payload) => apiPost({ action: "admin_create_match", ...payload }),
  adminCreateSeason: (payload) => apiPost({ action: "admin_create_season", ...payload }),
  adminUpdateSeason: (payload) => apiPost({ action: "admin_update_season", ...payload }),
  adminDeleteSeason: (seasonId) => apiPost({ action: "admin_delete_season", seasonId }),
  adminStartPotmVoting: (matchId) => apiPost({ action: "admin_start_potm_voting", matchId }),
  adminCancelPotmVoting: (matchId) => apiPost({ action: "admin_cancel_potm_voting", matchId }),
  adminClosePotmVoting: (matchId) => apiPost({ action: "admin_close_potm_voting", matchId }),
  adminReopenPotmVoting: (matchId) => apiPost({ action: "admin_reopen_potm_voting", matchId }),
  adminPotmStatus: (matchId) => apiGet({ action: "admin_potm_status", matchId }),
  adminRemindPotmPending: (matchId) => apiPost({ action: "admin_remind_potm_pending", matchId }),
  adminLockRatings: (matchId) => apiPost({ action: "admin_lock_ratings", matchId }),
  adminUnlockMatch: (matchId) => apiPost({ action: "admin_unlock_match", matchId }),
  adminCloseAvailability: (matchId) => apiPost({ action: "admin_close_availability", matchId }),
  adminOpenAvailability: (matchId) => apiPost({ action: "admin_open_availability", matchId }),
  adminUpdateAvailabilityLimit: (matchId, availabilityLimit) =>
    apiPost({ action: "admin_update_availability_limit", matchId, availabilityLimit }),
  adminDeleteMatch: (matchId) => apiPost({ action: "admin_delete_match", matchId }),
  adminAutoTeams: (matchId) => apiPost({ action: "admin_auto_teams", matchId }),
  adminSetupInternal: (payload) => apiPost({ action: "admin_setup_internal", ...payload }),
  adminSetupOpponent: (payload) => apiPost({ action: "admin_setup_opponent", ...payload }),
  adminShareTeams: (matchId) => apiPost({ action: "admin_share_teams", matchId }),
  adminUsers: () => apiGet({ action: "admin_users" }),
  adminSetAdmin: (name, isAdmin) => apiPost({ action: "admin_set_admin", name, isAdmin: isAdmin ? 1 : 0 }),
  adminSetStatus: (name, playerStatus) => apiPost({ action: "admin_set_status", name, playerStatus }),
  adminSetPassword: (name, password) => apiPost({ action: "admin_set_password", name, password }),
  adminDeleteUser: (name) => apiPost({ action: "admin_delete_user", name }),
  adminBroadcastNotification: (payload) => apiPost({ action: "admin_broadcast_notification", ...payload }),
  adminAuditLog: (filters = {}) => apiGet({ action: "admin_audit_log", ...filters }),

  // admin: match availability management (for adding players who may not have the app)
  adminSetAvailabilityFor: (matchId, playerName, availability, note = "") =>
    apiPost({ action: "admin_set_availability_for", matchId, playerName, availability, note }),

  // user self-service
  userSetPassword: (oldPassword, newPassword) => apiPost({ action: "user_set_password", oldPassword, newPassword }),
  userSetPhone: (phone) => apiPost({ action: "user_set_phone", phone }),
  userSetEmail: (email) => apiPost({ action: "user_set_email", email }),
  userSetStatus: (playerStatus) => apiPost({ action: "user_set_status", playerStatus }),
  userSetPhoto: (blob) => {
    const form = new FormData();
    form.set("action", "user_set_photo");
    const extension = blob?.type === "image/jpeg" ? "jpg" : blob?.type === "image/png" ? "png" : "webp";
    form.set("photo", blob, `profile.${extension}`);
    return apiUpload(form);
  },
  userRemovePhoto: () => apiPost({ action: "user_remove_photo" }),

  saveTeamPositions: (code, team, positions) => apiPost({action:"save_team_positions",code,team,positions}),

  // captain
  captainSubmitScore: (code, mode, a, b, scope = "CAPTAIN") => apiPost({ action: "captain_submit_score", code, mode, scoreA: a, scoreB: b, scope }),
  adminSubmitScore: (code, mode, a, b) => apiPost({ action: "admin_submit_score", code, mode, scoreA: a, scoreB: b }),
  captainSubmitRatingsBatch: (code, rows, scope = "CAPTAIN") => apiPost({ action: "captain_submit_ratings_batch", code, rows, scope }),
  adminSubmitRatingsBatch: (code, rows) => apiPost({ action: "admin_submit_ratings_batch", code, rows }),

    pushPublicKey: () => apiGet({ action: "push_public_key" }),
  pushSubscribe: (subscription, userAgent) =>
    apiPost({ action: "push_subscribe", subscription, userAgent }),
  pushTest: () => apiPost({ action: "push_test" }),
  pushUnsubscribe: (endpoint) =>
    apiPost({ action: "push_unsubscribe", endpoint }),

};
