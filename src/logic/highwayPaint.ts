/**
 * The parts of a note highway frame that are painted from a cache: the
 * backdrop band and the side fades. Shared by MusicBars (painting on the main
 * thread) and HighwayWorker (replaying its frames in a worker), so both draw
 * them the same way.
 */

/** The canvas's height in CSS pixels. */
export const HEIGHT = 200;
/** Share of the width that fades out at each side. */
export const EDGE_FADE = 0.05;
/** The band behind the notes, so they read on bright footage. */
const BACKDROP = "rgba(0,0,0,0.45)";

/** A canvas to cache a picture in: a detached element, or in a worker an OffscreenCanvas. */
export const createCanvas = (width, height) => {
  if (typeof document === "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
};

/** Copy a picture of the canvas's size over everything (which also clears it). */
export function copyIn(ctx, picture) {
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
export function paintBackdrop(ctx, cache) {
  const { width, height } = ctx.canvas;
  let band = cache.current;
  if (!band || band.width !== width || band.height !== height) {
    band = cache.current = createCanvas(width, height);
    const c = band.getContext("2d");
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
export function fadeEdges(ctx, width, cache) {
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
