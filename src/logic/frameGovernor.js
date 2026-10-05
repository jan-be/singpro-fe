/**
 * A frame-rate governor for per-frame painters (the note highway; the lyric
 * sweep could use one too): when the page cannot keep up — the animation loop
 * runs well under the display's rate — paint only every 2nd or 3rd frame, at a
 * steady cadence, so the main thread keeps headroom for the video player and
 * the rest of the page; back to every frame once there is room again.
 *
 * The signal is the rate of the frames themselves, counted per second (a
 * starved page shows bursts of quick frames between long stalls, so the
 * median interval says little; the count says it). The target is 60 a second,
 * or the display's own rate when that is lower (a 50 Hz TV); a 120 Hz phone
 * running the page at 60 is fine, not overloaded. Stepping back down is a
 * probe: if the rate falls again right after, the step is undone and the next
 * probe waits twice as long, so a device on the edge does not flip back and
 * forth every second.
 *
 * Usage, once per animation frame:
 *   const governor = createFrameGovernor();
 *   const steps = governor.frame(performance.now());
 *   if (steps === 0) return;   // skip this frame
 *   paint(steps);              // steps = frames this paint stands for (to advance animations by)
 */

/** Frame rate the governor aims to keep, unless the display is slower. */
export const TARGET_FPS = 60;

export function createFrameGovernor({
  maxDivisor = 3,
  overload = 0.67, // below this share of the target rate: paint less often
  recover = 0.9, // at least this share, for `probationMs`: try painting more often again
  windowMs = 1000,
  stallMs = 2500, // a gap this long is a background tab or a paused page, not a frame rate
  probationMs = 3000,
  maxProbationMs = 30000,
} = {}) {
  let divisor = 1;
  let sincePaint = 0; // frames since the last paint
  let last = null; // timestamp of the previous frame
  let minInterval = Infinity; // the shortest frame interval seen: the display's refresh, or close to it
  let windowStart = null;
  let windowFrames = 0;
  let calmMs = 0; // how long the rate has been good at the current divisor
  let probation = probationMs;
  let probeWindows = 0; // > 0: windows left in which a step down is still being tried out

  const targetFps = () => Math.min(TARGET_FPS, minInterval >= 4 && minInterval < Infinity ? 1000 / minInterval : TARGET_FPS);

  const judge = (fps, elapsed) => {
    const target = targetFps();
    if (fps < overload * target) {
      calmMs = 0;
      if (probeWindows > 0) {
        // the step down did not hold: undo it and wait longer before the next try
        probeWindows = 0;
        probation = Math.min(maxProbationMs, probation * 2);
      }
      if (divisor < maxDivisor) divisor++;
      return;
    }
    if (probeWindows > 0) probeWindows--;
    if (divisor === 1) return;
    if (fps >= recover * target) {
      calmMs += elapsed;
      if (calmMs >= probation) {
        divisor--;
        calmMs = 0;
        probeWindows = 2;
      }
    } else calmMs = 0;
  };

  return {
    /** Frames per paint right now: 1 = every frame. */
    get divisor() { return divisor; },

    /**
     * Count one animation frame at `now` (ms). Returns 0 to skip it, else
     * the number of frames since the last paint, this one included.
     */
    frame(now) {
      if (last !== null) {
        const dt = now - last;
        if (dt > stallMs) {
          // a background tab or a paused page, not a frame rate: start over
          windowStart = null;
          sincePaint = divisor - 1;
        } else if (dt >= 4 && dt < minInterval) minInterval = dt;
      }
      last = now;
      if (windowStart === null) {
        windowStart = now;
        windowFrames = 0;
      } else {
        windowFrames++;
        const elapsed = now - windowStart;
        if (elapsed >= windowMs) {
          judge((windowFrames * 1000) / elapsed, elapsed);
          windowStart = now;
          windowFrames = 0;
        }
      }
      sincePaint++;
      if (sincePaint < divisor) return 0;
      const steps = sincePaint;
      sincePaint = 0;
      return steps;
    },
  };
}
