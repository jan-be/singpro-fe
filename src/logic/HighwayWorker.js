/**
 * Paints the note highway off the main thread with WebGL (highwayGL.js), onto
 * the page's canvas, transferred here as an OffscreenCanvas: MusicBars builds
 * each frame as a scene (glScene.js) and sends it over. The worker's frames go
 * to the compositor directly, so neither the drawing nor the canvas's raster
 * lands on the main thread that the page, React and the YouTube player share.
 * See highwayRenderer.js for the main-thread side.
 *
 * Where WebGL2 or text does not work in a worker (Safari before 17 has no
 * WebGL on an OffscreenCanvas), init answers with an error: the canvas is lost
 * to the page then, and MusicBars draws the same renderer on a new one on the
 * main thread.
 *
 * Messages in:  { type: 'init', canvas }
 *               { type: 'scene', scene } — a GLScene's take().scene
 * Messages out: { type: 'ready' } — it can paint
 *               { type: 'done', buffers } — the frame's buffers back, for reuse
 *               { type: 'error', message }
 */
import { createGLRenderer } from './highwayGL';

let gl = null;

/**
 * Whether this worker can draw text: not a given for OffscreenCanvas in
 * workers on every engine that has it (early Safari versions are the worry).
 * The renderer draws its text with a 2D canvas.
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

const fail = (err) => self.postMessage({ type: 'error', message: String(err?.message ?? err) });

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      if (!canDrawText()) throw new Error('the worker cannot draw text');
      try {
        gl = createGLRenderer(m.canvas, { onLost: () => fail('WebGL context lost') });
      } catch (err) {
        throw new Error(`WebGL: ${err?.message ?? err}`);
      }
      self.postMessage({ type: 'ready' });
      return;
    }
    if (m.type === 'scene' && gl) {
      const { scene } = m;
      gl.draw(scene);
      // (rasterised when the compositor takes the next frame, not here)
      const buffers = { boxes: scene.boxes, strokes: scene.strokes, verts: scene.verts, sprites: scene.sprites };
      self.postMessage({ type: 'done', buffers }, [scene.boxes.buffer, scene.strokes.buffer, scene.verts.buffer, scene.sprites.buffer]);
    }
  } catch (err) {
    fail(err);
  }
};
