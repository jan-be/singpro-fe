import { defaultHue, hueToCss } from './playerColor';
import { avatarInitial, graphemes } from './avatar';

/**
 * Avatars for the highway (MusicBars): one small canvas per player and size,
 * the picture in a circle inside a ring of the player's colour, or without a
 * picture the first letter of the name on that colour (the Avatar component's
 * look). Drawn once and kept; the frame loop only copies it with drawImage,
 * which costs the same on a software canvas as on the GPU.
 *
 *   const sprite = getAvatarSprite({ username, src: avatarSrc(path), hue, px });
 *   ctx.drawImage(sprite, x, y, cssSize, cssSize);
 *
 * `px` is the sprite's side in device pixels (CSS size × devicePixelRatio,
 * rounded), so it stays sharp. While a picture loads, or when it cannot be
 * loaded, the letter is returned; `onAvatarReady` tells when a picture
 * arrived, for a painter that only redraws on change. `letters` replaces the
 * letter for a player who would look like another one on screen (tieLetters
 * in avatar.js): a sprite of its own, so none ever changes once drawn.
 */

const RING = 0.09; // the ring's width, as a share of the side

const domCanvas = (px) => {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  return c;
};

/** Load a picture: resolves to something drawImage takes, rejects when it cannot be loaded. */
const domImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`avatar ${src} did not load`));
  img.src = src;
});

/** Draw one sprite: ring, then the picture clipped to the circle inside it, or the letter. */
export function drawAvatar(ctx, { px, hue, picture, letter }) {
  const c = px / 2;
  const ring = Math.max(1, Math.round(px * RING));
  const inner = c - ring;
  const colour = hueToCss(hue);
  ctx.clearRect(0, 0, px, px);
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  if (picture) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, inner, 0, Math.PI * 2);
    ctx.clip();
    // Our pictures are square; anything else is cut to its middle square
    const w = picture.naturalWidth || picture.width;
    const h = picture.naturalHeight || picture.height;
    const side = Math.min(w, h);
    ctx.drawImage(picture, (w - side) / 2, (h - side) / 2, side, side, c - inner, c - inner, inner * 2, inner * 2);
    ctx.restore();
    return;
  }
  // The letter on the colour, white like the Avatar component's, a quiet line
  // inside the ring so the disc reads as a badge on a bar of the same colour
  ctx.beginPath();
  ctx.arc(c, c, inner, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = Math.max(1, ring / 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  // two letters (tieLetters: two players who would look the same) a size smaller
  ctx.font = `bold ${Math.round(inner * (graphemes(letter).length > 1 ? 0.95 : 1.2))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(letter);
  // Centred on the glyph's own box (emoji and CJK sit differently on the baseline than Latin capitals)
  const ascent = m.actualBoundingBoxAscent ?? inner * 0.7;
  const descent = m.actualBoundingBoxDescent ?? 0;
  ctx.fillText(letter, c, c + (ascent - descent) / 2);
}

/**
 * A sprite cache. The app shares one (avatarSprites below); tests make their
 * own with stand-ins for the canvas and the image loader.
 */
export function createAvatarSprites({ createCanvas = domCanvas, loadImage = domImage, maxSprites = 200 } = {}) {
  const sprites = new Map(); // key -> canvas, oldest first
  const pictures = new Map(); // src -> { state: 'loading' | 'ready' | 'failed', image }
  const listeners = new Set();

  function picture(src) {
    if (!src) return null;
    let entry = pictures.get(src);
    if (!entry) {
      entry = { state: 'loading', image: null };
      pictures.set(src, entry);
      loadImage(src).then(
        (image) => { entry.state = 'ready'; entry.image = image; for (const l of listeners) l(src); },
        () => { entry.state = 'failed'; },
      );
    }
    return entry.state === 'ready' ? entry.image : null;
  }

  return {
    /** The sprite for a player at `px` device pixels (see the module comment). */
    get({ username, src = null, hue = defaultHue(username), px, letters = null }) {
      const side = Math.max(8, Math.round(px));
      const image = picture(src);
      const key = `${image ? src : `letter:${username}|${letters ?? ''}`}|${hue}|${side}`;
      let sprite = sprites.get(key);
      if (sprite) {
        // Most recently used goes last; the first is the one to drop
        sprites.delete(key);
        sprites.set(key, sprite);
        return sprite;
      }
      sprite = createCanvas(side);
      drawAvatar(sprite.getContext('2d'), { px: side, hue, picture: image, letter: letters ?? avatarInitial(username) });
      sprites.set(key, sprite);
      if (sprites.size > maxSprites) sprites.delete(sprites.keys().next().value);
      return sprite;
    },
    /** Start loading pictures before they are drawn (a player joined), so the first frame has them. */
    preload(src) { picture(src); },
    /** Call `fn(src)` whenever a picture finished loading; returns the unsubscribe. */
    onReady(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get size() { return sprites.size; },
    clear() { sprites.clear(); },
  };
}

/** The app's cache, for MusicBars and anything else that paints players on a canvas. */
export const avatarSprites = createAvatarSprites();
export const getAvatarSprite = (opts) => avatarSprites.get(opts);
export const onAvatarReady = (fn) => avatarSprites.onReady(fn);
