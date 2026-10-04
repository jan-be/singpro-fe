import { toCanvas } from 'html-to-image';
import { readTextFile } from './LyricsParser';
import { scriptChoice, SCRIPT_LANG } from './lyricsScripts';

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
export function rankByScore(scores) {
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
export function leaderboardRows(ranked, me, max = 5) {
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
export function cardNames(song, locale) {
  const { tag } = scriptChoice(song?.titles, { locale, language: song?.language });
  const own = tag ? song.titles[tag] : null;
  if (!own) return { title: song?.title, artist: song?.artist };
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
export async function melodyOf(lyrics, part = 1) {
  if (!lyrics) return null;
  let chart;
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
export function waveform(melody, bins = 64) {
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

/**
 * The song's video thumbnail, as { img, sx, sy, sw, sh, aspect, dispose }:
 * the image and the picture in it, which is the 16:9 middle (the 4:3 sizes
 * letterbox a 16:9 video in black bars) less any flat bars around it
 * (trimBars). i.ytimg.com answers with Access-Control-Allow-Origin: *, and a
 * blob fetched with CORS is ours to draw, so the canvas stays readable. Null
 * without a video or when every size fails.
 */
export async function loadSongArt(videoId) {
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
export function trimBars(img, box) {
  const W = 96, H = 54;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, box.sx, box.sy, box.sw, box.sh, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  // Mean colour and spread of a line of pixels (a column when `column`)
  const line = (k, column) => {
    const n = column ? H : W;
    let r = 0, g = 0, b = 0;
    const at = i => (column ? i * W + k : k * W + i) * 4;
    for (let i = 0; i < n; i++) { const p = at(i); r += px[p]; g += px[p + 1]; b += px[p + 2]; }
    r /= n; g /= n; b /= n;
    let spread = 0;
    for (let i = 0; i < n; i++) { const p = at(i); spread += Math.abs(px[p] - r) + Math.abs(px[p + 1] - g) + Math.abs(px[p + 2] - b); }
    return { r, g, b, spread: spread / n };
  };
  const flat = (s, edge) => s.spread < 18 && Math.abs(s.r - edge.r) + Math.abs(s.g - edge.g) + Math.abs(s.b - edge.b) < 30;
  const inset = (from, step, count, column) => {
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
export function fitText(el, { max, min, lines, lineHeight, step = 2 }) {
  if (!el || !(max > 0) || !(lines > 0) || !(lineHeight > 0)) return;
  el.style.lineHeight = String(lineHeight);
  const fits = (size) => el.getBoundingClientRect().height <= size * lineHeight * lines + 1;
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
export function layoutCard(card) {
  for (const el of card.querySelectorAll('[data-fit]')) {
    const d = el.dataset;
    fitText(el, { max: Number(d.fitMax), min: Number(d.fitMin), lines: Number(d.fitLines), lineHeight: Number(d.fitLh) });
  }
  const frame = card.querySelector('[data-share-art-frame]');
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
function roundedRect(ctx, x, y, w, h, r) {
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
function coverCrop(art, aspect) {
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
function blur(canvas, radius, saturation = 1) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const image = ctx.getImageData(0, 0, w, h);
  const src = image.data;
  // Averaging greys colours out; push them back apart from their luminance
  for (let i = 0; i < src.length; i += 4) {
    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    for (let c = 0; c < 3; c++) src[i + c] = Math.max(0, Math.min(255, lum + (src[i + c] - lum) * saturation));
  }
  const tmp = new Float32Array(src.length);
  const pass = (from, to, horizontal) => {
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

/** Film grain over the backdrop, so the stretched blur shows no banding. */
function grain(ctx, w, h) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tctx = tile.getContext('2d');
  const noise = tctx.createImageData(128, 128);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = Math.random() * 255;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
    noise.data[i + 3] = 12;
  }
  tctx.putImageData(noise, 0, 0);
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, w, h);
}

/**
 * The backdrop: the song's art blown up and blurred, so every song's card
 * takes its colours, darkened so the text reads; without art, the singer's
 * colour in two soft glows.
 */
function paintBackdrop(ctx, art, hue) {
  const W = CARD_WIDTH, H = CARD_HEIGHT;
  ctx.fillStyle = '#0b0a1a';
  ctx.fillRect(0, 0, W, H);
  if (art) {
    const small = document.createElement('canvas');
    small.width = 48;
    small.height = 86;
    const sctx = small.getContext('2d');
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
    const glow = (x, y, r, color) => {
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
function paintArt(ctx, art, box) {
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
function radiusOf(style, w, h) {
  const r = style.borderTopLeftRadius || '0';
  return r.endsWith('%') ? (Math.min(w, h) * parseFloat(r)) / 100 : parseFloat(r) || 0;
}

/** Where an element of the card sits, in card pixels. */
function boxOf(card, el) {
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
 * canvas pixels, which the context's scale does not touch.
 */
function paintGlows(ctx, card) {
  const FAR = 4000;
  for (const el of card.querySelectorAll('[data-glow]')) {
    const box = boxOf(card, el);
    const style = getComputedStyle(el);
    ctx.save();
    ctx.shadowColor = el.dataset.glow;
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
}

/**
 * Names in the app's cyan → purple → magenta: elements with data-wordmark
 * (the text) get it painted into their box, at their font size and weight,
 * shrunk evenly where this device's font is wider than the box, left-aligned
 * and centred in height. Measured here on the canvas, so the size always
 * holds: SVG text squeezed with textLength was cut to "singpro.a" on iPhones.
 */
function paintWordmarks(ctx, card) {
  for (const el of card.querySelectorAll('[data-wordmark]')) {
    const box = boxOf(card, el);
    const style = getComputedStyle(el);
    const text = el.dataset.wordmark;
    ctx.save();
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(text);
    if (!(m.width > 0)) { ctx.restore(); continue; }
    const size = parseFloat(style.fontSize);
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
    ctx.restore();
  }
}

/**
 * The finished image as a JPEG blob: backdrop, glows, art and names painted here,
 * the card (`card`, laid out at CARD_WIDTH × CARD_HEIGHT with a transparent
 * background, after layoutCard) drawn over them.
 */
export async function renderShareImage(card, { art, hue }) {
  const artEl = card.querySelector('[data-share-art]');
  const box = art && artEl ? boxOf(card, artEl) : null;
  const overlay = await toCanvas(card, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    pixelRatio: CARD_SCALE,
    // System fonts only, so there is nothing to embed; skipping it also
    // spares reading every stylesheet on the page
    skipFonts: true,
    // The card waits off-screen; its copy is drawn at the origin
    style: { transform: 'none', position: 'static', left: '0', top: '0' },
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CARD_WIDTH * CARD_SCALE);
  canvas.height = Math.round(CARD_HEIGHT * CARD_SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(CARD_SCALE, CARD_SCALE);
  paintBackdrop(ctx, art, hue);
  paintGlows(ctx, card);
  if (art && box) paintArt(ctx, art, box);
  paintWordmarks(ctx, card);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The share image could not be encoded'))), 'image/jpeg', 0.9);
  });
}
