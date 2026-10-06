/**
 * Which ticks the note highway (MusicBars) spans for a lyric line, which
 * gives the cursor its run-up to the line's first note.
 *
 * The cursor is the moment on one scale with the notes (tickToX), so it can
 * only be seen coming if the window starts before the first note. It does,
 * by up to LEAD_IN_SEC: the cursor enters at the left edge and reaches the
 * first note exactly when it is to be sung, at the line's own speed. Without
 * that room the first note sat at the left edge and the cursor turned up on
 * it just as the singing started (on a chart whose first note is at tick 0,
 * nearly all of them, it stood there through the whole intro).
 *
 * The window never reaches back past the end of the line before: the line is
 * shown from that moment on (a silent tick belongs to the next line,
 * LyricsParser), so lines sung back to back get the room their pause has and
 * no more, and nothing of the last line falls into the window. The run-up is
 * at most half as long as the line (or the minimum a short line is widened
 * to), a third of the width, so the notes keep most of it. They stay on their
 * ticks: only the scale changes, and only per line.
 */

/** The run-up to a line after a pause (the intro, a break), in seconds. */
export const LEAD_IN_SEC = 1.5;

/**
 * Where the last note before line `lineIndex` of `lyricLines` ends, in ticks;
 * -Infinity before the first line. A line is [its break, ...its notes], and
 * a line of a break alone is skipped.
 */
export function previousLineEnd(lyricLines, lineIndex) {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lyricLines?.[i];
    const last = line?.[line.length - 1];
    if (last && !last.isBreak) return last.start + last.length;
  }
  return -Infinity;
}

/**
 * The window of the highway for the parts on screen: `parts` = [{ line,
 * prevEnd }] (a duet's two parts, else one), `prevEnd` from previousLineEnd.
 * `minLength`: the shortest window in ticks (from the song's median line),
 * which a short line is widened to on both sides, as before. Returns
 * { startTick, endTick, firstTick } (firstTick: the first note).
 */
export function highwayWindow(parts, { minLength, ticksPerSec }) {
  let firstTick = Infinity, lastTick = -Infinity, prevEnd = -Infinity;
  for (const { line, prevEnd: before } of parts) {
    const lastEl = line[line.length - 1];
    firstTick = Math.min(firstTick, line[1].start);
    lastTick = Math.max(lastTick, lastEl.start + lastEl.length);
    prevEnd = Math.max(prevEnd, before ?? -Infinity); // the window shows once every part has moved on to it
  }
  const natural = lastTick - firstTick;
  const span = Math.max(natural, minLength ?? natural);
  const room = Math.max(0, firstTick - prevEnd);
  const lead = Math.min(LEAD_IN_SEC * ticksPerSec, room, span / 2);
  // What a short line still lacks of the minimum: half on each side, on the
  // left as far as the pause allows, the rest on the right
  const short = Math.max(0, span - natural - lead);
  const left = Math.min(room, lead + short / 2);
  const right = short - (left - lead);
  return { startTick: firstTick - left, endTick: lastTick + right, firstTick };
}

/**
 * The cursor's opacity: 0.6 from the first note on, and on the way to it
 * from 0.35, LEAD_IN_SEC before, brightening as it closes in. Two decimals,
 * so a run-up is a few dozen colours, not one per frame.
 */
export function cursorAlpha(tick, firstTick, ticksPerSec) {
  const ahead = Math.min(1, Math.max(0, (firstTick - tick) / (LEAD_IN_SEC * ticksPerSec)));
  return Math.round((0.6 - 0.25 * ahead) * 100) / 100;
}
