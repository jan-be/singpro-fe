/**
 * Which ticks the note highway (MusicBars) spans for a lyric line, which
 * gives the cursor its run-up to the line's first note, and the countdown
 * to a line after a long break.
 *
 * The cursor is the moment on one scale with the notes (tickToX), so it can
 * only be seen coming if the window starts before the first note. It does:
 * the first note sits LEAD_IN_SHARE of the width in, on every line, and the
 * cursor enters at the left edge and reaches it exactly when it is to be
 * sung, at the line's own speed. A share of the width and not a time: a fixed
 * half second was a sliver on a long line and a big gap on a short one, as
 * the line's scale decides how many pixels a second is. Without the run-up
 * the first note sat at the left edge and the cursor turned up on it just as
 * the singing started (on a chart whose first note is at tick 0, nearly all
 * of them, it stood there through the whole intro).
 *
 * The window never reaches back past the end of the line before: the line is
 * shown from that moment on (a silent tick belongs to the next line,
 * LyricsParser), so lines sung back to back get the room their pause has and
 * no more (their first note further left), and nothing of the last line falls
 * into the window. The notes keep the rest of the width: they stay on their
 * ticks, only the scale changes, and only per line. A line shorter than the
 * song's minimum is widened on the right, so its first note is where every
 * other line's is.
 */

/**
 * Where the first note sits, as a share of the width: 7 % (12 % took too
 * much of the line). Just clear of the side fade (EDGE_FADE, 5 %), so the
 * cursor is seen coming for the last 2 %; after a long break the countdown
 * says when.
 */
export const LEAD_IN_SHARE = 0.07;
/** A break this long or longer (no singing, the intro too) gets a countdown to the line after it. */
export const LONG_BREAK_SEC = 7;
/** The countdown's length: the ring empties over the last seconds before the first note. */
export const COUNTDOWN_SEC = 3;

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
 * `minLength`: the shortest window in ticks (from the song's median line).
 * Returns { startTick, endTick, firstTick, leadTicks, prevEnd } (firstTick:
 * the first note; leadTicks: the run-up it got; prevEnd: where the singing
 * before it ended, of either part).
 */
export function highwayWindow(parts, { minLength }) {
  let firstTick = Infinity, lastTick = -Infinity, prevEnd = -Infinity;
  for (const { line, prevEnd: before } of parts) {
    const lastEl = line[line.length - 1];
    firstTick = Math.min(firstTick, line[1].start);
    lastTick = Math.max(lastTick, lastEl.start + lastEl.length);
    prevEnd = Math.max(prevEnd, before ?? -Infinity); // the window shows once every part has moved on to it
  }
  const natural = lastTick - firstTick;
  const min = minLength ?? 0;
  // The width the line would get with its run-up its full share
  const full = Math.max(natural / (1 - LEAD_IN_SHARE), min);
  const lead = Math.min(LEAD_IN_SHARE * full, Math.max(0, firstTick - prevEnd));
  const startTick = firstTick - lead;
  return { startTick, endTick: startTick + Math.max(natural + lead, min), firstTick, leadTicks: lead, prevEnd };
}

/**
 * The countdown to the first note at `nowTick`: only after a break of
 * LONG_BREAK_SEC or more since the singing before (`prevEnd`, from
 * highwayWindow; before the first line the song's start, `songStartTick`),
 * over the last COUNTDOWN_SEC. Not between ordinary lines, where it would be
 * noise. Returns null, or { left: seconds to go, share: the ring still full
 * (1 → 0), digit: 3, 2, 1, alpha: faded in over its first quarter second, out
 * over the last }.
 */
export function countdown(nowTick, { firstTick, prevEnd, songStartTick = -Infinity, ticksPerSec }) {
  const since = Math.max(prevEnd, songStartTick);
  if (!(ticksPerSec > 0) || (firstTick - since) / ticksPerSec < LONG_BREAK_SEC) return null;
  const left = (firstTick - nowTick) / ticksPerSec;
  if (!(left > 0 && left <= COUNTDOWN_SEC)) return null;
  return {
    left,
    share: left / COUNTDOWN_SEC,
    digit: Math.ceil(left),
    alpha: Math.round(Math.min(1, (COUNTDOWN_SEC - left) / 0.25, left / 0.25) * 100) / 100,
  };
}

/**
 * The cursor's opacity: 0.6 from the first note on, and on the way to it
 * from 0.35 at the start of its run-up (leadTicks, the line's share of the
 * width), brightening as it closes in. Two decimals, so a run-up is a few
 * dozen colours, not one per frame.
 */
export function cursorAlpha(tick, firstTick, leadTicks) {
  const ahead = leadTicks > 0 ? Math.min(1, Math.max(0, (firstTick - tick) / leadTicks)) : 0;
  return Math.round((0.6 - 0.25 * ahead) * 100) / 100;
}
