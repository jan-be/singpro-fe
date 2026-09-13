/**
 * A per-tab id that ties a listen and its recording uploads together.
 *
 * It used to be `sessionStorage.getItem('sessionId') ?? crypto.randomUUID()`,
 * inline in the song-loading effect. randomUUID only exists in Chrome 92+ /
 * Safari 15.4+ and only in a secure context, so on an older Android WebView
 * (or over plain http on a LAN address) it is undefined: the TypeError landed
 * in that effect's catch, the page went to its error state and the song never
 * started — no video, no lyrics. Nothing downstream needs a real UUID, so fall
 * back to getRandomValues and then to Math.random.
 */
const randomId = () => {
  try {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      if (typeof crypto.getRandomValues === 'function') {
        return Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
    }
  } catch { /* locked-down crypto: fall through */ }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

// Private-mode browsers throw on sessionStorage; keep the id for the page load.
let fallbackId = null;

export const getSessionId = () => {
  try {
    const stored = sessionStorage.getItem('sessionId');
    if (stored) return stored;
    const id = randomId();
    sessionStorage.setItem('sessionId', id);
    return id;
  } catch {
    if (!fallbackId) fallbackId = randomId();
    return fallbackId;
  }
};
