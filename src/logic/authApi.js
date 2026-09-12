import { startRegistration, startAuthentication, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { apiUrl } from '../GlobalConsts';

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
  try {
    r = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
export const registerPassword = (username, password) => post('/auth/password/register', { username, password }).then(j => j.user);
export const loginPassword = (username, password) => post('/auth/password/login', { username, password }).then(j => j.user);
export const changePassword = (currentPassword, newPassword) => call('PATCH', '/auth/me', { currentPassword, newPassword }).then(j => j.user);
export const deleteAccount = () => call('DELETE', '/auth/me');
export const deletePasskey = (id) => call('DELETE', `/auth/passkeys/${encodeURIComponent(id)}`).then(j => j.passkeys);

export const passkeysSupported = () => browserSupportsWebAuthn();
export const passkeyAutofillSupported = () => browserSupportsWebAuthnAutofill();

/** The user dismissed the browser's passkey prompt (not an error worth showing). */
export const isCancelled = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError';

/**
 * Create an account with a passkey (username given) or, signed in, add a
 * passkey to the current account (username omitted).
 */
export async function registerPasskey({ username, name } = {}) {
  const { challengeId, options } = await post('/auth/passkey/register/options', username ? { username } : {});
  const response = await startRegistration({ optionsJSON: options });
  return post('/auth/passkey/register/verify', { challengeId, response, name }).then(j => j.user);
}

/**
 * Sign in with a passkey. Without a username the browser offers every passkey
 * it has for this site; with `useBrowserAutofill` that happens inside the
 * username field's autocomplete (needs autocomplete="username webauthn").
 */
export async function loginPasskey({ username, useBrowserAutofill = false } = {}) {
  const { challengeId, options } = await post('/auth/passkey/login/options', username ? { username } : {});
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill });
  return post('/auth/passkey/login/verify', { challengeId, response }).then(j => j.user);
}

// ── Scores ───────────────────────────────────────────────────────────────

export const getMyBest = () => get('/me/best').then(j => j.data);
export const getMyScores = (offset = 0, limit = 20) => get(`/me/scores?offset=${offset}&limit=${limit}`);
export const getSongScores = (songId) => get(`/scores/song/${encodeURIComponent(songId)}`).then(j => j.data);

// ── People ───────────────────────────────────────────────────────────────

export const getProfile = (username) => get(`/users/${encodeURIComponent(username)}`).then(j => j.data);
export const searchUsers = (q) => get(`/users/search?q=${encodeURIComponent(q)}`).then(j => j.data);
export const getFriends = () => get('/friends').then(j => j.data);
export const requestFriend = (username) => post('/friends/request', { username }).then(j => j.relation);
export const acceptFriend = (username) => post('/friends/accept', { username }).then(j => j.relation);
export const removeFriend = (username) => call('DELETE', `/friends/${encodeURIComponent(username)}`).then(j => j.relation);
