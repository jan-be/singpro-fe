/**
 * A stand-in for a 2D canvas context that records the calls a frame makes, so
 * another thread can replay them onto the real canvas (see highwayRenderer.js:
 * the note highway paints in a worker through an OffscreenCanvas).
 *
 * The calls go into one Float64Array — numbers exactly as given, so the replay
 * draws the same pixels as calling the context directly — and strings into a
 * per-frame table. It covers what MusicBars draws with; whatever needs a
 * gradient or a cached canvas (the backdrop band, the side fades, the line
 * layer) is a "special" op that the replaying side carries out with its own
 * caches.
 *
 * Pictures (drawImage: a player's avatar sprite, say) go over once, with the
 * first frame that draws them, and are drawn by id after that. A canvas is
 * copied into an ImageBitmap for it at that first draw (exactly, pixel for
 * pixel), so a picture must not change once drawn: draw a new canvas instead,
 * as avatarSprite.js does. One not drawn for PICTURE_FRAMES frames is let go
 * on both sides (and sent again should it come back).
 */

// Op codes. Arguments follow inline; a string is its index in the frame's table.
const SET_TRANSFORM = 1, SAVE = 2, RESTORE = 3, BEGIN_PATH = 4, MOVE_TO = 5, LINE_TO = 6, ARC_TO = 7,
  CLOSE_PATH = 8, RECT = 9, CLIP = 10, ARC = 11, BEZIER_CURVE_TO = 12, FILL = 13, STROKE = 14, FILL_RECT = 15,
  CLEAR_RECT = 16, FILL_TEXT = 17, STROKE_TEXT = 18, SET_LINE_DASH = 19, GLOBAL_ALPHA = 20, LINE_WIDTH = 21,
  STROKE_STYLE = 22, FILL_STYLE = 23, FONT = 24, TEXT_ALIGN = 25, TEXT_BASELINE = 26, LINE_CAP = 27,
  LINE_JOIN = 28, COMPOSITE = 29, SPECIAL = 30, DRAW_IMAGE = 31, DRAW_IMAGE_SCALED = 32;

/** Frames a picture stays sent without being drawn. */
export const PICTURE_FRAMES = 600;

/** What the replaying side can take: an ImageBitmap as it is, a canvas or image copied into one. */
const toBitmap = (image) => {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) return image;
  if (typeof OffscreenCanvas === 'undefined' || !(image?.width > 0 && image?.height > 0)) return image;
  const copy = new OffscreenCanvas(image.width, image.height);
  copy.getContext('2d').drawImage(image, 0, 0);
  return copy.transferToImageBitmap();
};

/**
 * The pictures a painter has sent to the thread that paints (see the top of
 * this file): each goes over once, with the first frame that draws it, as an
 * ImageBitmap, and is drawn by id after that; one not drawn for
 * PICTURE_FRAMES frames is let go on both sides. Shared by CanvasRecorder and
 * the WebGL scene (glScene.js).
 */
export class PictureLedger {
  constructor() {
    this.pictures = new Map(); // picture -> { id, used: frame number }
    this.nextImageId = 1;
    this.frameNo = 0;
    this.newImages = []; // [{ id, image }] first drawn in this frame
    this.forgotten = []; // ids the painting side drops
  }

  /** Start a frame: what was sent with the last one is gone, long-unused pictures are let go. */
  begin() {
    this.newImages = [];
    this.forgotten = [];
    if (++this.frameNo % 60 === 0) {
      for (const [image, p] of this.pictures) {
        if (this.frameNo - p.used > PICTURE_FRAMES) this.forget(image);
      }
    }
  }

  /** The id the image is drawn by in this frame (sent along with it the first time). */
  id(image) {
    let p = this.pictures.get(image);
    if (!p) {
      p = { id: this.nextImageId++, used: 0 };
      this.pictures.set(image, p);
      this.newImages.push({ id: p.id, image: toBitmap(image) });
    }
    p.used = this.frameNo;
    return p.id;
  }

  /** A picture that will not be drawn again: the painting side can let it go. */
  forget(image) {
    const p = this.pictures.get(image);
    if (!p) return;
    this.pictures.delete(image);
    this.forgotten.push(p.id);
  }
}

let measurer = null; // a real context for measureText, made on first use
export const measureContext = () => {
  if (!measurer) {
    measurer = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1).getContext('2d')
      : document.createElement('canvas').getContext('2d');
  }
  return measurer;
};

export class CanvasRecorder {
  constructor(capacity = 4096) {
    this.ops = new Float64Array(capacity);
    this.n = 0;
    this.strings = [];
    this.stringIndex = new Map();
    this.canvas = { width: 0, height: 0 };
    this.currentFont = '10px sans-serif';
    this.ledger = new PictureLedger();
    this.attached = {}; // anything else that goes with this frame (MusicBars: the line layer)
    this.transfer = [];
  }

  /** Start a frame for a canvas of `width` x `height` device pixels, recording into `ops` if given. */
  begin(width, height, ops) {
    if (ops) this.ops = ops;
    this.n = 0;
    this.strings = [];
    this.stringIndex.clear();
    this.canvas.width = width;
    this.canvas.height = height;
    this.ledger.begin();
    this.attached = {};
    this.transfer = [];
    return this;
  }

  /**
   * The frame so far: { ops (the whole buffer; the first `n` are used), n,
   * strings, images (new pictures), forget (ids), attached }, and what can be
   * transferred with it.
   */
  take() {
    return {
      frame: { ops: this.ops, n: this.n, strings: this.strings, images: this.ledger.newImages, forget: this.ledger.forgotten, attached: this.attached },
      transfer: [this.ops.buffer, ...this.transfer],
    };
  }

  /** Send `value` along with this frame as `attached[name]`; `transfer`: its transferable buffers. */
  attach(name, value, transfer = []) {
    this.attached[name] = value;
    this.transfer.push(...transfer);
  }

  /** A picture that will not be drawn again: the replaying side can let it go. */
  forgetImage(image) {
    this.ledger.forget(image);
  }

  // Room for k more numbers. Every op writes through this and the p* helpers
  // below rather than a rest-argument push: a frame records thousands of them.
  room(k) {
    if (this.n + k > this.ops.length) {
      const grown = new Float64Array(Math.max(this.ops.length * 2, this.n + k));
      grown.set(this.ops.subarray(0, this.n));
      this.ops = grown;
    }
    return this.ops;
  }
  p1(a) { const o = this.room(1); o[this.n++] = a; }
  p2(a, b) { const o = this.room(2); o[this.n++] = a; o[this.n++] = b; }
  p3(a, b, c) { const o = this.room(3); o[this.n++] = a; o[this.n++] = b; o[this.n++] = c; }
  p4(a, b, c, d) { const o = this.room(4); o[this.n++] = a; o[this.n++] = b; o[this.n++] = c; o[this.n++] = d; }
  p5(a, b, c, d, e) { const o = this.room(5); o[this.n++] = a; o[this.n++] = b; o[this.n++] = c; o[this.n++] = d; o[this.n++] = e; }
  p6(a, b, c, d, e, f) { const o = this.room(6); o[this.n++] = a; o[this.n++] = b; o[this.n++] = c; o[this.n++] = d; o[this.n++] = e; o[this.n++] = f; }
  p7(a, b, c, d, e, f, g) { const o = this.room(7); o[this.n++] = a; o[this.n++] = b; o[this.n++] = c; o[this.n++] = d; o[this.n++] = e; o[this.n++] = f; o[this.n++] = g; }

  str(s) {
    let i = this.stringIndex.get(s);
    if (i === undefined) {
      i = this.strings.length;
      this.strings.push(s);
      this.stringIndex.set(s, i);
    }
    return i;
  }

  /** An op the replaying side implements: `name` and numeric arguments. */
  special(name, ...args) {
    this.p3(SPECIAL, this.str(name), args.length);
    for (const a of args) this.p1(a);
  }

  setTransform(a, b, c, d, e, f) { this.p7(SET_TRANSFORM, a, b, c, d, e, f); }
  save() { this.p1(SAVE); }
  restore() { this.p1(RESTORE); }
  beginPath() { this.p1(BEGIN_PATH); }
  moveTo(x, y) { this.p3(MOVE_TO, x, y); }
  lineTo(x, y) { this.p3(LINE_TO, x, y); }
  arcTo(x1, y1, x2, y2, r) { this.p6(ARC_TO, x1, y1, x2, y2, r); }
  closePath() { this.p1(CLOSE_PATH); }
  rect(x, y, w, h) { this.p5(RECT, x, y, w, h); }
  clip() { this.p1(CLIP); }
  arc(x, y, r, a0, a1, ccw = false) { this.p7(ARC, x, y, r, a0, a1, ccw ? 1 : 0); }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { this.p7(BEZIER_CURVE_TO, c1x, c1y, c2x, c2y, x, y); }
  fill() { this.p1(FILL); }
  stroke() { this.p1(STROKE); }
  fillRect(x, y, w, h) { this.p5(FILL_RECT, x, y, w, h); }
  clearRect(x, y, w, h) { this.p5(CLEAR_RECT, x, y, w, h); }
  fillText(text, x, y) { this.p4(FILL_TEXT, this.str(String(text)), x, y); }
  strokeText(text, x, y) { this.p4(STROKE_TEXT, this.str(String(text)), x, y); }
  setLineDash(segments) {
    this.p2(SET_LINE_DASH, segments.length);
    for (const s of segments) this.p1(s);
  }
  drawImage(image, x, y, w, h) {
    const id = this.ledger.id(image);
    if (w === undefined) this.p4(DRAW_IMAGE, id, x, y);
    else this.p6(DRAW_IMAGE_SCALED, id, x, y, w, h);
  }
  measureText(text) {
    const m = measureContext();
    m.font = this.currentFont;
    return m.measureText(text);
  }
  set globalAlpha(v) { this.p2(GLOBAL_ALPHA, v); }
  set lineWidth(v) { this.p2(LINE_WIDTH, v); }
  set strokeStyle(v) { this.p2(STROKE_STYLE, this.str(v)); }
  set fillStyle(v) { this.p2(FILL_STYLE, this.str(v)); }
  set font(v) { this.currentFont = v; this.p2(FONT, this.str(v)); }
  set textAlign(v) { this.p2(TEXT_ALIGN, this.str(v)); }
  set textBaseline(v) { this.p2(TEXT_BASELINE, this.str(v)); }
  set lineCap(v) { this.p2(LINE_CAP, this.str(v)); }
  set lineJoin(v) { this.p2(LINE_JOIN, this.str(v)); }
  set globalCompositeOperation(v) { this.p2(COMPOSITE, this.str(v)); }
}

/**
 * Replay a recorded frame onto a real context. `specials[name](ctx, ...args)`
 * carries out the special ops; `images` maps picture ids to the pictures.
 */
export function replayCanvas(ctx, { ops, n, strings }, specials, images) {
  let i = 0;
  while (i < n) {
    switch (ops[i++]) {
      case SET_TRANSFORM: ctx.setTransform(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5]); i += 6; break;
      case SAVE: ctx.save(); break;
      case RESTORE: ctx.restore(); break;
      case BEGIN_PATH: ctx.beginPath(); break;
      case MOVE_TO: ctx.moveTo(ops[i], ops[i + 1]); i += 2; break;
      case LINE_TO: ctx.lineTo(ops[i], ops[i + 1]); i += 2; break;
      case ARC_TO: ctx.arcTo(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4]); i += 5; break;
      case CLOSE_PATH: ctx.closePath(); break;
      case RECT: ctx.rect(ops[i], ops[i + 1], ops[i + 2], ops[i + 3]); i += 4; break;
      case CLIP: ctx.clip(); break;
      case ARC:
        if (ops[i + 5] === 1) ctx.arc(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], true);
        else ctx.arc(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4]);
        i += 6;
        break;
      case BEZIER_CURVE_TO: ctx.bezierCurveTo(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5]); i += 6; break;
      case FILL: ctx.fill(); break;
      case STROKE: ctx.stroke(); break;
      case FILL_RECT: ctx.fillRect(ops[i], ops[i + 1], ops[i + 2], ops[i + 3]); i += 4; break;
      case CLEAR_RECT: ctx.clearRect(ops[i], ops[i + 1], ops[i + 2], ops[i + 3]); i += 4; break;
      case FILL_TEXT: ctx.fillText(strings[ops[i]], ops[i + 1], ops[i + 2]); i += 3; break;
      case STROKE_TEXT: ctx.strokeText(strings[ops[i]], ops[i + 1], ops[i + 2]); i += 3; break;
      case SET_LINE_DASH: {
        const k = ops[i++];
        const segments = [];
        for (let j = 0; j < k; j++) segments.push(ops[i++]);
        ctx.setLineDash(segments);
        break;
      }
      case GLOBAL_ALPHA: ctx.globalAlpha = ops[i++]; break;
      case LINE_WIDTH: ctx.lineWidth = ops[i++]; break;
      case STROKE_STYLE: ctx.strokeStyle = strings[ops[i++]]; break;
      case FILL_STYLE: ctx.fillStyle = strings[ops[i++]]; break;
      case FONT: ctx.font = strings[ops[i++]]; break;
      case TEXT_ALIGN: ctx.textAlign = strings[ops[i++]]; break;
      case TEXT_BASELINE: ctx.textBaseline = strings[ops[i++]]; break;
      case LINE_CAP: ctx.lineCap = strings[ops[i++]]; break;
      case LINE_JOIN: ctx.lineJoin = strings[ops[i++]]; break;
      case COMPOSITE: ctx.globalCompositeOperation = strings[ops[i++]]; break;
      case DRAW_IMAGE: ctx.drawImage(images.get(ops[i]), ops[i + 1], ops[i + 2]); i += 3; break;
      case DRAW_IMAGE_SCALED: ctx.drawImage(images.get(ops[i]), ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4]); i += 5; break;
      case SPECIAL: {
        const name = strings[ops[i]];
        const k = ops[i + 1];
        i += 2;
        const args = [];
        for (let j = 0; j < k; j++) args.push(ops[i++]);
        specials[name](ctx, ...args);
        break;
      }
      default: throw new Error(`canvasRecorder: bad op ${ops[i - 1]} at ${i - 1}`);
    }
  }
}
