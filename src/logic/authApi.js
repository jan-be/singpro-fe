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
  post('/auth/email/verify', { email, code, ...(username != null ? { username } : {}) });

export const loginPassword = (email, password) => post('/auth/password/login', { email, password }).then(j => j.user);
/** Rename and/or set a password: { username?, newPassword? }. Resolves to the updated user. */
export const updateAccount = (changes) => call('PATCH', '/auth/me', changes).then(j => j.user);
export const deleteAccount = () => call('DELETE', '/auth/me');
export const deletePasskey = (id) => call('DELETE', `/auth/passkeys/${encodeURIComponent(id)}`).then(j => j.passkeys);

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
export const getSuggestions = () => get('/friends/suggestions').then(j => j.data);
export const requestFriend = (username) => post('/friends/request', { username }).then(j => j.relation);
export const acceptFriend = (username) => post('/friends/accept', { username }).then(j => j.relation);
export const removeFriend = (username) => call('DELETE', `/friends/${encodeURIComponent(username)}`).then(j => j.relation);
