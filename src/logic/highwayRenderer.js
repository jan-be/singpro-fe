/**
 * The main-thread side of painting the note highway in a worker
 * (HighwayWorker.js): the page's canvas is handed over as an OffscreenCanvas,
 * and MusicBars paints each frame through a painter (highwayPainters.js) that
 * either builds a WebGL scene (glScene.js; the worker draws it with
 * highwayGL.js) or records 2D canvas calls (canvasRecorder.js; the worker
 * replays them). The worker says which it can once it has the canvas: WebGL
 * where it works there, 2D otherwise; until then frames are skipped.
 *
 * Why: with CPU drawing (a Fire TV stick's WebView, old iPads) the canvas's
 * paint was most of the main thread's work per frame, and its raster went into
 * the page's tiles every frame; the YouTube player shares that thread in a
 * WebView. From the worker the frame goes to the compositor on its own.
 * Recording costs the main thread a fraction of painting. With WebGL the
 * filling of the pixels moves on to the GPU as well.
 *
 * One frame at a time: while the worker still paints the last one, the next
 * is skipped (begin() returns null), so a slow device paints at the rate it
 * can and never queues up frames that are late. Buffers go back and forth
 * instead of being allocated per frame. A worker that stops answering (for
 * seconds and a hundred frames: not just a main thread that was stalled)
 * counts as failed.
 *
 * Where the browser cannot transfer a canvas, or the worker fails, MusicBars
 * paints on the main thread. Apple's WebKit (Safari, and every browser on an
 * iPhone or iPad) paints in 2D by default until the WebGL highway has been
 * seen on one. To compare on a device, `?highway=` sets it for this browser
 * (stored): `main` (the main thread, 2D), `2d` (the worker, 2D), `gl` (the
 * worker, WebGL where it can); anything else goes back to the default.
 */
import HighwayWorker from './HighwayWorker.js?worker';
import { CanvasRecorder } from './canvasRecorder';
import { Canvas2DPainter } from './highwayPainters';
import { GLScene } from './glScene';
import { debugLog } from './debugLog';

const FLAG_KEY = 'singpro_highway';
const NO_ANSWER_MS = 3000;
const NO_ANSWER_FRAMES = 120;
let broken = false; // a worker failed once: the main thread paints from now on

/** What the highway paints with right now, for ?debug (MusicBars fills it in). */
export const highwayStats = { mode: 'none', width: 0, height: 0, scale: 0, dpr: 0, maxSize: 0, level: 0, fps: 0, dropped: 0 };

const MODES = ['main', '2d', 'gl'];

/** WebGL, except on Apple's WebKit for now (see above). */
const defaultMode = () => (typeof navigator !== 'undefined' && navigator.vendor === 'Apple Computer, Inc.' ? '2d' : 'gl');

/** 'main', '2d' or 'gl': what this browser was told to paint with (?highway=, stored), else the default. */
function chosenMode() {
  try {
    const v = new URLSearchParams(window.location.search).get('highway');
    if (MODES.includes(v)) localStorage.setItem(FLAG_KEY, v);
    else if (v !== null) localStorage.removeItem(FLAG_KEY);
    const stored = localStorage.getItem(FLAG_KEY);
    if (MODES.includes(stored)) return stored;
  } catch { /* no storage: the default */ }
  return defaultMode();
}

/** Whether to paint the highway in a worker. */
export function offThreadPainting() {
  if (broken || chosenMode() === 'main') return false;
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
  const scene = new GLScene();
  const spare = []; // frame buffers back from the worker
  let spareScene = null;
  let mode = null; // 'gl' | '2d' once the worker said
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
    debugLog('highway', `worker failed, painting on the main thread: ${why}`);
    onFail?.();
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') {
      mode = m.mode;
      debugLog('highway', `painting in a worker with ${mode === 'gl' ? 'WebGL' : '2D'}`);
    }
    else if (m.type === 'done') {
      busy = false;
      if (m.buffers) spareScene = m.buffers;
      else spare.push(m.ops);
    } else if (m.type === 'error') fail(m.message);
  };
  worker.onerror = (e) => { e.preventDefault?.(); fail(e.message); };
  worker.onmessageerror = () => fail('message error');
  worker.postMessage({ type: 'init', canvas: offscreen, gl: chosenMode() === 'gl' }, [offscreen]);

  return {
    /** What paints in the worker, for ?debug: 'gl', 'worker' (2D), or 'starting'. */
    get mode() { return mode === 'gl' ? 'gl' : mode === '2d' ? 'worker' : 'starting'; },
    /** Whether the worker has said what it paints with (before that, begin() skips every frame). */
    get ready() { return mode !== null; },
    /**
     * A painter for the next frame of `w` x `h` device pixels (`dpr` per CSS
     * pixel; `caches`: Canvas2DPainter's), or null to skip it.
     */
    begin(w, h, dpr, caches) {
      if (busy && ++waited > NO_ANSWER_FRAMES && performance.now() - sentAt > NO_ANSWER_MS) fail('no answer');
      if (busy || dead || !mode) return null;
      width = w;
      height = h;
      if (mode === 'gl') {
        const buffers = spareScene;
        spareScene = null;
        return scene.begin(w, h, dpr, buffers);
      }
      return new Canvas2DPainter(recorder.begin(w, h, spare.pop() ?? new Float64Array(8192)), caches, dpr);
    },
    /** Send what was painted since begin(). */
    end() {
      busy = true;
      sentAt = performance.now();
      waited = 0;
      try {
        if (mode === 'gl') {
          const { scene: s, transfer } = scene.take();
          worker.postMessage({ type: 'scene', scene: s }, transfer);
        } else {
          const { frame, transfer } = recorder.take();
          worker.postMessage({ type: 'frame', width, height, frame }, transfer);
        }
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
