// stemSync.js — when the stems are restarted to follow the song's clock.
//
// A restart is a jump in the music (crossfaded, see stemPlayer.js), so it
// is only made when the stems are really off. Both clocks the stems follow
// are lower bounds of the truth: the host's video clock (videoClock.js: a
// report can be stale, never early) and a joiner's host time (a message can
// arrive late, never early, and that clock never steps back). So a clock
// ahead of the stems is proof they are behind: they follow at once. A clock
// a little behind the stems may only be late news — the old rule restarted
// the stems back on it every half second on a starved Fire TV — so that has
// to hold for a while before the stems step back. Neither clock falls a
// second behind by lateness (they keep the best news they had), so that far
// back is a seek, followed at once.

export const TOLERANCE = 0.1;    // s: what the stems may be off without a restart
export const IMMEDIATE = 0.03;   // s: a start or a seek of ours, where any difference counts
export const HOLD_BEHIND = 1.5;  // s: how long the clock must stay behind the stems before they step back
export const JUMP_BACK = 1;      // s: a clock this far behind the stems was moved back

/**
 * Decides on one check whether to restart the stems at the clock's time.
 * @param {number} drift   clock − stems, in seconds (positive: the stems are behind)
 * @param {number} now     seconds, any steady clock
 * @param {object} memo    the caller's { behindSince }, kept between checks
 * @param {boolean} [immediate]  a start or a seek of ours: any difference beyond IMMEDIATE counts at once
 * @returns {boolean} restart now
 */
export function shouldRestart(drift, now, memo, immediate = false) {
  if (immediate) { memo.behindSince = null; return Math.abs(drift) > IMMEDIATE; }
  if (drift > TOLERANCE) { memo.behindSince = null; return true; }
  if (drift < -JUMP_BACK) { memo.behindSince = null; return true; }
  if (drift < -TOLERANCE) {
    if (memo.behindSince == null) memo.behindSince = now;
    if (now - memo.behindSince < HOLD_BEHIND) return false;
    memo.behindSince = null;
    return true;
  }
  memo.behindSince = null;
  return false;
}
