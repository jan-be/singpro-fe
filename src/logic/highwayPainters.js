/**
 * What the note highway (MusicBars) draws with: the primitives of a frame,
 * on a 2D canvas context here (Canvas2DPainter: the page's own canvas, or a
 * CanvasRecorder that a worker replays), or as a WebGL scene (GLScene,
 * glScene.js). MusicBars decides what goes where and in which colour; a
 * painter only knows how to put it there. Both take the same calls:
 *
 *   lineLayer(key, paint)     the line's static picture (backdrop, grid, dim
 *                             notes), drawn by paint(painter) while `key` stays
 *   backdrop()                the translucent band behind the notes (highwayPaint.js)
 *   line(x0, y, x1, width, color)              a horizontal hairline
 *   noteRect(x, y, w, h, r, fill, stroke, alpha, isRap)
 *   specialOutline(x, y, w, h, r, alpha, withHalo)
 *   star(x, y, color)
 *   group(fn)                 fn's boxes and pictures may be drawn as two
 *                             batches (none of them overlap each other)
 *   beginClip(clipX, clearX) / clipFor(right) / endClip()
 *                             what follows is cut off at clipX (the cursor);
 *                             clipFor says how far the next shape reaches
 *   dot(x, y, haloR, haloColor, r, color)      a sung note on its own
 *   pitchLine(points, dx, widths, colors)      a sung line: three round strokes
 *   arc(x, y, r, from, to, widths, colors)     an arc of a circle (angles in radians,
 *                             clockwise from 3 o'clock) as up to three round
 *                             strokes like pitchLine: the countdown ring
 *   fillRoundRect(x, y, w, h, r, color) / fillRect(x, y, w, h, color)
 *   circle(x, y, r, color)
 *   fade(width)               the side fades (erases what is drawn so far)
 *   box(x, y, w, h, r, fill, stroke, alpha)    a filled, outlined rounded box
 *   text(text, x, y, style)   style: { font, align, baseline, fill, stroke, lineWidth, alpha }
 *   measure(text, font)       the text's width in CSS pixels
 *   image(picture, x, y, w, h, alpha)
 */
import { CanvasRecorder } from "./canvasRecorder";
import { HEIGHT, paintBackdrop, fadeEdges, copyIn } from "./highwayPaint";

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Smooth path through segment points (same cubic as the old SVG version). */
export function tracePath(ctx, points, dx) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const x = pt.x + dx;
    if (i === 0) {
      ctx.moveTo(x, pt.y);
    } else {
      const prev = points[i - 1];
      const prevX = prev.x + dx;
      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, pt.y, x, pt.y);
    }
  }
}

/**
 * The 2D painter. `caches`: refs that outlive frames — lineLayer (the line's
 * picture), backdrop (the band, per canvas size), fade (the side gradients).
 */
export class Canvas2DPainter {
  constructor(ctx, caches, dpr) {
    this.ctx = ctx;
    this.caches = caches;
    this.dpr = dpr;
    this.recording = ctx instanceof CanvasRecorder;
    this.clipped = false;
    this.clearX = 0;
    this.clipX = 0;
  }

  /** Start a frame: CSS pixels from here on. */
  beginFrame() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * What of a frame only changes with the line: drawn once per line (and
   * canvas size) into a canvas of the same size and copied in each frame,
   * which clears at the same time; drawing the grid and the notes every frame
   * cost about as much as the rest of the expected notes. When a worker paints
   * (ctx is a recorder), the layer's drawing goes to it once and the frames
   * only say "copy it in".
   */
  lineLayer(key, paint) {
    const { ctx, dpr } = this;
    const { width, height } = ctx.canvas;
    const cacheRef = this.caches.lineLayer;
    const layer = cacheRef.current;
    if (!layer || layer.key !== key || layer.dpr !== dpr || layer.width !== width || layer.height !== height || layer.recording !== this.recording) {
      if (this.recording) {
        const rec = new CanvasRecorder(2048).begin(width, height);
        rec.setTransform(dpr, 0, 0, dpr, 0, 0);
        paint(new Canvas2DPainter(rec, this.caches, dpr));
        const { frame } = rec.take();
        ctx.attach("layer", { ops: frame.ops, n: frame.n, strings: frame.strings, width, height }, [frame.ops.buffer]);
        cacheRef.current = { key, dpr, width, height, recording: true };
      } else {
        const c = layer?.canvas ?? document.createElement("canvas");
        c.width = width; // (re)sizing clears it
        c.height = height;
        const lc = c.getContext("2d");
        lc.setTransform(dpr, 0, 0, dpr, 0, 0);
        paint(new Canvas2DPainter(lc, this.caches, dpr));
        cacheRef.current = { canvas: c, key, dpr, width, height, recording: false };
      }
    }
    if (this.recording) ctx.special("drawLayer");
    else copyIn(ctx, cacheRef.current.canvas);
  }

  backdrop() {
    if (this.recording) this.ctx.special("backdrop");
    else paintBackdrop(this.ctx, this.caches.backdrop);
  }

  line(x0, y, x1, width, color) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // A rap note is spoken, not pitched: its bar sits at the chart's nominal
  // tone and is drawn hollow with a dashed edge, so it reads as "say it"
  // rather than "hit this note".
  noteRect(x, y, w, h, r, fill, stroke, alpha, isRap) {
    const { ctx } = this;
    ctx.globalAlpha = isRap ? alpha * 0.7 : alpha;
    roundRect(ctx, x, y, w, h, r);
    if (!isRap) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = isRap ? fill : stroke;
    if (isRap) ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  specialOutline(x, y, w, h, r, alpha, withHalo) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    if (withHalo) {
      // Wide translucent stroke stands in for the blur filter the SVG had
      roundRect(ctx, x, y, w, h, r);
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,215,0,0.35)";
      ctx.stroke();
    }
    roundRect(ctx, x, y, w, h, r);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#FFD700";
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  star(x, y, color) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.font = "6px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", x, y);
  }

  group(fn) { fn(); }

  // Cut off at the cursor, but only what reaches it is drawn under the clip:
  // with CPU drawing, everything under the (anti-aliased) clip went through
  // its mask, about a tenth of the canvas's paint. What ends left of clearX
  // (a device pixel short of the cursor) is drawn without it.
  beginClip(clipX, clearX) {
    this.clipX = clipX;
    this.clearX = clearX;
    this.clipped = false;
    this.ctx.save();
  }

  clipFor(right) {
    const need = right > this.clearX;
    if (need === this.clipped) return;
    this.clipped = need;
    const { ctx } = this;
    if (need) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.clipX, HEIGHT);
      ctx.clip();
    } else ctx.restore();
  }

  endClip() {
    if (this.clipped) this.ctx.restore();
    this.clipped = false;
    this.ctx.restore();
  }

  dot(x, y, haloR, haloColor, r, color) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fillStyle = haloColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Three strokes (wide halo, main line, bright core) give the glow
  pitchLine(points, dx, widths, colors) {
    const { ctx } = this;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    tracePath(ctx, points, dx);
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = widths[i];
      ctx.strokeStyle = colors[i];
      ctx.stroke();
    }
  }

  arc(x, y, r, from, to, widths, colors) {
    const { ctx } = this;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y, r, from, to);
    for (let i = 0; i < widths.length; i++) {
      if (!(widths[i] > 0)) continue;
      ctx.lineWidth = widths[i];
      ctx.strokeStyle = colors[i];
      ctx.stroke();
    }
  }

  fillRoundRect(x, y, w, h, r, color) {
    const { ctx } = this;
    ctx.fillStyle = color;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  fillRect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  circle(x, y, r, color) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  fade(width) {
    if (this.recording) this.ctx.special("fade", width);
    else fadeEdges(this.ctx, width, this.caches.fade);
  }

  box(x, y, w, h, r, fill, stroke, alpha) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  text(text, x, y, { font, align, baseline, fill, stroke, lineWidth, alpha = 1 }) {
    const { ctx } = this;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    if (stroke) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  measure(text, font) {
    this.ctx.font = font;
    return this.ctx.measureText(text).width;
  }

  image(picture, x, y, w, h, alpha = 1) {
    const { ctx } = this;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(picture, x, y, w, h);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }
}
