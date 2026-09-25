import { apiUrl } from '../GlobalConsts';
import { getSessionId } from './sessionId';

/**
 * Fire-and-forget usage events for the admin page (backend routes/events.js):
 * which searches and picks lead to a song. sendBeacon survives the navigation
 * a pick sets off; nothing here identifies a person beyond the tab's session
 * id. A search session runs from the first letter typed until the box is
 * cleared or a song is picked, so hits and misses can be counted per search
 * rather than per keystroke.
 */
export function trackEvent(type, data = {}) {
  try {
    const body = JSON.stringify({ type, sessionId: getSessionId(), ...data });
    const url = `${apiUrl}/events`;
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else if (typeof fetch === 'function') {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* never in the way of the page */ }
}

const sessions = new Map(); // scope -> { id, source }

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The id of the search session running in `scope` ('entry' or 'queue'), started if there is none. */
export function searchSession(scope, source = scope) {
  let s = sessions.get(scope);
  if (!s) { s = { id: newId(), source }; sessions.set(scope, s); }
  return s;
}

/** The current session of `scope` without starting one; null when the box is empty. */
export function currentSearch(scope) {
  return sessions.get(scope) ?? null;
}

/** The box was cleared or a song picked: the next letter starts a new session. */
export function endSearch(scope) {
  sessions.delete(scope);
}

/** A settled query and what it found, for the session in `scope`. */
export function trackSearch(scope, { q, results, hasMore = false, source } = {}) {
  const s = searchSession(scope, source);
  trackEvent('search', { searchId: s.id, source: source ?? s.source, q, results, hasMore });
}

/** A song chosen: `source` says how (search, browse, youtube-url); the entry search's session goes along. */
export function trackPick(source, data = {}) {
  trackEvent('song_pick', { source, ...data });
}
