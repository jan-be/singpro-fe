/**
 * A song opened at a spot (the entry page's listen button: /sing/:id?t=83.2,
 * the video time the recognised music began at). The host's page seeks there
 * once the video plays, and joiners follow the host's clock.

 *
 * Or the spot the party is at: a host page loaded again (F5, the same /sing
 * link) while its party still sings that song goes on from there
 * (resumeTime), its player started at that spot.
 */

import type { TimedLyrics, LyricElement } from './LyricsParser';

/** What startPoint reads of a chart (TimedLyrics) */
export type StartPointChart = Pick<TimedLyrics, 'bpm' | 'gap'> & { lyricLines: Pick<LyricElement, 'isBreak' | 'start'>[][] };

/** What resumeTime reads of the party's currentSong (party:state) */
export interface PartySongState {
  songId?: string | null;
  /** the play is over; a server from before the flag sends none */
  ended?: boolean | null;
  hostVideoTime?: number | null;
  playedSeconds?: number | null;
}

/** The `t` of a song URL's query, if it is a usable time (seconds, > 0) */
export function startAtFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('t');
  const t = raw == null ? NaN : Number(raw);
  return Number.isFinite(t) && t > 0 && t < 4 * 3600 ? t : null;
}

/** The query without its `t` (after the seek, so a reload starts from the top) */
export function searchWithoutStartAt(search: string): string {
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
export function startPoint(lyricData: StartPointChart | null | undefined, t: number): number {
  const { bpm, gap, lyricLines } = lyricData ?? {};
  let lineStart: number | null = null;
  if (bpm! > 0 && Array.isArray(lyricLines)) {
    const seconds = (beat: number) => (gap || 0) / 1000 + (beat * 60) / bpm!;
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

/**
 * Where a host page loaded again in its party goes on with the party's song:
 * `song` is the party's currentSong from its first party:state, `songId` the
 * page's. song:start would save the play as stopped and start everyone from
 * the top (party CBHM sang "Roar" from the start three times in 90 s,
 * 2026-10-18). -> the song time to go on from (the last one the host's video
 * reported), or null when the page starts its song as before: another song,
 * a play that is over (`ended`; a server from before that flag says nothing,
 * which counts as over), or a page opened at a spot of its own (`openedAt`,
 * the listen button's ?t=).
 */
export function resumeTime(song: PartySongState | null | undefined, songId: string | null | undefined, { openedAt = null }: { openedAt?: number | null } = {}): number | null {
  if (!song?.songId || !songId || String(song.songId).toLowerCase() !== String(songId).toLowerCase()) return null;
  if (song.ended !== false || openedAt != null) return null;
  for (const t of [song.hostVideoTime, song.playedSeconds]) {
    if (t != null && Number.isFinite(Number(t)) && Number(t) >= 0) return Number(t);
  }
  return 0; // on, but no time heard yet: from the top, the scores kept
}
