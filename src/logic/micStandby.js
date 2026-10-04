/**
 * When the microphone of someone who joined singing is actually open.
 *
 * Joining singing is a choice that lasts the party; the microphone only needs
 * to be open while a song plays (or while the mic panel shows its level). Kept
 * open in between, a tab left in the background with nothing playing still
 * showed the browser's "using your microphone" indicator. So it closes once
 * nothing has needed it for a while — sooner in a background tab — and opens
 * again when a song plays in a tab that is being looked at. The grace covers
 * the gap between two songs (score screen and the next video loading), so
 * a running party does not open and close it every song.
 */
export const MIC_IDLE_GRACE_MS = 20_000;
export const MIC_HIDDEN_GRACE_MS = 3_000;

/**
 * @param {object} s
 * @param {boolean} s.open     the microphone is open
 * @param {boolean} s.opening  it is being opened right now
 * @param {boolean} s.needed   a song plays, or the mic panel is open in a visible tab
 * @param {boolean} s.hidden   the tab is in the background
 * @param {number}  s.idleMs   how long nothing has needed it (counted from its opening at most)
 * @returns {'open' | 'close' | null}
 */
export function micAction({ open, opening, needed, hidden, idleMs }) {
  if (open) return !needed && idleMs >= (hidden ? MIC_HIDDEN_GRACE_MS : MIC_IDLE_GRACE_MS) ? 'close' : null;
  return needed && !hidden && !opening ? 'open' : null;
}

/** The microphone permission: 'granted' | 'denied' | 'prompt', or null where the browser does not say. */
export async function micPermission(permissions = globalThis.navigator?.permissions) {
  try { return (await permissions.query({ name: 'microphone' })).state ?? null; } catch { return null; }
}
