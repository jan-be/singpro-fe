/**
 * A frame of the note highway as a WebGL scene: the painter calls of
 * highwayPainters.js turned into instance data for the worker's WebGL
 * renderer (highwayGL.js), which draws each kind of shape with one shader:
 *
 *   boxes     rounded rectangles, filled and/or outlined (dashed for rap notes):
 *             notes, outlines, the grid, the cursor, tag backgrounds
 *   strokes   round-capped line segments with up to three bands (halo, line,
 *             core): the sung lines, single sung notes, sparkles. A line's
 *             segments share their points (verts), and every pixel is drawn
 *             by the segment nearest to it only, so a translucent halo stays
 *             even where the segments overlap, as on a 2D canvas
 *   sprites   pictures out of the renderer's atlas: text (made there with a
 *             2D canvas, once per text and style) and avatars
 *
 * plus the backdrop band and the side fades, in the order they were called
 * (`batches`). Instances are numbers in Float32Arrays, positions in CSS
 * pixels; colours premultiplied (cssColor.js) with the alpha folded in.
 */
import { premultiplied } from './cssColor';
import { PictureLedger, measureContext } from './canvasRecorder';

// Instance layouts (floats per instance), shared with highwayGL.js
export const BOX_FLOATS = 16;     // x, y, w, h, radius, strokeWidth, dash, clip, fill rgba, stroke rgba
export const STROKE_FLOATS = 20;  // vertex, first, last, clip, r1, r2, r3, 0, c1 rgba, c2 rgba, c3 rgba
export const SPRITE_FLOATS = 8;   // def, x, y, w, h, alpha, clip, 0
// Batch kinds
export const BACKDROP = 0, BOXES = 1, STROKES = 2, SPRITES = 3, FADE = 4;

const NONE = [0, 0, 0, 0];

/** Room for `k` more floats in `a` (grown by doubling). */
const room = (a, n, k) => {
  if (n + k <= a.length) return a;
  const grown = new Float32Array(Math.max(a.length * 2, n + k));
  grown.set(a.subarray(0, n));
  return grown;
};

/**
 * Points along the cubic of tracePath (highwayPainters.js) from (x0, y0) to
 * (x1, y1), its control points at the middle x: enough of them that the
 * segments between stay within a fraction of a pixel of the curve.
 */
export function curvePoints(x0, y0, x1, y1, out) {
  const steps = Math.min(12, Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 3)));
  const cx = (x0 + x1) / 2;
  for (let j = 1; j <= steps; j++) {
    const t = j / steps, u = 1 - t;
    // B(t) with P0 = (x0, y0), C1 = (cx, y0), C2 = (cx, y1), P3 = (x1, y1)
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(a * x0 + (b + c) * cx + d * x1, (a + b) * y0 + (c + d) * y1);
  }
}

export class GLScene {
  constructor() {
    this.boxes = new Float32Array(BOX_FLOATS * 256);
    this.strokes = new Float32Array(STROKE_FLOATS * 1024);
    this.verts = new Float32Array(2 * 2048);
    this.sprites = new Float32Array(SPRITE_FLOATS * 64);
    this.ledger = new PictureLedger();
    this.points = []; // scratch for pitchLine
  }

  /** Start a frame of `width` x `height` device pixels at `dpr`, into these buffers if given. */
  begin(width, height, dpr, buffers) {
    if (buffers) Object.assign(this, buffers);
    // (buffers sent with the last frame and not back: new ones)
    if (!this.boxes.length) this.boxes = new Float32Array(BOX_FLOATS * 256);
    if (!this.strokes.length) this.strokes = new Float32Array(STROKE_FLOATS * 1024);
    if (!this.verts.length) this.verts = new Float32Array(2 * 2048);
    if (!this.sprites.length) this.sprites = new Float32Array(SPRITE_FLOATS * 64);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.nBoxes = this.nStrokes = this.nVerts = this.nSprites = 0;
    this.batches = [];
    this.defs = [];
    this.defIndex = new Map();
    this.clip = 0;
    this.clipX = 0;
    this.grouping = null;
    this.ledger.begin();
    return this;
  }

  /** The frame for the worker, and what can be transferred with it. */
  take() {
    const { boxes, strokes, verts, sprites } = this;
    return {
      scene: {
        width: this.width, height: this.height, dpr: this.dpr, clipX: this.clipX, cssWidth: this.cssWidth,
        boxes, nBoxes: this.nBoxes, strokes, nStrokes: this.nStrokes, verts, nVerts: this.nVerts,
        sprites, nSprites: this.nSprites, defs: this.defs, batches: this.batches,
        images: this.ledger.newImages, forget: this.ledger.forgotten,
      },
      transfer: [boxes.buffer, strokes.buffer, verts.buffer, sprites.buffer],
    };
  }

  // --- batches: consecutive shapes of one kind are drawn together ---
  batch(kind, start) {
    if (this.grouping) return; // the group's own batches come at its end
    const last = this.batches[this.batches.length - 1];
    if (last && last[0] === kind && kind !== BACKDROP && kind !== FADE && last[1] + last[2] === start) last[2]++;
    else this.batches.push([kind, start, 1]);
  }

  group(fn) {
    if (this.grouping) { fn(); return; }
    const box0 = this.nBoxes / BOX_FLOATS, sprite0 = this.nSprites / SPRITE_FLOATS;
    this.grouping = true;
    try { fn(); } finally { this.grouping = null; }
    const boxes = this.nBoxes / BOX_FLOATS - box0, sprites = this.nSprites / SPRITE_FLOATS - sprite0;
    const add = (kind, start, count) => {
      if (!count) return;
      const last = this.batches[this.batches.length - 1];
      if (last && last[0] === kind && last[1] + last[2] === start) last[2] += count;
      else this.batches.push([kind, start, count]);
    };
    add(BOXES, box0, boxes);
    add(SPRITES, sprite0, sprites);
  }

  // --- boxes ---
  addBox(x, y, w, h, r, strokeWidth, dash, fill, fillAlpha, stroke, strokeAlpha) {
    const o = (this.boxes = room(this.boxes, this.nBoxes, BOX_FLOATS));
    let i = this.nBoxes;
    this.batch(BOXES, i / BOX_FLOATS);
    o[i++] = x; o[i++] = y; o[i++] = w; o[i++] = h;
    o[i++] = Math.max(0, Math.min(r, w / 2, h / 2)); o[i++] = strokeWidth; o[i++] = dash ? 1 : 0; o[i++] = this.clip;
    for (let k = 0; k < 4; k++) o[i++] = fill[k] * fillAlpha;
    for (let k = 0; k < 4; k++) o[i++] = stroke[k] * strokeAlpha;
    this.nBoxes = i;
  }

  line(x0, y, x1, width, color) {
    this.addBox(x0, y - width / 2, x1 - x0, width, 0, 0, false, premultiplied(color), 1, NONE, 0);
  }

  noteRect(x, y, w, h, r, fill, stroke, alpha, isRap) {
    const a = isRap ? alpha * 0.7 : alpha;
    this.addBox(x, y, w, h, r, 1, isRap, isRap ? NONE : premultiplied(fill), a, premultiplied(isRap ? fill : stroke), a);
  }

  specialOutline(x, y, w, h, r, alpha, withHalo) {
    if (withHalo) this.addBox(x, y, w, h, r, 5, false, NONE, 0, premultiplied("rgba(255,215,0,0.35)"), alpha);
    this.addBox(x, y, w, h, r, 1.5, false, NONE, 0, premultiplied("#FFD700"), alpha);
  }

  fillRoundRect(x, y, w, h, r, color) {
    this.addBox(x, y, w, h, r, 0, false, premultiplied(color), 1, NONE, 0);
  }

  fillRect(x, y, w, h, color) {
    this.addBox(x, y, w, h, 0, 0, false, premultiplied(color), 1, NONE, 0);
  }

  box(x, y, w, h, r, fill, stroke, alpha) {
    this.addBox(x, y, w, h, r, 1, false, premultiplied(fill), alpha, premultiplied(stroke), alpha);
  }

  // --- strokes ---
  addVertex(x, y) {
    const v = (this.verts = room(this.verts, this.nVerts, 2));
    v[this.nVerts++] = x;
    v[this.nVerts++] = y;
    return this.nVerts / 2 - 1;
  }

  addStroke(vertex, first, last, r1, c1, r2, c2, r3, c3) {
    const o = (this.strokes = room(this.strokes, this.nStrokes, STROKE_FLOATS));
    let i = this.nStrokes;
    this.batch(STROKES, i / STROKE_FLOATS);
    o[i++] = vertex; o[i++] = first; o[i++] = last; o[i++] = this.clip;
    o[i++] = r1; o[i++] = r2; o[i++] = r3; o[i++] = 0;
    for (let k = 0; k < 4; k++) o[i++] = c1[k];
    for (let k = 0; k < 4; k++) o[i++] = c2[k];
    for (let k = 0; k < 4; k++) o[i++] = c3[k];
    this.nStrokes = i;
  }

  dot(x, y, haloR, haloColor, r, color) {
    const v = this.addVertex(x, y);
    this.addStroke(v, v, v, haloR, premultiplied(haloColor), r, premultiplied(color), 0, NONE);
  }

  circle(x, y, r, color) {
    const v = this.addVertex(x, y);
    this.addStroke(v, v, v, r, premultiplied(color), 0, NONE, 0, NONE);
  }

  pitchLine(points, dx, widths, colors) {
    const pts = this.points;
    pts.length = 0;
    pts.push(points[0].x + dx, points[0].y);
    for (let i = 1; i < points.length; i++) {
      curvePoints(points[i - 1].x + dx, points[i - 1].y, points[i].x + dx, points[i].y, pts);
    }
    const first = this.nVerts / 2;
    for (let i = 0; i < pts.length; i += 2) this.addVertex(pts[i], pts[i + 1]);
    const last = this.nVerts / 2 - 1;
    const c1 = premultiplied(colors[0]), c2 = premultiplied(colors[1]), c3 = premultiplied(colors[2]);
    for (let v = first; v < last; v++) this.addStroke(v, first, last, widths[0] / 2, c1, widths[1] / 2, c2, widths[2] / 2, c3);
  }

  // --- sprites ---
  def(key, make) {
    let i = this.defIndex.get(key);
    if (i === undefined) {
      i = this.defs.length;
      this.defs.push(make());
      this.defIndex.set(key, i);
    }
    return i;
  }

  addSprite(def, x, y, w, h, alpha) {
    const o = (this.sprites = room(this.sprites, this.nSprites, SPRITE_FLOATS));
    let i = this.nSprites;
    this.batch(SPRITES, i / SPRITE_FLOATS);
    o[i++] = def; o[i++] = x; o[i++] = y; o[i++] = w; o[i++] = h; o[i++] = alpha; o[i++] = this.clip; o[i++] = 0;
    this.nSprites = i;
  }

  text(text, x, y, { font, align, baseline, fill, stroke = null, lineWidth = 0, alpha = 1 }) {
    const key = `t\u0001${font}\u0001${align}\u0001${baseline}\u0001${fill}\u0001${stroke}\u0001${lineWidth}\u0001${text}`;
    const def = this.def(key, () => ({ key, text: String(text), font, align, baseline, fill, stroke, lineWidth }));
    this.addSprite(def, x, y, 0, 0, alpha);
  }

  star(x, y, color) {
    this.text("★", x, y, { font: "6px sans-serif", align: "center", baseline: "middle", fill: color });
  }

  measure(text, font) {
    const m = measureContext();
    m.font = font;
    return m.measureText(text).width;
  }

  image(picture, x, y, w, h, alpha = 1) {
    const id = this.ledger.id(picture);
    const key = `i\u0001${id}`;
    this.addSprite(this.def(key, () => ({ key, image: id })), x, y, w, h, alpha);
  }

  // --- the rest ---
  beginFrame() {}

  lineLayer(key, paint) { paint(this); } // a handful of instances: drawn every frame

  backdrop() { this.batch(BACKDROP, 0); }

  fade(width) {
    this.cssWidth = width;
    this.batch(FADE, 0);
  }

  // Everything until endClip is cut off at clipX, softly like a 2D clip
  beginClip(clipX) {
    this.clipX = clipX;
    this.clip = 1;
  }

  clipFor() {}

  endClip() { this.clip = 0; }
}
