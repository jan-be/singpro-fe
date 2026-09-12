/**
 * Where in the song somebody actually sings, for the timeline: one region per
 * stretch of lyric lines, in seconds of video time, per singer.
 */

/** Regions closer together than this are drawn as one (short breaths between lines). */
const MERGE_GAP_SECONDS = 0.75;

const lineRegions = (lyricLines, toSeconds) => {
  const out = [];
  for (const line of lyricLines ?? []) {
    const notes = line.filter(el => !el.isBreak);
    if (!notes.length) continue;
    const start = toSeconds(notes[0].start);
    const end = toSeconds(notes[notes.length - 1].start + notes[notes.length - 1].length);
    const last = out[out.length - 1];
    if (last && start - last.end <= MERGE_GAP_SECONDS) last.end = Math.max(last.end, end);
    else out.push({ start, end });
  }
  return out;
};

/**
 * @param {object} lyricData parsed UltraStar data (bpm, gap in ms, lyricLines, optional p2.lyricLines)
 * @returns {Array<{ start: number, end: number, player: 1|2 }>} sorted by start
 */
export function songRegions(lyricData) {
  if (!lyricData?.bpm || !lyricData.lyricLines) return [];
  const gapSec = (Number(lyricData.gap) || 0) / 1000;
  const toSeconds = tick => gapSec + tick / (lyricData.bpm / 60);
  const p1 = lineRegions(lyricData.lyricLines, toSeconds).map(r => ({ ...r, player: 1 }));
  const p2 = lineRegions(lyricData.p2?.lyricLines, toSeconds).map(r => ({ ...r, player: 2 }));
  return [...p1, ...p2].sort((a, b) => a.start - b.start || a.player - b.player);
}

/** Current video time for a frame of the live store (seconds), or 0. */
export const frameSeconds = (tickData) => {
  const ld = tickData?.lyricData;
  if (!ld?.bpm) return 0;
  return (Number(ld.gap) || 0) / 1000 + (tickData.tickFloat ?? 0) / (ld.bpm / 60);
};

export const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
