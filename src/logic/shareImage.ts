import { toCanvas } from 'html-to-image';
import wordmarkSvg from '../wordmark-app.svg?raw';
import { readTextFile, type LyricData } from './LyricsParser';
import { scriptChoice, SCRIPT_LANG, type SongNames, type SongNamesSource } from './lyricsScripts';

/** A note of the melody meter (melodyOf): start and end (x0, x1) and pitch (y, 1 the highest), all 0..1. */
export interface MelodyNote {
  x0: number;
  x1: number;
  y: number;
}

/** A part of a picture, in its pixels. */
export interface ArtCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The song's video thumbnail (loadSongArt): the image and the picture in it. */
export interface SongArt extends ArtCrop {
  img: HTMLImageElement;
  aspect: number;
  dispose: () => void;
}

/** Where an element of the card sits, in card pixels, with its border radius. */
export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

/** A box on the 1080 × 1920 picture. */
export interface PictureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The score counting up (renderCountStrip): the pictures, and one picture's box with how many there are. */
export interface CountStrip {
  blob: Blob;
  cell: PictureBox & { frames: number };
}

/** Where the result's pieces sit on the picture (shareLayout). */
export interface ShareLayout {
  score: PictureBox | null;
  wave: PictureBox | null;
  fill: number;
  marker: PictureBox | null;
  stars: (PictureBox | null)[];
  badges: PictureBox | null;
  art: PictureBox | null;
}

/**
 * The share image (ShareCard): a 9:16 poster of one singer's score, for a
 * story or a chat.
 *
 * It is drawn in two layers. The pictures (the song's video thumbnail, its
 * blurred backdrop) go straight onto a canvas here; everything else (text,
 * stars, the melody meter, the QR code) is a hidden DOM card that
 * html-to-image turns into an image on top. html-to-image draws through an
 * SVG <foreignObject>, and iOS Safari often leaves an <img> inside one blank
 * the first time it is drawn; with no pictures in the card there is nothing
 * for it to drop, and nothing to fetch either.
 */

export const CARD_WIDTH = 720;
export const CARD_HEIGHT = 1280;
// Drawn at 1.5×: 1080×1920, the size a story is shown at, so the text stays sharp
export const CARD_SCALE = 1.5;

/** Singers ordered by this song's score, each with a `rank` that ties share. */
export function rankByScore<T extends { score: number }>(scores: readonly T[] | undefined): (T & { rank: number })[] {
  const sorted = [...(scores ?? [])].sort((a, b) => b.score - a.score);
  let rank = 0;
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { ...p, rank };
  });
}

/**
 * The card's leaderboard: everyone while they fit in `max` rows; past that
 * the top ones and always the sharer, one row kept for "+N more".
 */
export function leaderboardRows<T extends { username: string }>(ranked: T[], me: string, max = 5): { rows: T[]; more: number } {
  if (ranked.length <= max) return { rows: ranked, more: 0 };
  const mine = ranked.findIndex(p => p.username === me);
  const rows = mine < 0 || mine < max - 1
    ? ranked.slice(0, max - 1)
    : [...ranked.slice(0, max - 2), ranked[mine]];
  return { rows, more: ranked.length - rows.length };
}

/**
 * The song's names for the card. A song with a title in its own script
 * (晴天 for "Qing Tian") shows that one whatever the lyrics pill is set to,
 * with the romanised names under it as `roman`, so whoever sees the image
 * can read one of the two. `lang` marks the script's text for CJK fonts.
 */
export function cardNames(song: SongNamesSource | null, locale: string | undefined): SongNames {
  const titles = song?.titles;
  const { tag } = scriptChoice(titles, { locale, language: song?.language });
  // (a tag only comes with titles, so with a song)
  const own = tag && titles ? titles[tag] : null;
  if (!song || !tag || !own) return { title: song?.title, artist: song?.artist };
  const title = own.title || song.title;
  const artist = own.artist || song.artist;
  const roman = `${song.artist} – ${song.title}`;
  return { title, artist, lang: SCRIPT_LANG[tag], roman: roman === `${artist} – ${title}` ? undefined : roman };
}

/**
 * The melody of the part sung, for the score meter: one entry per note with
 * its start and end (x0, x1) and pitch (y, 1 the highest), all 0..1. Pitches
 * outside the middle 90 % are clamped, so one stray note does not flatten
 * the rest. Null when the chart has no notes or does not parse.
 */
export async function melodyOf(lyrics: string | null | undefined, part = 1): Promise<MelodyNote[] | null> {
  if (!lyrics) return null;
  let chart: LyricData;
  try { chart = await readTextFile(lyrics); } catch { return null; }
  const lines = part === 2 && chart.p2 ? chart.p2.lyricLines : chart.lyricLines;
  const notes = lines.flat().filter(n => !n.isBreak && n.length > 0 && Number.isFinite(n.tone));
  if (!notes.length) return null;
  let first = Infinity, last = -Infinity;
  for (const n of notes) { first = Math.min(first, n.start); last = Math.max(last, n.start + n.length); }
  const tones = notes.map(n => n.tone).sort((a, b) => a - b);
  const lo = tones[Math.floor((tones.length - 1) * 0.05)];
  const hi = tones[Math.ceil((tones.length - 1) * 0.95)];
  const span = Math.max(hi - lo, 1);
  const length = Math.max(last - first, 1);
  return notes.map(n => ({
    x0: (n.start - first) / length,
    x1: (n.start + n.length - first) / length,
    y: Math.min(1, Math.max(0, (n.tone - lo) / span)),
  }));
}

/**
 * The melody as a waveform of `bins` bars, each 0..1: higher where the tune
 * is higher, lower where the bar is only partly sung, 0 where nobody sings.
 * Drawn at the card's size, single notes would be specks; bars read as
 * "a song" at a glance, like a player's progress bar.
 */
export function waveform(melody: readonly MelodyNote[] | null, bins = 64): number[] {
  const cover = new Float64Array(bins), pitch = new Float64Array(bins);
  for (const n of melody ?? []) {
    const b0 = Math.max(0, Math.floor(n.x0 * bins));
    const b1 = Math.min(bins - 1, Math.ceil(n.x1 * bins) - 1);
    for (let b = b0; b <= b1; b++) {
      const w = Math.max(0, Math.min(n.x1, (b + 1) / bins) - Math.max(n.x0, b / bins)) * bins;
      cover[b] += w;
      pitch[b] += w * n.y;
    }
  }
  return Array.from(cover, (c, b) => (c > 0.02 ? (0.3 + 0.7 * (pitch[b] / c)) * Math.min(1, 0.45 + c) : 0));
}

// Largest first: not every video has the maxres or sd size (YouTube answers 404)
const THUMBNAILS = ['maxresdefault', 'sddefault', 'hqdefault'];

/** A canvas's 2D context: null only for a canvas with a context of another kind, which these never have. */
function context2d(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings) {
  const ctx = canvas.getContext('2d', settings);
  if (!ctx) throw new Error('The share image: a canvas gives no 2D context');
  return ctx;
}

/**
 * The song's video thumbnail, as { img, sx, sy, sw, sh, aspect, dispose }:
 * the image and the picture in it, which is the 16:9 middle (the 4:3 sizes
 * letterbox a 16:9 video in black bars) less any flat bars around it
 * (trimBars). i.ytimg.com answers with Access-Control-Allow-Origin: *, and a
 * blob fetched with CORS is ours to draw, so the canvas stays readable. Null
 * without a video or when every size fails.
 */
export async function loadSongArt(videoId: string | null | undefined): Promise<SongArt | null> {
  if (!videoId) return null;
  for (const size of THUMBNAILS) {
    try {
      const resp = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${size}.jpg`, { mode: 'cors', credentials: 'omit' });
      if (!resp.ok) continue;
      const url = URL.createObjectURL(await resp.blob());
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
      } catch {
        URL.revokeObjectURL(url);
        continue;
      }
      const w = img.naturalWidth, h = img.naturalHeight;
      // YouTube's "no thumbnail" stand-in is 120×90
      if (w < 200) { URL.revokeObjectURL(url); continue; }
      const sh = Math.min(h, (w * 9) / 16);
      const box = trimBars(img, { sx: 0, sy: (h - sh) / 2, sw: w, sh });
      return { img, ...box, aspect: box.sw / box.sh, dispose: () => URL.revokeObjectURL(url) };
    } catch { /* the next size */ }
  }
  return null;
}

/**
 * The picture inside flat bars: lyric and audio videos are often an album
 * cover between two plain side bars, and films come letterboxed. A bar is a
 * run of rows or columns from the edge that are all one colour, the edge's.
 * Looked at on a 96×54 copy; a crop that would leave less than a third of
 * the picture is not trusted.
 */
export function trimBars(img: CanvasImageSource, box: ArtCrop): ArtCrop {
  const W = 96, H = 54;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.drawImage(img, box.sx, box.sy, box.sw, box.sh, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  // Mean colour and spread of a line of pixels (a column when `column`)
  const line = (k: number, column: boolean) => {
    const n = column ? H : W;
    let r = 0, g = 0, b = 0;
    const at = (i: number) => (column ? i * W + k : k * W + i) * 4;
    for (let i = 0; i < n; i++) { const p = at(i); r += px[p]; g += px[p + 1]; b += px[p + 2]; }
    r /= n; g /= n; b /= n;
    let spread = 0;
    for (let i = 0; i < n; i++) { const p = at(i); spread += Math.abs(px[p] - r) + Math.abs(px[p + 1] - g) + Math.abs(px[p + 2] - b); }
    return { r, g, b, spread: spread / n };
  };
  const flat = (s: ReturnType<typeof line>, edge: ReturnType<typeof line>) => s.spread < 18 && Math.abs(s.r - edge.r) + Math.abs(s.g - edge.g) + Math.abs(s.b - edge.b) < 30;
  const inset = (from: number, step: number, count: number, column: boolean) => {
    const edge = line(from, column);
    let k = from;
    while (Math.abs(k - from) < count / 2 && flat(line(k, column), edge)) k += step;
    return Math.abs(k - from);
  };
  const left = inset(0, 1, W, true), right = inset(W - 1, -1, W, true);
  const top = inset(0, 1, H, false), bottom = inset(H - 1, -1, H, false);
  // One sample more, so no blurred edge of a bar stays in
  const l = left && left + 1, r = right && right + 1, t = top && top + 1, b = bottom && bottom + 1;
  if ((W - l - r) * (H - t - b) < (W * H) / 3) return box;
  const sx = box.sw / W, sy = box.sh / H;
  return { sx: box.sx + l * sx, sy: box.sy + t * sy, sw: (W - l - r) * sx, sh: (H - t - b) * sy };
}

/**
 * Shrinks `el`'s font from `max` to `min` px until its text takes at most
 * `lines` lines, then cuts the text with an ellipsis if it still does not.
 * Measured in the page, so it holds for whatever font the device draws the
 * script with. The card is thrown away after drawing, so changing its text
 * behind React's back is fine.
 */
export function fitText(el: HTMLElement, { max, min, lines, lineHeight, step = 2 }: { max: number; min: number; lines: number; lineHeight: number; step?: number }) {
  if (!(max > 0) || !(lines > 0) || !(lineHeight > 0)) return;
  el.style.lineHeight = String(lineHeight);
  const fits = (size: number) => el.getBoundingClientRect().height <= size * lineHeight * lines + 1;
  let size = max;
  for (; size >= min; size -= step) {
    el.style.fontSize = `${size}px`;
    if (fits(size)) return;
  }
  size = min;
  el.style.fontSize = `${size}px`;
  const chars = Array.from(el.textContent);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.textContent = `${chars.slice(0, mid).join('').trimEnd()}…`;
    if (fits(size)) lo = mid; else hi = mid - 1;
  }
  el.textContent = `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/**
 * Fits the laid-out card into its frame before it is drawn: every
 * [data-fit] text to its size and line limits (data-fit-max, -min, -lines,
 * -lh), then, while the card still runs over its height (a long title, a
 * full leaderboard), the art box ([data-share-art-frame]) a little smaller,
 * keeping its shape (data-aspect, width / height), down to data-min-height.
 */
export function layoutCard(card: HTMLElement) {
  for (const el of card.querySelectorAll<HTMLElement>('[data-fit]')) {
    const d = el.dataset;
    fitText(el, { max: Number(d.fitMax), min: Number(d.fitMin), lines: Number(d.fitLines), lineHeight: Number(d.fitLh) });
  }
  const frame = card.querySelector<HTMLElement>('[data-share-art-frame]');
  if (!frame) return;
  const min = Number(frame.dataset.minHeight) || 0;
  const aspect = Number(frame.dataset.aspect) || 16 / 9;
  let height = frame.getBoundingClientRect().height;
  while (card.scrollHeight > card.clientHeight + 1 && height > min) {
    height = Math.max(min, height - 6);
    frame.style.height = `${height}px`;
    frame.style.width = `${Math.round(height * aspect)}px`;
  }
}

/** A rounded rectangle path (ctx.roundRect is too new for Safari 15). */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** The part of the art that covers a box of `aspect` (width / height), centred. */
function coverCrop(art: ArtCrop, aspect: number): ArtCrop {
  let { sx, sy, sw, sh } = art;
  if (sw / sh > aspect) {
    const w = sh * aspect;
    sx += (sw - w) / 2;
    sw = w;
  } else {
    const h = sw / aspect;
    sy += (sh - h) / 2;
    sh = h;
  }
  return { sx, sy, sw, sh };
}

/**
 * Box blur of a small canvas, three passes (close to a Gaussian). Done by
 * hand: canvas `filter` is missing from older Safari, and on a canvas a
 * fifteenth of the card's size it costs next to nothing.
 */
function blur(canvas: HTMLCanvasElement, radius: number, saturation = 1) {
  const ctx = context2d(canvas, { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const image = ctx.getImageData(0, 0, w, h);
  const src = image.data;
  // Averaging greys colours out; push them back apart from their luminance
  for (let i = 0; i < src.length; i += 4) {
    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    for (let c = 0; c < 3; c++) src[i + c] = Math.max(0, Math.min(255, lum + (src[i + c] - lum) * saturation));
  }
  const tmp = new Float32Array(src.length);
  const pass = (from: Uint8ClampedArray | Float32Array, to: Uint8ClampedArray | Float32Array, horizontal: boolean) => {
    const outer = horizontal ? h : w, inner = horizontal ? w : h;
    for (let o = 0; o < outer; o++) {
      for (let i = 0; i < inner; i++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const j = Math.min(inner - 1, Math.max(0, i + k));
          const idx = (horizontal ? o * w + j : j * w + o) * 4;
          r += from[idx]; g += from[idx + 1]; b += from[idx + 2]; n++;
        }
        const out = (horizontal ? o * w + i : i * w + o) * 4;
        to[out] = r / n; to[out + 1] = g / n; to[out + 2] = b / n; to[out + 3] = 255;
      }
    }
  };
  for (let p = 0; p < 3; p++) {
    pass(src, tmp, true);
    pass(tmp, src, false);
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Film grain over the backdrop, so the stretched blur shows no banding. The
 * same grain every time (seeded), so the same card is the same picture: the
 * server knows a share video it has made already by its pictures.
 */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tctx = context2d(tile);
  const noise = tctx.createImageData(128, 128);
  let seed = 0x2545f491;
  for (let i = 0; i < noise.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = (seed / 4294967296) * 255;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
    noise.data[i + 3] = 12;
  }
  tctx.putImageData(noise, 0, 0);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
}

/**
 * The backdrop: the song's art blown up and blurred, so every song's card
 * takes its colours, darkened so the text reads; without art, the singer's
 * colour in two soft glows.
 */
function paintBackdrop(ctx: CanvasRenderingContext2D, art: SongArt | null, hue: number) {
  const W = CARD_WIDTH, H = CARD_HEIGHT;
  ctx.fillStyle = '#0b0a1a';
  ctx.fillRect(0, 0, W, H);
  if (art) {
    const small = document.createElement('canvas');
    small.width = 48;
    small.height = 86;
    const sctx = context2d(small);
    const c = coverCrop(art, small.width / small.height);
    sctx.drawImage(art.img, c.sx, c.sy, c.sw, c.sh, 0, 0, small.width, small.height);
    blur(small, 3, 1.6);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    // Multiplied into a deep indigo: dark like the app, still the song's colours
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#3a2f6e';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else {
    const glow = (x: number, y: number, r: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(11,10,26,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    glow(W * 0.1, H * 0.2, 620, `hsla(${hue}, 100%, 55%, 0.45)`);
    glow(W * 0.95, H * 0.62, 640, `hsla(${(hue + 60) % 360}, 100%, 55%, 0.28)`);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(9,7,24,0.15)');
  shade.addColorStop(0.45, 'rgba(9,7,24,0.35)');
  shade.addColorStop(1, 'rgba(9,7,24,0.85)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H);
}

/** The art itself, in the card's art box: rounded, on a soft shadow. */
function paintArt(ctx: CanvasRenderingContext2D, art: SongArt, box: CardBox) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 18;
  roundedRect(ctx, box.x, box.y, box.w, box.h, box.radius);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, box.x, box.y, box.w, box.h, box.radius);
  ctx.clip();
  const c = coverCrop(art, box.w / box.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art.img, c.sx, c.sy, c.sw, c.sh, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** An element's border radius in px ("50%" of a 120px circle is 60). */
function radiusOf(style: CSSStyleDeclaration, w: number, h: number) {
  const r = style.borderTopLeftRadius || '0';
  return r.endsWith('%') ? (Math.min(w, h) * parseFloat(r)) / 100 : parseFloat(r) || 0;
}

/** Where an element of the card sits, in card pixels. */
function boxOf(card: Element, el: Element): CardBox {
  const c = card.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height, radius: radiusOf(getComputedStyle(el), r.width, r.height) };
}

/**
 * The card's glows and drop shadows, painted under it: elements ask with
 * data-glow (the colour), data-glow-blur and data-glow-y (px), and get a
 * soft copy of their rounded box, or of their letters with data-glow-text.
 * CSS shadows cannot do this: WebKit draws them in the wrong place, or not
 * at all, once html-to-image's picture is scaled.
 *
 * Each shape is drawn far off to the left and only its shadow, offset back,
 * lands on the card, so no hard edge shows. Shadow offsets and blur are in
 * canvas pixels, which the context's scale does not touch. `skip` leaves
 * elements out; hidden ones (not in this layer, ShareCardImage `layer`) are.
 */
function paintGlows(ctx: CanvasRenderingContext2D, card: HTMLElement, skip: (el: HTMLElement) => boolean = () => false) {
  for (const el of card.querySelectorAll<HTMLElement>('[data-glow]')) {
    if (skip(el) || getComputedStyle(el).visibility === 'hidden') continue;
    paintGlow(ctx, card, el);
  }
}

function paintGlow(ctx: CanvasRenderingContext2D, card: HTMLElement, el: HTMLElement) {
  const FAR = 4000;
  const style = getComputedStyle(el);
  const box = boxOf(card, el);
  ctx.save();
  const glow = el.dataset.glow; // (an element without one keeps the shadow it has: none)
  if (glow !== undefined) ctx.shadowColor = glow;
  ctx.shadowBlur = (Number(el.dataset.glowBlur) || 24) * CARD_SCALE;
  ctx.shadowOffsetX = FAR * CARD_SCALE;
  ctx.shadowOffsetY = (Number(el.dataset.glowY) || 0) * CARD_SCALE;
  ctx.fillStyle = '#000';
  if (el.dataset.glowText !== undefined) {
    const text = el.textContent;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.textAlign = 'center';
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent ?? parseFloat(style.fontSize) * 0.72;
    const descent = m.actualBoundingBoxDescent ?? 0;
    // Centred on the element, stretched to its width (its letter-spacing
    // is not the canvas's)
    ctx.translate(box.x + box.w / 2 - FAR, box.y + box.h / 2 + (ascent - descent) / 2);
    if (m.width > 0) ctx.scale(box.w / m.width, 1);
    ctx.fillText(text, 0, 0);
  } else {
    roundedRect(ctx, box.x - FAR, box.y, box.w, box.h, box.radius);
    ctx.fill();
  }
  ctx.restore();
}

/** The name's drawing (src/wordmark-app.svg): width over height of its viewBox. */
const viewBox = /viewBox="([^"]+)"/.exec(wordmarkSvg)?.[1];
if (!viewBox) throw new Error('wordmark-app.svg has no viewBox');
const [, , WORDMARK_W, WORDMARK_H] = viewBox.split(/[\s,]+/).map(Number);
export const WORDMARK_ASPECT = WORDMARK_W / WORDMARK_H;

let wordmarkImage: Promise<HTMLImageElement | null> | null = null;
/** The drawing as an image, loaded once; null if this browser cannot draw it. */
function loadWordmark() {
  wordmarkImage ??= new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(wordmarkSvg)}`;
  });
  return wordmarkImage;
}

/**
 * The name, "SingSpree.com" in the neon letters: elements with data-wordmark
 * get the drawing painted into their box, scaled to fit, left-aligned and
 * centred in height. Painted here on the canvas rather than in the card's
 * picture, like the art: SVG inside html-to-image's picture is what went
 * wrong on iPhones before (the name as text was cut to "singspree.a"). Where
 * the drawing will not load, the name is written in the app's gradient.
 */
async function paintWordmarks(ctx: CanvasRenderingContext2D, card: HTMLElement) {
  const els = [...card.querySelectorAll<HTMLElement>('[data-wordmark]')];
  if (!els.length) return;
  const img = await loadWordmark();
  for (const el of els) {
    const box = boxOf(card, el);
    if (img) {
      const scale = Math.min(box.w / WORDMARK_W, box.h / WORDMARK_H);
      const h = WORDMARK_H * scale;
      ctx.drawImage(img, box.x, box.y + (box.h - h) / 2, WORDMARK_W * scale, h);
    } else {
      paintWordmarkText(ctx, box, el.dataset.wordmark ?? ''); // (there: the selector asks for it)
    }
  }
}

/** The name as text in the app's cyan → purple → magenta, fitted to the box. */
function paintWordmarkText(ctx: CanvasRenderingContext2D, box: CardBox, text: string) {
  ctx.save();
  const size = Math.round(box.h * 0.46);
  ctx.font = `800 ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  if (m.width > 0) {
    const ascent = m.actualBoundingBoxAscent ?? size * 0.72;
    const descent = m.actualBoundingBoxDescent ?? size * 0.2;
    const scale = Math.min(1, box.w / m.width, box.h / (ascent + descent));
    ctx.translate(box.x, box.y + box.h / 2 + ((ascent - descent) * scale) / 2);
    ctx.scale(scale, scale);
    const gradient = ctx.createLinearGradient(0, 0, m.width, 0);
    gradient.addColorStop(0, '#00e5ff');
    gradient.addColorStop(0.5, '#b44aff');
    gradient.addColorStop(1, '#ff00e5');
    ctx.fillStyle = gradient;
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}

/** The card's own picture (html-to-image), at the image's size; `filter` leaves elements out */
const cardPicture = (card: HTMLElement, filter?: (node: HTMLElement) => boolean) => toCanvas(card, {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  pixelRatio: CARD_SCALE,
  // System fonts only, so there is nothing to embed; skipping it also
  // spares reading every stylesheet on the page
  skipFonts: true,
  // The card waits off-screen; its copy is drawn at the origin
  style: { transform: 'none', position: 'static', left: '0', top: '0' },
  ...(filter ? { filter } : {}),
});

const imageCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CARD_WIDTH * CARD_SCALE);
  canvas.height = Math.round(CARD_HEIGHT * CARD_SCALE);
  return canvas;
};

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The share image could not be encoded'))), type, quality);
});

/**
 * The finished image as a JPEG blob: backdrop, glows, art and names painted here,
 * the card (`card`, laid out at CARD_WIDTH × CARD_HEIGHT with a transparent
 * background, after layoutCard) drawn over them.
 */
export async function renderShareImage(card: HTMLElement, { art, hue }: { art: SongArt | null; hue: number }): Promise<Blob> {
  const artEl = card.querySelector('[data-share-art]');
  const box = art && artEl ? boxOf(card, artEl) : null;
  const overlay = await cardPicture(card);
  const canvas = imageCanvas();
  const ctx = context2d(canvas);
  ctx.scale(CARD_SCALE, CARD_SCALE);
  paintBackdrop(ctx, art, hue);
  paintGlows(ctx, card);
  // (the camera's window stays dark: the server puts the singer there)
  if (art && box && !artEl?.hasAttribute('data-share-camera')) paintArt(ctx, art, box);
  await paintWordmarks(ctx, card);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  return encode(canvas, 'image/jpeg', 0.9);
}

// ── The share video's layers ───────────────────────────────────────────
//
// The video (backend clipAnimation.ts) is the card coming together: the
// melody bars light up to the score while it counts, the stars pop in as the
// count passes them, then the score and what it earned. The card is drawn
// here as the browser draws it, in any script, and the server only moves the
// pieces: the card before its result (ShareCardImage layer "base", through
// renderShareImage), the rest of the result alone on transparency (layer
// "result", renderResultLayer), the score counting up to itself
// (renderCountStrip), and where each piece sits on the 1080 × 1920 picture
// (shareLayout). The server cuts the pieces out of the result by their
// boxes, so the score, which nearly touches the stars, is a picture of its own.

const isScore = (el: HTMLElement) => el.dataset?.anim === 'score';

/** The result layer: the card with layer="result" (all but the result hidden) less the score, its glows under it, as a PNG */
export async function renderResultLayer(card: HTMLElement): Promise<Blob> {
  const picture = await cardPicture(card, (node) => !isScore(node));
  const canvas = imageCanvas();
  const ctx = context2d(canvas);
  ctx.scale(CARD_SCALE, CARD_SCALE);
  paintGlows(ctx, card, isScore);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return encode(canvas, 'image/png');
}

/** The score's glow reaches this far around it (card px): the video's piece of it is this much bigger */
export const SCORE_PAD = 40;
export const COUNT_FRAMES = 18;
/** Where only PNG can be made (Safari), fewer: the glow makes each one large */
export const COUNT_FRAMES_PNG = 12;

let webpEncodes: boolean | null = null;
const canEncodeWebp = () => {
  if (webpEncodes === null) {
    try { webpEncodes = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { webpEncodes = false; }
  }
  return webpEncodes;
};

/** The count's value in frame `k` of `frames`: easing out like the bars' fill (the video's timing) */
export const countValue = (score: number, k: number, frames = COUNT_FRAMES) => {
  const u = frames > 1 ? k / (frames - 1) : 1;
  return Math.round(score * (1 - (1 - u) * (1 - u)));
};

/**
 * The score counting up, for the video: COUNT_FRAMES pictures of the score
 * element's box (with its glow) stacked top to bottom, from 0 to the score.
 * The numbers on the way are drawn on a canvas in the element's font (the
 * canvas does not space letters like the page, so each is narrowed by what
 * the page's final number measures against the canvas's); the last is the
 * page's own score, glow and all, as it stands on the card (or the canvas's,
 * should the page's come out blank). WebP where the browser makes it (the
 * glow makes a PNG of 18 of them about 2 MB), else PNG of fewer.
 * Returns { blob, cell } (cell: one picture's box on the 1080 × 1920
 * picture, with `frames`) or null without a score.
 */
export async function renderCountStrip(card: HTMLElement, frames = canEncodeWebp() ? COUNT_FRAMES : COUNT_FRAMES_PNG): Promise<CountStrip | null> {
  const el = card.querySelector<HTMLElement>('[data-anim="score"]');
  const score = Number(el?.dataset.score);
  if (!el || !Number.isFinite(score)) return null;
  const box = boxOf(card, el);
  const style = getComputedStyle(el);
  const cx = box.x - SCORE_PAD, cy = box.y - SCORE_PAD;
  const cellW = Math.round((box.w + 2 * SCORE_PAD) * CARD_SCALE), cellH = Math.round((box.h + 2 * SCORE_PAD) * CARD_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = cellW;
  canvas.height = cellH * frames;
  const ctx = context2d(canvas);
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.textAlign = 'center';
  const final = ctx.measureText(score.toLocaleString());
  const squeeze = final.width > 0 ? Math.min(1, box.w / final.width) : 1;
  const ascent = final.actualBoundingBoxAscent ?? parseFloat(style.fontSize) * 0.72;
  const descent = final.actualBoundingBoxDescent ?? 0;
  const cellAt = (k: number) => ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, -cx * CARD_SCALE, k * cellH - cy * CARD_SCALE);
  const number = (k: number, value: number) => {
    ctx.save();
    cellAt(k);
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2 + (ascent - descent) / 2);
    ctx.scale(squeeze, 1);
    ctx.shadowColor = el.dataset.glow || 'transparent';
    ctx.shadowBlur = (Number(el.dataset.glowBlur) || 24) * CARD_SCALE * 0.7;
    ctx.fillStyle = style.color;
    ctx.fillText(value.toLocaleString(), 0, 0);
    ctx.restore();
  };
  for (let k = 0; k < frames - 1; k++) number(k, countValue(score, k, frames));
  // the last: the page's score
  const at = { x: Math.round(SCORE_PAD * CARD_SCALE), y: (frames - 1) * cellH + Math.round(SCORE_PAD * CARD_SCALE), w: Math.round(box.w * CARD_SCALE), h: Math.round(box.h * CARD_SCALE) };
  let drawn = false;
  try {
    const own = await toCanvas(el, { width: box.w, height: box.h, pixelRatio: CARD_SCALE, skipFonts: true, style: { margin: '0' } });
    const pixels = context2d(own).getImageData(0, 0, own.width, own.height).data;
    let inked = 0;
    for (let i = 3; i < pixels.length; i += 16) if (pixels[i] > 128) inked++;
    // a blank picture (WebKit can leave the first one empty) is no score
    if (inked > pixels.length / 16 / 100) {
      cellAt(frames - 1);
      paintGlow(ctx, card, el);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(own, at.x, at.y, at.w, at.h);
      drawn = true;
    }
  } catch { /* drawn by the canvas instead */ }
  if (!drawn) number(frames - 1, score);
  const webp = canEncodeWebp() ? await encode(canvas, 'image/webp', 0.9).catch(() => null) : null;
  const blob = webp?.type === 'image/webp' ? webp : await encode(canvas, 'image/png');
  return { blob, cell: { x: Math.round(cx * CARD_SCALE), y: Math.round(cy * CARD_SCALE), w: cellW, h: cellH, frames } };
}

/**
 * Where the result's pieces sit on the 1080 × 1920 picture, from the card
 * laid out with layer="result": { score, wave, fill, marker, stars[], badges, art }.
 * `wave` is the melody bars' box, `fill` how far from its left edge the
 * score lights them (px), `marker` the score line, drawn left of the bars.
 */
export function shareLayout(card: HTMLElement): ShareLayout {
  const at = (el: Element | null): PictureBox | null => {
    if (!el) return null;
    const b = boxOf(card, el);
    return { x: b.x * CARD_SCALE, y: b.y * CARD_SCALE, w: b.w * CARD_SCALE, h: b.h * CARD_SCALE };
  };
  const wave = card.querySelector<HTMLElement>('[data-anim="wave"]');
  return {
    score: at(card.querySelector('[data-anim="score"]')),
    wave: at(wave),
    fill: (Number(wave?.dataset.fill) || 0) * CARD_SCALE,
    marker: at(card.querySelector('[data-anim="marker"]')),
    stars: [...card.querySelectorAll('[data-anim="star"]')].map(at),
    badges: at(card.querySelector('[data-anim="badges"]')),
    art: at(card.querySelector('[data-share-art]')),
  };
}
