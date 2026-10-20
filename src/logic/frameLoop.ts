/**
 * A loop on animation frames that keeps going in a background tab.
 *
 * A hidden tab gets no animation frames at all, so a loop on them stops
 * there: the host's page stopped telling the party and the server where the
 * song is (its video:time), auto-skips and the judged lyric line stood still,
 * and the score screen's countdown never reached the next song. While the
 * page is hidden the same step runs on a timer instead (browsers wake a
 * background tab's timers about once a second).
 *
 * @param {() => (boolean | void)} step  runs once per frame; false ends the loop
 * @param {object} [o]
 * @param {number} [o.hiddenMs]  the timer's interval while hidden
 * @param {Window} [o.win]
 * @returns {() => void} stops the loop
 */
export function frameLoop(step, { hiddenMs = 250, win = globalThis.window } = {}) {
  const doc = win.document;
  let rafId = null;
  let timer = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (rafId !== null) win.cancelAnimationFrame(rafId);
    if (timer !== null) win.clearTimeout(timer);
    rafId = timer = null;
    doc.removeEventListener('visibilitychange', schedule);
  };
  const run = () => {
    if (stopped) return;
    if (step() === false) { stop(); return; }
    schedule();
  };
  // One frame or one timer waits at a time: hidden, the frame asked for
  // before would only come once the tab is shown again (if at all)
  function schedule() {
    if (stopped) return;
    if (doc.visibilityState === 'hidden') {
      if (rafId !== null) { win.cancelAnimationFrame(rafId); rafId = null; }
      if (timer === null) timer = win.setTimeout(() => { timer = null; run(); }, hiddenMs);
    } else {
      if (timer !== null) { win.clearTimeout(timer); timer = null; }
      if (rafId === null) rafId = win.requestAnimationFrame(() => { rafId = null; run(); });
    }
  }

  doc.addEventListener('visibilitychange', schedule);
  schedule();
  return stop;
}
