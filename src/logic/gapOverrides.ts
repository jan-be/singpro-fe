// gapOverrides.ts — timing (gap) corrections saved for this browser only.
// "Save for me" in the gap corrector stores the value here; it wins over the
// server's correction and the file's #GAP for this device, until the shared
// timing changes: a saved value remembers the song's shared gap it was made
// against, and once an admin's correction (or a new chart) moves that, the
// saved one is stale and gives way. Submitting a correction for everyone
// (signed-in users) clears the local one, since the shared value then carries it.

const KEY = 'singspree_gap_overrides';
const MAX_ENTRIES = 300;

/** A gap saved for a song: with the shared gap it was made against, or (saved before that) a bare number */
type SavedGap = number | { gap: number; shared: number };

function read(): Record<string, SavedGap> {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) as Record<string, SavedGap> | null : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function write(map: Record<string, SavedGap>) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* storage full or blocked */ }
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1; // gaps are whole ms; a frame carry may round

/**
 * The gap saved on this device for the song, or null. `shared` is the song's
 * shared gap now (the API's `gap`) and `base` what its chart plays at by itself
 * (`defaultGap`): a value saved against another shared gap is dropped, and so
 * is one from before values remembered theirs (a bare number) when the song
 * has a shared correction now — the correction is the newer word.
 */
export function getGapOverride(songId: string | null | undefined, { shared, base }: { shared?: number | null; base?: number | null } = {}): number | null {
  if (!songId) return null;
  const map = read();
  const v = map[songId];
  const gap = typeof v === 'number' ? v : v?.gap;
  if (!Number.isFinite(gap)) return null;
  if (Number.isFinite(shared)) {
    const stale = typeof v === 'number'
      ? Number.isFinite(base) && !same(shared!, base!)
      : Number.isFinite(v.shared) && !same(shared!, v.shared);
    if (stale) {
      delete map[songId];
      write(map);
      return null;
    }
  }
  return gap;
}

/** Saves `gap` for the song on this device; `shared` is the song's shared gap it was made against. */
export function setGapOverride(songId: string | null | undefined, gap: number, shared?: number | null) {
  if (!songId || !Number.isFinite(gap)) return;
  const map = read();
  delete map[songId]; // re-insert last so the oldest entries are the first keys
  map[songId] = Number.isFinite(shared) ? { gap, shared: shared! } : gap;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) delete map[keys[i]];
  write(map);
}

export function clearGapOverride(songId: string | null | undefined) {
  if (!songId) return;
  const map = read();
  if (!(songId in map)) return;
  delete map[songId];
  write(map);
}
