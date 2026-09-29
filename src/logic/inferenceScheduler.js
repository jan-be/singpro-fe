// inferenceScheduler.js — at most one pitch inference in flight, newest window first.
//
// The pitch worker used to be sent every window and was meant to skip one
// that arrived while an inference was running. With onnxruntime-web's WASM
// build that never happens: the worker only reads its next message after the
// previous inference has finished, so every window queues. A device slower
// than real time then falls further and further behind, and its notes are
// stamped later and later — it loses the song. Here the main thread keeps one
// request out and one waiting; a newer window replaces the waiting one, so a
// slow device skips windows instead of lagging.

/**
 * @param {(job: object) => void} send posts a job to the worker
 * @param {{ staleMs?: number, now?: () => number }} [options]
 *   staleMs: a request without an answer for this long counts as lost (a
 *   crashed or stuck worker must not stop detection for good)
 */
export function createInferenceScheduler(send, { staleMs = 1000, now = () => performance.now() } = {}) {
  let sentAt = null; // when the request in flight was sent; null when idle
  let waiting = null;
  let dropped = 0;

  const dispatch = (job) => {
    sentAt = now();
    send(job);
  };

  return {
    /** A new window: sent now if the worker is free, otherwise it waits (replacing an older one). */
    submit(job) {
      if (sentAt !== null && now() - sentAt < staleMs) {
        if (waiting) dropped++;
        waiting = job;
        return;
      }
      dispatch(job);
    },

    /** The worker answered: the waiting window, if any, goes next. */
    done() {
      sentAt = null;
      if (waiting) {
        const job = waiting;
        waiting = null;
        dispatch(job);
      }
    },

    /** Forget the waiting window (the song paused): it is stale when playback resumes. */
    clear() {
      if (waiting) dropped++;
      waiting = null;
    },

    /** Windows skipped so far because the worker was busy. */
    get dropped() { return dropped; },
  };
}
