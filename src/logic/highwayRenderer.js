/**
 * The main-thread side of painting the note highway in a worker
 * (HighwayWorker.js): the page's canvas is handed over as an OffscreenCanvas,
 * MusicBars records each frame into a CanvasRecorder (canvasRecorder.js)
 * instead of a 2D context, and the recording goes to the worker, which
 * replays it.
 *
 * Why: with CPU drawing (a Fire TV stick's WebView, old iPads) the canvas's
 * paint was most of the main thread's work per frame, and its raster went into
 * the page's tiles every frame; the YouTube player shares that thread in a
 * WebView. From the worker the frame goes to the compositor on its own.
 * Recording costs the main thread a fraction of painting.
 *
 * One frame at a time: while the worker still paints the last one, the next
 * is skipped (begin() returns null), so a slow device paints at the rate it
 * can and never queues up frames that are late. Buffers go back and forth
 * instead of being allocated per frame. A worker that stops answering (for
 * seconds and a hundred frames: not just a main thread that was stalled)
 * counts as failed.
 *
 * Where the browser cannot transfer a canvas, or the worker fails, MusicBars
 * paints on the main thread as before. `?highway=main` forces that for this
 * browser (stored; `?highway=worker` undoes it), to compare on a device.
 */
import HighwayWorker from './HighwayWorker.js?worker';
import { CanvasRecorder } from './canvasRecorder';

const FLAG_KEY = 'singpro_highway';
const NO_ANSWER_MS = 3000;
const NO_ANSWER_FRAMES = 120;
let broken = false; // a worker failed once: the main thread paints from now on

/** Whether to paint the highway in a worker. */
export function offThreadPainting() {
  if (broken) return false;
  try {
    const v = new URLSearchParams(window.location.search).get('highway');
    if (v === 'main') localStorage.setItem(FLAG_KEY, 'main');
    else if (v !== null) localStorage.removeItem(FLAG_KEY);
    if (localStorage.getItem(FLAG_KEY) === 'main') return false;
  } catch { /* no storage: the default */ }
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

/**
 * Hand `canvas` to a new worker. Throws if it cannot be transferred (then the
 * canvas is still the main thread's). `onFail` is called once if the worker
 * fails later; the canvas is lost to the main thread then, so the caller
 * replaces the element.
 */
export function createOffThreadPainter(canvas, onFail) {
  const worker = new HighwayWorker();
  let offscreen;
  try {
    offscreen = canvas.transferControlToOffscreen();
  } catch (err) {
    worker.terminate();
    throw err;
  }
  const recorder = new CanvasRecorder();
  const spare = []; // frame buffers back from the worker
  let busy = false;
  let sentAt = 0;
  let waited = 0; // frames skipped since the last one was sent
  let dead = false;
  let width = 0;
  let height = 0;

  const fail = (why) => {
    if (dead) return;
    dead = broken = true;
    worker.terminate();
    console.warn('[highway] worker failed, painting on the main thread:', why);
    onFail?.();
  };
  worker.onmessage = (e) => {
    if (e.data.type === 'done') {
      busy = false;
      spare.push(e.data.ops);
    } else if (e.data.type === 'error') fail(e.data.message);
  };
  worker.onerror = (e) => { e.preventDefault?.(); fail(e.message); };
  worker.onmessageerror = () => fail('message error');
  worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);

  return {
    /** A recorder for the next frame of `width` x `height` device pixels, or null to skip it. */
    begin(w, h) {
      if (busy && ++waited > NO_ANSWER_FRAMES && performance.now() - sentAt > NO_ANSWER_MS) fail('no answer');
      if (busy || dead) return null;
      width = w;
      height = h;
      return recorder.begin(w, h, spare.pop() ?? new Float64Array(8192));
    },
    /** Send what was recorded since begin(). */
    end() {
      const { frame, transfer } = recorder.take();
      busy = true;
      sentAt = performance.now();
      waited = 0;
      try {
        worker.postMessage({ type: 'frame', width, height, frame }, transfer);
      } catch (err) {
        fail(err?.message ?? err);
      }
    },
    /** The recorder, to let go of pictures (CanvasRecorder.forgetImage). */
    recorder,
    destroy() {
      dead = true;
      worker.terminate();
    },
  };
}
