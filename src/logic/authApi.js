import { startRegistration, startAuthentication, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { apiUrl } from '../GlobalConsts';
import { getGuestId } from './sessionId';

/**
 * Account, friends and score API (backend routes/auth.js, social.js,
 * scores.js). Sessions are an HttpOnly cookie on the same origin, so plain
 * fetch carries them. Failed calls throw an ApiError with the backend's
 * `code` (translated by the UI) and its English `error` as the message.
 */
export class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function call(method, path, body) {
  let r;
  // A Blob (a picture) goes as itself, with its own type; anything else as JSON
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  try {
    r = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': raw ? body.type : 'application/json' } : undefined,
      body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server', 0);
  }
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  if (!r.ok || json?.success === false) throw new ApiError(json?.code ?? 'network', json?.error ?? `Request failed (${r.status})`, r.status);
  return json;
}
const get = (path) => call('GET', path);
const post = (path, body = {}) => call('POST', path, body);

// ── Session ──────────────────────────────────────────────────────────────

export const getMe = () => get('/auth/me').then(j => j.user);
export const logout = () => post('/auth/logout');

/** What the address can sign in with: { exists, hasPasskey, hasPassword }. */
export const lookupEmail = (email) => post('/auth/lookup', { email });
/** Mail a six-digit code to the address. Resolves to { sent, devCode? } (the code itself only in development). */
export const startEmailCode = (email, lang) => post('/auth/email/start', { email, lang });
/**
 * Sign in with the mailed code. An address without an account resolves to
 * { needsUsername: true } until a display name is given, then creates it.
 * Otherwise { user, created }.
 */
export const verifyEmailCode = (email, code, username) =>
  post('/auth/email/verify', { email, code, guestId: getGuestId(), ...(username != null ? { username } : {}) });

// Every sign-in carries the browser's guest id: the scores sung as a guest on it become the account's.
export const loginPassword = (email, password) => post('/auth/password/login', { email, password, guestId: getGuestId() }).then(j => j.user);
/** Rename and/or set a password: { username?, newPassword? }. Resolves to the updated user. */
export const updateAccount = (changes) => call('PATCH', '/auth/me', changes).then(j => j.user);
export const deleteAccount = () => call('DELETE', '/auth/me');
export const deletePasskey = (id) => call('DELETE', `/auth/passkeys/${encodeURIComponent(id)}`).then(j => j.passkeys);
/** Upload a profile picture (a square WebP or JPEG Blob, logic/avatarImage.js). Resolves to its path (logic/avatar.js). */
export const uploadAvatar = (blob) => call('PUT', '/me/avatar', blob).then(j => j.avatar);
export const removeAvatar = () => call('DELETE', '/me/avatar');

// ── Songs ────────────────────────────────────────────────────────────────

/** Submit a timing correction for everyone (signed in). Resolves to { gap, sourceGap }. */
export const submitGapCorrection = (songId, gap) => call('PATCH', `/songs/${encodeURIComponent(songId)}`, { gap }); // admins only

/** What is wrong with a song: { kinds, comment?, context?, nickname?, partyId?, sessionId? } (anyone, guests too). */
export const reportSong = (songId, report) => post(`/songs/${encodeURIComponent(songId)}/reports`, report);

export const passkeysSupported = () => browserSupportsWebAuthn();
export const passkeyAutofillSupported = () => browserSupportsWebAuthnAutofill();

/** The user dismissed the browser's passkey prompt (not an error worth showing). */
export const isCancelled = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError';

/** Add a passkey to the signed-in account. */
export async function registerPasskey({ name } = {}) {
  const { challengeId, options } = await post('/auth/passkey/register/options');
  const response = await startRegistration({ optionsJSON: options });
  return post('/auth/passkey/register/verify', { challengeId, response, name }).then(j => j.user);
}

/**
 * Sign in with a passkey. Without an address the browser offers every passkey
 * it has for this site; with `useBrowserAutofill` that happens inside the
 * e-mail field's autocomplete (needs autocomplete="… webauthn").
 */
export async function loginPasskey({ email, useBrowserAutofill = false } = {}) {
  const { challengeId, options } = await post('/auth/passkey/login/options', email ? { email } : {});
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill });
  return post('/auth/passkey/login/verify', { challengeId, response, guestId: getGuestId() }).then(j => j.user);
}

// ── Scores ───────────────────────────────────────────────────────────────

export const getMyBest = () => get('/me/best').then(j => j.data);
export const getMyScores = (offset = 0, limit = 20) => get(`/me/scores?offset=${offset}&limit=${limit}`);
export const getSongScores = (songId) => get(`/scores/song/${encodeURIComponent(songId)}`).then(j => j.data);

// ── People ───────────────────────────────────────────────────────────────

/** A public profile; `achievements` is the whole catalogue [{ key, goal, unlockedAt, progress? }] (progress on your own only) */
export const getProfile = (username) => get(`/users/${encodeURIComponent(username)}`).then(j => j.data);
export const searchUsers = (q) => get(`/users/search?q=${encodeURIComponent(q)}`).then(j => j.data);
export const getFriends = () => get('/friends').then(j => j.data);
export const getSuggestions = () => get('/friends/suggestions').then(j => j.data);
export const requestFriend = (username) => post('/friends/request', { username }).then(j => j.relation);
export const acceptFriend = (username) => post('/friends/accept', { username }).then(j => j.relation);
export const removeFriend = (username) => call('DELETE', `/friends/${encodeURIComponent(username)}`).then(j => j.relation);
/**
 * { friendRequests: [{ username, createdAt, isNew }], achievements: [{ key, unlockedAt, isNew }], unseen }:
 * pending requests to you and the achievements you recently earned, each newest first
 */
export const getNotifications = () => get('/notifications').then(j => j.data);
/** Everything up to `until` (the newest createdAt / unlockedAt shown) has been seen */
export const markNotificationsSeen = (until) => post('/notifications/seen', { until });

// ── Admin (routes/admin.js; 403 for everyone without the flag) ───────────

/** Numbers for the tiles plus every party running right now. */
export const getAdminOverview = () => get('/admin/overview').then(j => j.data);
/** One row of counts per day (in Berlin) for the last `days` and the `days` before, with each range's totals (logic/trends.js reads them). */
export const getAdminTrends = (days = 30) => get(`/admin/trends?days=${days}`).then(j => j.data);
export const getAdminPlays = (offset = 0, limit = 20) => get(`/admin/plays?offset=${offset}&limit=${limit}`);
/** Newest accounts, or those whose name or address starts with q. */
export const getAdminUsers = (q = '', offset = 0, limit = 20) => get(`/admin/users?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`);
/** Appoint or demote; resolves to the account as the list shows it. */
export const adminSetAdmin = (id, isAdmin) => call('PATCH', `/admin/users/${id}`, { isAdmin }).then(j => j.data);
export const adminRevokeSessions = (id) => call('DELETE', `/admin/users/${id}/sessions`);
export const adminDeleteUser = (id) => call('DELETE', `/admin/users/${id}`);
/** Remove someone's profile picture (moderation). */
export const adminRemoveAvatar = (id) => call('DELETE', `/admin/users/${id}/avatar`);
export const adminCloseParty = (partyId) => post(`/admin/parties/${encodeURIComponent(partyId)}/close`);
/** Where the visitors of the last `days` came from: { days, referrers, arrivals (our own links), direct, countries }. */
export const getAdminOrigins = (days = 30) => get(`/admin/origins?days=${days}`).then(j => j.data);
/** What the players of the last `days` ran on: { days, os, browsers, devices }, each [{ name, sessions, plays }]. */
export const getAdminDevices = (days = 30) => get(`/admin/devices?days=${days}`).then(j => j.data);
/** How songs were found in the last `days`: { days, picks, searches, topMissed, topAsked, youtube }. */
export const getAdminDiscovery = (days = 30) => get(`/admin/discovery?days=${days}`).then(j => j.data);
/** { data: reports, hasMore, counts: { open, resolved, dismissed } }; status 'open' | 'resolved' | 'dismissed' | 'all' */
export const getAdminReports = (status = 'open', offset = 0, limit = 20) => get(`/admin/reports?status=${status}&offset=${offset}&limit=${limit}`);
export const adminReviewReport = (id, status, note) => call('PATCH', `/admin/reports/${id}`, { status, ...(note ? { note } : {}) }).then(j => j.data);
/** AI karaoke charts: { data: jobs, hasMore, counts (per filter), stats (the tiles, with the limits) }; status 'all' | 'active' | 'done' | 'rejected' | 'failed' */
export const getAdminChartJobs = (status = 'all', offset = 0, limit = 20) => get(`/admin/chart-jobs?status=${status}&offset=${offset}&limit=${limit}`);
/** Who may have AI charts made: { access, stored: { access, updatedAt, updatedBy } | null, fallback: { access, from }, generator } */
export const getAdminChartAccess = () => get('/admin/chart-jobs/access').then(j => j.data);
export const adminSetChartAccess = (access) => call('PUT', '/admin/chart-jobs/access', { access }).then(j => j.data);
