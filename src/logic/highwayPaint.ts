/**
 * The parts of a note highway frame that are painted from a cache: the
 * backdrop band and the side fades. Shared by MusicBars (painting on the main
 * thread) and HighwayWorker (replaying its frames in a worker), so both draw
 * them the same way.
 */

// This file is checked for the highway's worker as well, whose global scope
// has no DOM. Where there is a page these are its types; in the worker's
// check the page's context is no type at all, and its document (looked for
// before it is used, and never there) stands in as one that makes
// OffscreenCanvases.
type PageContext2D = typeof globalThis extends { CanvasRenderingContext2D: { prototype: infer C } } ? C : never;
/** The page's document where there is one (see above). */
export type PageDocument = typeof globalThis extends { document: infer D } ? D : { createElement(tagName: "canvas"): OffscreenCanvas };
declare const document: PageDocument | undefined;

/** A 2D context: a page canvas's, or an OffscreenCanvas's (in a worker). */
export type Context2D = OffscreenCanvasRenderingContext2D | PageContext2D;
/** A canvas a picture is cached in (createCanvas). */
export type PictureCanvas = ReturnType<typeof createCanvas>;
/** A picture the highway draws (an avatar sprite), or what the painting side has of it. */
export type Picture = PictureCanvas | ImageBitmap;
/** A cache that outlives frames: a React ref, or a plain object like one. */
export interface CacheRef<T> {
  current: T | null;
}
/** fadeEdges' cache: the side gradients for one width. */
export interface FadeCache {
  width: number;
  strips: { g: CanvasGradient; x: number }[];
}

/** A note bar's kind (noteRect): a rap note, a freestyle note, or none of them. */
export type NoteKind = "rap" | "free";
/** A point of a sung line, in CSS pixels. */
export interface PathPoint {
  x: number;
  y: number;
}
/** How a painter's text() draws. */
export interface TextStyle {
  font: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  fill: string;
  stroke?: string | null;
  lineWidth?: number;
  alpha?: number;
}

/**
 * What the note highway draws with (highwayPainters.ts has the list): the 2D
 * painter (Canvas2DPainter) and the WebGL scene (GLScene) take the same calls.
 */
export interface HighwayPainter {
  beginFrame(): void;
  /** `key`: anything that stays the same while the line's picture does (compared by identity) */
  lineLayer(key: unknown, paint: (painter: HighwayPainter) => void): void;
  backdrop(): void;
  line(x0: number, y: number, x1: number, width: number, color: string): void;
  noteRect(x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string, alpha: number, kind?: NoteKind | null | false): void;
  specialOutline(x: number, y: number, w: number, h: number, r: number, alpha: number, withHalo: boolean): void;
  star(x: number, y: number, color: string): void;
  group(fn: () => void): void;
  beginClip(clipX: number, clearX: number): void;
  clipFor(right: number): void;
  endClip(): void;
  dot(x: number, y: number, haloR: number, haloColor: string, r: number, color: string): void;
  pitchLine(points: readonly PathPoint[], dx: number, widths: readonly number[], colors: readonly string[]): void;
  arc(x: number, y: number, r: number, from: number, to: number, widths: readonly number[], colors: readonly string[]): void;
  fillRoundRect(x: number, y: number, w: number, h: number, r: number, color: string): void;
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  circle(x: number, y: number, r: number, color: string): void;
  fade(width: number): void;
  box(x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string, alpha: number): void;
  text(text: string, x: number, y: number, style: TextStyle): void;
  measure(text: string, font: string): number;
  image(picture: Picture, x: number, y: number, w: number, h: number, alpha?: number): void;
}

/** The canvas's height in CSS pixels. */
export const HEIGHT = 200;
/** Share of the width that fades out at each side. */
export const EDGE_FADE = 0.05;
/** The band behind the notes, so they read on bright footage. */
const BACKDROP = "rgba(0,0,0,0.45)";

/** A canvas to cache a picture in: a detached element, or in a worker an OffscreenCanvas. */
export const createCanvas = (width: number, height: number) => {
  if (typeof document === "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
};

/**
 * A canvas's 2D context. getContext answers null only for a canvas that has
 * a context of another kind already, which these never have.
 */
export function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D;
export function context2d(canvas: PictureCanvas): Context2D;
export function context2d(canvas: PictureCanvas): Context2D {
  const c = canvas.getContext("2d");
  if (!c) throw new Error("highway: the canvas gives no 2D context");
  return c;
}

/** Copy a picture of the canvas's size over everything (which also clears it). */
export function copyIn(ctx: Context2D, picture: Picture) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(picture, 0, 0);
  ctx.restore();
}

/**
 * Clear the canvas to the backdrop: a translucent black band that fades out
 * towards the top and bottom (fadeEdges fades its sides), so the notes read on
 * bright footage. The band is rendered once per canvas size into cache.current
 * and copied into the line layer (MusicBars' paintLineLayer), which clears it. It
 * used to be an element under the canvas with a two-gradient CSS mask,
 * re-rendered on every frame along with the canvas; filling the gradient every
 * frame instead cost about as much on CPU-drawing browsers, the copy next to
 * nothing.
 */
export function paintBackdrop(ctx: Context2D, cache: CacheRef<PictureCanvas>) {
  const { width, height } = ctx.canvas;
  let band = cache.current;
  if (!band || band.width !== width || band.height !== height) {
    band = cache.current = createCanvas(width, height);
    const c = context2d(band);
    const g = c.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.18, BACKDROP);
    g.addColorStop(0.82, BACKDROP);
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, width, height);
  }
  copyIn(ctx, band);
}

/**
 * Fade the left and right edges out by erasing two gradient strips. This used
 * to be a CSS mask on the canvas's wrapper, and a CSS mask on content that
 * changes every frame makes the browser re-render the whole canvas through
 * the mask on every frame: measured with CPU drawing (how iPad Safari paints)
 * it was the largest part of each frame. Two small fills cost next to nothing.
 * The gradients only change with the width, so they are made once per width.
 */
export function fadeEdges(ctx: Context2D, width: number, cache: CacheRef<FadeCache>) {
  const w = width * EDGE_FADE;
  let fade = cache.current;
  if (!fade || fade.width !== width) {
    fade = cache.current = {
      width,
      strips: [[0, w], [width, width - w]].map(([from, to]) => {
        const g = ctx.createLinearGradient(from, 0, to, 0);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        return { g, x: Math.min(from, to) };
      }),
    };
  }
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  for (const { g, x } of fade.strips) {
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, HEIGHT);
  }
  ctx.restore();
}
