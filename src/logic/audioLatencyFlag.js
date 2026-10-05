// audioLatencyFlag.js — the output buffer the stems' AudioContext asks for,
// there to try on a weak device: `?latency=playback` on any page asks for a
// large one (fewer, bigger audio callbacks: less to miss on a busy device
// that only plays the music), `?latency=interactive` for the small one, a
// number for seconds; `?latency=0` goes back to the browser's default
// (interactive). The choice lives in localStorage so it survives the join →
// party navigation; the debug overlay shows the latency it got.

const KEY = 'singpro_audio_latency';
const NAMES = new Set(['playback', 'balanced', 'interactive']);

/** A ?latency= value as a latencyHint, or null for the default */
export function parseLatencyHint(v) {
  if (v === null || v === undefined) return null;
  if (NAMES.has(v)) return v;
  const s = Number(v);
  return Number.isFinite(s) && s > 0 && s <= 1 ? s : null;
}

/** Call once at startup: a ?latency= parameter updates the stored choice. */
export function syncAudioLatencyFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('latency');
    if (v === null) return;
    if (parseLatencyHint(v) === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch { /* */ }
}

/** The latencyHint to create the stems' AudioContext with, or null for the browser's default */
export function audioLatencyHint() {
  try { return parseLatencyHint(localStorage.getItem(KEY)); } catch { return null; }
}
