/**
 * The profile picture editor's arithmetic and its output. The picture covers
 * a square view (the circle shows what stays); `zoom` 1 is the shortest side
 * filling the view, `dx`/`dy` move it from the centre in view pixels. What
 * the view shows is cut out, shrunk to AVATAR_PX and encoded as WebP, or as
 * JPEG where the browser cannot write WebP (Safari hands back a PNG when asked
 * for a type it lacks, so the blob's type is what tells).
 */

export const AVATAR_PX = 256;
export const MAX_ZOOM = 4;

/** Scale from picture pixels to view pixels. */
export const viewScale = ({ width, height, view, zoom }) => (view / Math.min(width, height)) * zoom;

/** The offset moved back so the picture still covers the whole view. */
export function clampOffset({ width, height, view, zoom, dx, dy }) {
  const s = viewScale({ width, height, view, zoom });
  const maxX = Math.max(0, (width * s - view) / 2);
  const maxY = Math.max(0, (height * s - view) / 2);
  // (|| 0: no -0 when the picture fits exactly)
  return { dx: Math.min(maxX, Math.max(-maxX, dx)) || 0, dy: Math.min(maxY, Math.max(-maxY, dy)) || 0 };
}

/** Where the picture sits in the view: { left, top, scale } (CSS pixels). */
export function placement({ width, height, view, zoom, dx, dy }) {
  const scale = viewScale({ width, height, view, zoom });
  return { left: (view - width * scale) / 2 + dx, top: (view - height * scale) / 2 + dy, scale };
}

/** The square of the picture the view shows, in picture pixels: { sx, sy, size }. */
export function cropRect(p) {
  const { left, top, scale } = placement(p);
  const size = p.view / scale;
  const sx = Math.min(Math.max(0, -left / scale), p.width - size);
  const sy = Math.min(Math.max(0, -top / scale), p.height - size);
  return { sx, sy, size };
}

/** A new zoom with the view's centre staying on the same spot of the picture. */
export function rezoom(p, zoom) {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const ratio = z / p.zoom;
  return { zoom: z, ...clampOffset({ ...p, zoom: z, dx: p.dx * ratio, dy: p.dy * ratio }) };
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

const makeCanvas = (px) => {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  return c;
};

/**
 * Cut `rect` out of `image` (an <img> or bitmap) and encode it at AVATAR_PX.
 * A large photo is halved step by step first: one 4000 → 256 px draw
 * shimmers. Transparent parts get the panel's violet, not black.
 */
export async function encodeAvatar(image, rect, px = AVATAR_PX) {
  let source = image;
  let { sx, sy, size } = rect;
  while (size / 2 >= px * 1.5) {
    const half = Math.round(size / 2);
    const step = makeCanvas(half);
    const ctx = step.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, size, size, 0, 0, half, half);
    source = step; sx = 0; sy = 0; size = half;
  }
  const canvas = makeCanvas(px);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#251e48';
  ctx.fillRect(0, 0, px, px);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, size, size, 0, 0, px, px);
  const webp = await toBlob(canvas, 'image/webp', 0.85);
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88);
  if (!jpeg) throw new Error('This browser cannot encode the picture');
  return jpeg;
}
