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

/** What micAction decides from */
export interface MicStandbyState {
  open: boolean;
  opening: boolean;
  needed: boolean;
  hidden: boolean;
  idleMs: number;
}

/** What to do with the microphone now (micAction): open it, close it, or nothing */
export type MicAction = 'open' | 'close' | null;

/** The part of navigator.permissions micPermission uses */
export interface MicPermissions {
  query(descriptor: { name: 'microphone' }): Promise<{ state?: PermissionState }>;
}

/**
 * @param s
 * @param s.open     the microphone is open
 * @param s.opening  it is being opened right now
 * @param s.needed   a song plays, or the mic panel is open in a visible tab
 * @param s.hidden   the tab is in the background
 * @param s.idleMs   how long nothing has needed it (counted from its opening at most)
 */
export function micAction({ open, opening, needed, hidden, idleMs }: MicStandbyState): MicAction {
  if (open) return !needed && idleMs >= (hidden ? MIC_HIDDEN_GRACE_MS : MIC_IDLE_GRACE_MS) ? 'close' : null;
  return needed && !hidden && !opening ? 'open' : null;
}

/** The microphone permission: 'granted' | 'denied' | 'prompt', or null where the browser does not say. */
export async function micPermission(permissions: MicPermissions | undefined = globalThis.navigator?.permissions): Promise<PermissionState | null> {
  if (!permissions) return null;
  try { return (await permissions.query({ name: 'microphone' })).state ?? null; } catch { return null; }
}
