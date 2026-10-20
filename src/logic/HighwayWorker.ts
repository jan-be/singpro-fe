/**
 * Paints the note highway off the main thread, onto the page's canvas,
 * transferred here as an OffscreenCanvas: with WebGL where it works here
 * (highwayGL.js: MusicBars builds each frame as a scene, glScene.js), else
 * with a 2D context (MusicBars records each frame, canvasRecorder.js, and this
 * worker replays it). The worker's frames go to the compositor directly, so
 * neither the drawing nor the canvas's raster lands on the main thread that
 * the page, React and the YouTube player share. See highwayRenderer.js for
 * the main-thread side.
 *
 * Messages in:  { type: 'init', canvas, gl } — gl: try WebGL first
 *               { type: 'frame', width, height, frame } — a CanvasRecorder's take().frame;
 *               frame.attached.layer, when the line's static picture changed: a
 *               recording of it { ops, n, strings, width, height }, copied in by
 *               the frame's 'drawLayer' op
 *               { type: 'scene', scene } — a GLScene's take().scene
 * Messages out: { type: 'ready', mode: 'gl' | '2d' } — what it paints with
 *               { type: 'done', ops } / { type: 'done', buffers } — the frame's buffers back, for reuse
 *               { type: 'error', message }
 */
import { replayCanvas } from './canvasRecorder';
import { paintBackdrop, fadeEdges, copyIn, createCanvas } from './highwayPaint';
import { glUsable, createGLRenderer } from './highwayGL';

let canvas = null;
let ctx = null;
let gl = null;
let layerCanvas = null;
const band = { current: null };
const fades = { current: null };
const images = new Map(); // picture id -> ImageBitmap

/**
 * Whether this worker can draw text: not a given for OffscreenCanvas in
 * workers on every engine that has it (early Safari versions are the worry).
 * Without it the main thread paints instead (WebGL draws its text with a 2D
 * canvas too).
 */
function canDrawText() {
  const c = new OffscreenCanvas(16, 16).getContext('2d');
  if (!c) return false;
  c.font = 'bold 12px sans-serif';
  c.fillStyle = '#fff';
  c.fillText('W', 1, 13);
  const px = c.getImageData(0, 0, 16, 16).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) return true;
  return false;
}

const specials = {
  backdrop: (c) => paintBackdrop(c, band),
  fade: (c, width) => fadeEdges(c, width, fades),
  drawLayer: (c) => { if (layerCanvas) copyIn(c, layerCanvas); },
};

const fail = (err) => self.postMessage({ type: 'error', message: String(err?.message ?? err) });

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      canvas = m.canvas;
      if (!canDrawText()) throw new Error('the worker cannot draw text');
      if (m.gl && glUsable()) {
        try {
          gl = createGLRenderer(canvas, { onLost: () => fail('WebGL context lost') });
        } catch (err) {
          // the canvas may be WebGL's now: no 2D on it any more, the main thread paints
          throw new Error(`WebGL: ${err?.message ?? err}`);
        }
        self.postMessage({ type: 'ready', mode: 'gl' });
        return;
      }
      const c = canvas.getContext('2d');
      if (!c) throw new Error('no 2D context in the worker');
      ctx = c;
      self.postMessage({ type: 'ready', mode: '2d' });
      return;
    }
    if (m.type === 'scene' && gl) {
      const { scene } = m;
      gl.draw(scene);
      const buffers = { boxes: scene.boxes, strokes: scene.strokes, verts: scene.verts, sprites: scene.sprites };
      self.postMessage({ type: 'done', buffers }, [scene.boxes.buffer, scene.strokes.buffer, scene.verts.buffer, scene.sprites.buffer]);
      return;
    }
    if (m.type !== 'frame' || !ctx) return;
    const { frame } = m;
    for (const id of frame.forget) images.get(id)?.close?.();
    for (const id of frame.forget) images.delete(id);
    for (const { id, image } of frame.images) images.set(id, image);
    // resizing clears the canvas and resets its state, as on the main thread
    if (canvas.width !== m.width) canvas.width = m.width;
    if (canvas.height !== m.height) canvas.height = m.height;
    const layer = frame.attached.layer;
    if (layer) {
      if (!layerCanvas) layerCanvas = createCanvas(layer.width, layer.height);
      layerCanvas.width = layer.width; // (re)sizing clears it
      layerCanvas.height = layer.height;
      replayCanvas(layerCanvas.getContext('2d'), layer, specials, images);
    }
    replayCanvas(ctx, frame, specials, images);
    // (rasterised when the compositor takes the next frame, not here)
    self.postMessage({ type: 'done', ops: frame.ops }, [frame.ops.buffer]);
  } catch (err) {
    fail(err);
  }
};
