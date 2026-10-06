/**
 * Where the note highway's WebGL renderer (highwayGL.js) runs: MusicBars
 * builds each frame as a scene (glScene.js) and hands it to a painter made
 * here, which draws it either
 *
 *   in a worker (HighwayWorker.js), on the page's canvas handed over as an
 *   OffscreenCanvas — wherever the browser can transfer a canvas and the
 *   worker can draw WebGL2 and text; or
 *   on the main thread, on the page's own <canvas> — where it cannot (no
 *   transferControlToOffscreen; no WebGL2 in workers, as in Safari before 17),
 *   or once a worker has failed.
 *
 * Why a worker: with CPU drawing (a Fire TV stick's WebView, old iPads) the
 * canvas's paint was most of the main thread's work per frame; the YouTube
 * player shares that thread in a WebView. From the worker the frame goes to
 * the compositor on its own, and the main thread only builds the scene.
 *
 * One frame at a time in the worker: while it still paints the last one, the
 * next is skipped (begin() returns null), so a slow device paints at the rate
 * it can and never queues up frames that are late. Buffers go back and forth
 * instead of being allocated per frame. A worker that stops answering (for
 * seconds and a hundred frames: not just a main thread that was stalled)
 * counts as failed; so does one whose WebGL context is lost. A canvas handed
 * to a failed worker is lost to the page, so MusicBars puts a new element in
 * and paints that one on the main thread from then on.
 *
 * Without WebGL2 on the main thread too, the highway is not drawn; the rest of
 * the page does not need it.
 *
 * Both painters take the same calls:
 *   mode         'worker', 'starting' (the worker has not said it can yet) or 'main', for ?debug
 *   ready        whether begin() can give a scene (before, every frame is skipped)
 *   begin(w, h, dpr)  the scene for the next frame of w x h device pixels, or null to skip it
 *   end()        draw what went into it
 *   destroy()
 *
 * To compare on a device, `?highway=main` paints on the main thread in this
 * browser (stored); `?highway=` with anything else goes back to the worker.
 */
import HighwayWorker from './HighwayWorker.js?worker';
import { GLScene } from './glScene';
import { createGLRenderer } from './highwayGL';
import { debugLog } from './debugLog';

const FLAG_KEY = 'singpro_highway';
const NO_ANSWER_MS = 3000;
const NO_ANSWER_FRAMES = 120;
const MAX_MAIN_LOSSES = 3; // contexts lost on the main thread before the highway stays off
let broken = false; // a worker failed once: the main thread paints from now on
let mainLosses = 0;

/** What the highway paints with right now, for ?debug (MusicBars fills it in). */
export const highwayStats = { mode: 'none', width: 0, height: 0, scale: 0, dpr: 0, maxSize: 0, level: 0, fps: 0, dropped: 0 };

/** Whether this browser was told to paint on the main thread (?highway=main, stored). */
function mainChosen() {
  try {
    const v = new URLSearchParams(window.location.search).get('highway');
    if (v === 'main') localStorage.setItem(FLAG_KEY, v);
    else if (v !== null) localStorage.removeItem(FLAG_KEY);
    const stored = localStorage.getItem(FLAG_KEY);
    if (stored === 'main') return true;
    // (an older choice, '2d' or 'gl', means nothing any more)
    if (stored !== null) localStorage.removeItem(FLAG_KEY);
  } catch { /* no storage: the worker */ }
  return false;
}

/** Whether to paint the highway in a worker. */
export function offThreadPainting() {
  if (broken || mainChosen()) return false;
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
  const scene = new GLScene();
  let spare = null; // the frame buffers back from the worker
  let ready = false;
  let busy = false;
  let sentAt = 0;
  let waited = 0; // frames skipped since the last one was sent
  let dead = false;

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
      ready = true;
      debugLog('highway', 'painting in a worker with WebGL');
    } else if (m.type === 'done') {
      busy = false;
      spare = m.buffers;
    } else if (m.type === 'error') fail(m.message);
  };
  worker.onerror = (e) => { e.preventDefault?.(); fail(e.message); };
  worker.onmessageerror = () => fail('message error');
  worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);

  return {
    get mode() { return ready ? 'worker' : 'starting'; },
    get ready() { return ready && !dead; },
    begin(w, h, dpr) {
      if (busy && ++waited > NO_ANSWER_FRAMES && performance.now() - sentAt > NO_ANSWER_MS) fail('no answer');
      if (busy || dead || !ready) return null;
      const buffers = spare;
      spare = null;
      return scene.begin(w, h, dpr, buffers);
    },
    end() {
      busy = true;
      sentAt = performance.now();
      waited = 0;
      try {
        const { scene: s, transfer } = scene.take();
        worker.postMessage({ type: 'scene', scene: s }, transfer);
      } catch (err) {
        fail(err?.message ?? err);
      }
    },
    destroy() {
      dead = true;
      worker.terminate();
    },
  };
}

/**
 * Paint `canvas` (the page's own) with WebGL on the main thread, or null
 * where WebGL2 cannot draw the highway here: then it is not drawn. `onLost`
 * is called once if the context is lost; the caller puts a new element in
 * (which gets a context of its own), up to MAX_MAIN_LOSSES times.
 */
export function createMainThreadPainter(canvas, onLost) {
  const off = (why) => {
    highwayStats.mode = 'off';
    console.warn('[highway] not drawn:', why);
    debugLog('highway', `not drawn: ${why}`);
    return null;
  };
  if (mainLosses >= MAX_MAIN_LOSSES) return off(`WebGL context lost ${mainLosses} times`);
  let dead = false;
  let renderer;
  try {
    renderer = createGLRenderer(canvas, {
      onLost: () => {
        if (dead) return;
        dead = true;
        mainLosses++;
        debugLog('highway', 'WebGL context lost on the main thread: a new canvas');
        onLost?.();
      },
    });
  } catch (err) {
    return off(`no WebGL2 on the main thread (${err?.message ?? err})`);
  }
  debugLog('highway', 'painting on the main thread with WebGL');
  const scene = new GLScene();
  return {
    mode: 'main',
    get ready() { return !dead; },
    begin(w, h, dpr) { return dead ? null : scene.begin(w, h, dpr); },
    end() { renderer.draw(scene.take().scene); },
    destroy() {
      dead = true;
      renderer.destroy();
    },
  };
}
