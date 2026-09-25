import { hzToSemitone } from './MicSharedFuns';

/**
 * Which of a singer's notes the note highway shows on the current line, and
 * the chart tone each one aims at.
 *
 * A sung pitch is shown within a second of a note of the singer's own part
 * (the grace window) and hidden in that part's quiet stretches, where the
 * score ignores it as well. So a duet's second-part singer is drawn along the
 * second part's notes even while the first part rests, and the other way
 * round. With one window for everyone, built from the first part's notes, the
 * second singer vanished on every line the first part sat out.
 */

/**
 * The grace window of a part on the current line: sorted, merged [start, end]
 * tick intervals within `graceTicks` of its notes. Merged so the per-note
 * check is a short scan instead of a pass over every syllable.
 */
export function graceIntervals(expectedNotes, graceTicks) {
  const intervals = expectedNotes
    .map(el => [el.start - graceTicks, el.start + el.length + graceTicks])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/** Whether tick `t` lies in one of the sorted intervals. */
export const inIntervals = (intervals, t) => {
  for (let i = 0; i < intervals.length; i++) {
    if (t < intervals[i][0]) return false;
    if (t <= intervals[i][1]) return true;
  }
  return false;
};

/**
 * The chart tone a note at tick `tf` aims at: the syllable of `chart` at its
 * tick or, in the grace period around notes, the nearest one within
 * `graceTicks`; undefined in a quiet stretch.
 */
export function targetToneNear(chart, tf, graceTicks) {
  const toneAt = (tick) => {
    const ref = chart?.lyricRefs?.[tick];
    const syl = ref && !ref.isSilent ? chart?.lyricLines?.[ref.lineIndex]?.[ref.syllableIndex] : null;
    return syl?.tone;
  };
  const tick = Math.floor(Math.max(0, tf));
  const here = toneAt(tick);
  if (here !== undefined) return here;
  for (let d = 1; d <= graceTicks; d++) {
    const ahead = toneAt(tick + d);
    if (ahead !== undefined) return ahead;
    const behind = toneAt(tick - d);
    if (behind !== undefined) return behind;
  }
  return undefined;
}

/**
 * One singer's notes on the visible line, oldest first, each with the tone it
 * aims at. `notes` is the live store's list for the singer, { videoTime, freq }
 * in arrival order; it is walked from the newest note backwards and left as
 * soon as it is before the line, so the cost is the notes on screen, not
 * everything kept. A note's semitone is cached on it (`st`).
 *
 * @param {object} line
 * @param {object} line.chart          the singer's part: lyricRefs and lyricLines
 * @param {number[][]} line.grace      that part's grace window (graceIntervals)
 * @param {number} line.lineStartTick  visible range in ticks
 * @param {number} line.lastLineTick
 * @param {number} line.ticksPerSec
 * @param {number} line.gapSec         the gap the song plays at, in seconds
 */
export function singerNotesOnLine(notes, { chart, grace, lineStartTick, lastLineTick, ticksPerSec, gapSec }) {
  const graceTicks = Math.ceil(ticksPerSec);
  const visible = [];
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const tf = ticksPerSec * (n.videoTime - gapSec);
    if (tf > lastLineTick) continue;
    if (tf < lineStartTick) break;
    if (n.freq <= 0 || !inIntervals(grace, tf)) continue;
    const raw = n.st ?? (n.st = hzToSemitone(n.freq));
    visible.push({ tf, videoTime: n.videoTime, raw, rawSemitone: raw, target: targetToneNear(chart, tf, graceTicks) });
  }
  return visible.reverse();
}
