/**
 * Canvas pixels per CSS pixel for a canvas that reaches the screen as a
 * compositor layer of its own (the note highway: a WebGL canvas, painted in a
 * worker or on the main thread).
 *
 * The device pixel ratio, unless that canvas would then be larger than the GPU
 * can show as one texture: such a canvas goes to the screen as a single
 * texture, and one past the limit is not shown at all. A Fire TV Stick 4K Max
 * (PowerVR, limit 4096) reports a ratio of 4, so its highway, 1248 CSS px
 * wide, asked for 4992 px and stayed black. The same stick shows the page at
 * 1.5 px per CSS px, so most of that resolution was never visible either;
 * under load the frame governor caps it further (`cap`, frameGovernor.js),
 * never below 1.
 */

const FALLBACK_MAX = 4096; // what nearly every GPU of the last decade takes; used when WebGL cannot tell
let cachedMax = null;

/** The largest texture side the GPU takes, asked once of WebGL (4096 when it cannot say). */
export function maxLayerSize() {
  if (cachedMax !== null) return cachedMax;
  cachedMax = FALLBACK_MAX;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const max = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
    if (Number.isFinite(max) && max >= 1024) cachedMax = max;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL: the fallback */ }
  return cachedMax;
}

/**
 * Pixels per CSS pixel for a `cssWidth` x `cssHeight` canvas: the device pixel
 * ratio, held to `cap` (but not below 1), and small enough that neither side
 * passes `maxSize` once rounded to whole pixels.
 */
export function layerScale({ dpr, cssWidth, cssHeight, maxSize, cap = Infinity }) {
  let scale = Math.min(dpr || 1, Math.max(1, cap));
  const largest = Math.max(cssWidth, cssHeight);
  if (largest > 0 && Math.round(largest * scale) > maxSize) scale = maxSize / largest;
  return scale;
}
