/**
 * A song opened at a spot (the entry page's listen button: /sing/:id?t=83.2,
 * the video time the recognised music began at). The host's page seeks there
 * once the video plays, and joiners follow the host's clock.
 */

/** The `t` of a song URL's query, if it is a usable time (seconds, > 0) */
export function startAtFromSearch(search) {
  const raw = new URLSearchParams(search).get('t');
  const t = raw == null ? NaN : Number(raw);
  return Number.isFinite(t) && t > 0 && t < 4 * 3600 ? t : null;
}

/** The query without its `t` (after the seek, so a reload starts from the top) */
export function searchWithoutStartAt(search) {
  const p = new URLSearchParams(search);
  p.delete('t');
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Where to start for video time `t`: a second before the first note of the
 * line being sung there (or starting within half a second), so the singer
 * gets the whole line, when that line began no more than 8 s before `t`;
 * otherwise a second before `t` (an instrumental, a long held line).
 * `lyricData` as LyricsParser makes it: { bpm (x4), gap (ms), lyricLines }.
 */
export function startPoint(lyricData, t) {
  const { bpm, gap, lyricLines } = lyricData ?? {};
  let lineStart = null;
  if (bpm > 0 && Array.isArray(lyricLines)) {
    const seconds = (beat) => (gap || 0) / 1000 + (beat * 60) / bpm;
    for (const line of lyricLines) {
      const first = line.find(n => !n.isBreak);
      if (!first) continue;
      const s = seconds(first.start);
      if (s > t + 0.5) break;
      lineStart = s;
    }
  }
  const target = lineStart != null && t - lineStart <= 8 ? lineStart - 1 : t - 1;
  return Math.max(0, target);
}
