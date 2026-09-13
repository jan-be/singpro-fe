// gapOverrides.js — timing (gap) corrections saved for this browser only.
// "Save for me" in the gap corrector stores the value here; it wins over the
// server's correction and the file's #GAP for this device. Submitting a
// correction for everyone (signed-in users) clears the local one, since the
// shared value then carries it.

const KEY = 'singpro_gap_overrides';
const MAX_ENTRIES = 300;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function write(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* storage full or blocked */ }
}

/** The gap saved on this device for the song, or null. */
export function getGapOverride(songId) {
  if (!songId) return null;
  const v = read()[songId];
  return Number.isFinite(v) ? v : null;
}

export function setGapOverride(songId, gap) {
  if (!songId || !Number.isFinite(gap)) return;
  const map = read();
  delete map[songId]; // re-insert last so the oldest entries are the first keys
  map[songId] = gap;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) delete map[keys[i]];
  write(map);
}

export function clearGapOverride(songId) {
  if (!songId) return;
  const map = read();
  if (!(songId in map)) return;
  delete map[songId];
  write(map);
}
