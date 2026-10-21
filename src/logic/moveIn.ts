/**
 * The move from singpro.app (the name until 2026-10-19) to singspree.com.
 *
 * A browser keeps cookies and storage per domain, so on its own the move
 * would sign everyone out and forget every guest's id (their scores and
 * recordings), their settings and their parties. singpro.app therefore
 * answers browsers with public/moving.html, which packs this browser's
 * singpro_* storage and a one-time token for its session and browser id
 * (singspree-be routes/auth.ts /auth/handoff) into the fragment of the same
 * address here: #handoff=<base64url JSON { l, s, t, r }>. A fragment never
 * reaches a server or a Referer.
 *
 * This module runs first (index.tsx imports it before anything that reads
 * storage, i18n's language included). It takes the fragment out of the
 * address bar, and only when the page came straight from singpro.app (its
 * Referer, which no other site can send) writes the storage it carries and
 * claims the token; nobody can hand someone a guest id or a session of
 * theirs with a crafted link. What this browser already has here wins.
 *
 * Keys from before the rename (singpro_*, singpro-lang, singpro.lyricsScript)
 * get their new names (singspree…) once, here and on every other origin
 * (localhost).
 */
export const OLD_ORIGIN = 'https://singpro.app';
const OLD = 'singpro';
const NEW = 'singspree';
const CLAIM_TIMEOUT_MS = 4000;

/** What this module uses of localStorage / sessionStorage (a test passes a stand-in) */
export type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

/** The moving page's package: `l` and `s` the old site's local and session storage, `t` the session's token, `r` the referrer */
export interface HandoffData {
  l?: unknown;
  s?: unknown;
  t?: unknown;
  r?: unknown;
}

const keysOf = (store: StorageLike) => {
  try {
    return Array.from({ length: store.length }, (_, i) => store.key(i)).filter(Boolean) as string[];
  } catch {
    return [];
  }
};

/** singpro… keys under their singspree… names; the new name wins where both exist. */
export function renameOldKeys(store: StorageLike) {
  for (const key of keysOf(store)) {
    if (!key.startsWith(OLD)) continue;
    const name = NEW + key.slice(OLD.length);
    try {
      if (store.getItem(name) === null) store.setItem(name, store.getItem(key)!); // (listed a moment ago: it is there)
      store.removeItem(key);
    } catch { /* full or refused: the old key stays, and is tried again next time */ }
  }
}

/** The moving page's package from an address's fragment, or null. */
export function decodeHandoff(hash: string | null | undefined): HandoffData | null {
  const m = /^#handoff=([A-Za-z0-9_-]+)$/.exec(hash ?? '');
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** Only storage keys the old site wrote, as strings */
const fill = (store: StorageLike, items: unknown) => {
  if (!items || typeof items !== 'object') return;
  for (const [key, value] of Object.entries(items)) {
    if (!key.startsWith(OLD) || typeof value !== 'string') continue;
    try {
      if (store.getItem(key) === null && store.getItem(NEW + key.slice(OLD.length)) === null) store.setItem(key, value);
    } catch { /* full or refused */ }
  }
};

/**
 * Take a handoff from the address, if there is one. Returns
 * { claim: Promise (resolves when the session is set, or gave up), referrer }
 * or null. `referrer`: the page that sent the visitor to singpro.app ('' when
 * none), so referrer.ts counts that, not singpro.app.
 */
export function takeHandoff({ location, history, referrer, local, session, fetchImpl }: {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'state' | 'replaceState'>;
  referrer: string | null | undefined;
  local: StorageLike;
  session: StorageLike;
  fetchImpl: (url: string, init: { method: string; credentials: RequestCredentials; headers: Record<string, string>; body: string }) => Promise<unknown>;
}): { claim: Promise<unknown>; referrer: string } | null {
  const data = decodeHandoff(location.hash);
  if (!/^#handoff=/.test(location.hash ?? '')) return null;
  try { history.replaceState(history.state, '', `${location.pathname}${location.search}`); } catch { /* stays in the bar */ }
  if (!data || !String(referrer ?? '').startsWith(`${OLD_ORIGIN}/`)) return null;
  fill(local, data.l);
  fill(session, data.s);
  let claim: Promise<unknown> = Promise.resolve();
  if (typeof data.t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(data.t)) {
    const request = fetchImpl('/api/auth/handoff/claim', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: data.t }),
    }).catch(() => null);
    claim = Promise.race([request, new Promise(resolve => setTimeout(resolve, CLAIM_TIMEOUT_MS))]);
  }
  return { claim, referrer: typeof data.r === 'string' ? data.r : '' };
}

let moved: ReturnType<typeof takeHandoff> = null;
try {
  moved = takeHandoff({
    location: window.location, history: window.history, referrer: document.referrer,
    local: window.localStorage, session: window.sessionStorage, fetchImpl: (...a) => window.fetch(...a),
  });
} catch { /* no window (tests), or storage refused */ }
try { renameOldKeys(window.localStorage); } catch { /* refused */ }
try { renameOldKeys(window.sessionStorage); } catch { /* refused */ }

/** Resolves when a handed-over session is in place (at once when there was none): index.tsx renders after it. */
export const moveIn = moved?.claim ?? Promise.resolve();

/** The page that sent a moved visitor to singpro.app ('' for none), or null when nobody moved. */
export const movedReferrer = moved ? moved.referrer : null;
