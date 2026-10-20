/**
 * The CSS colours the note highway paints with (#rgb, #rrggbb, rgb(), rgba(),
 * hsl(), hsla()) as premultiplied [r, g, b, a] in 0..1, for the WebGL painter
 * (glScene.js). Channels are rounded to 8 bits as a 2D canvas stores them, so
 * both painters blend the same colours. Cached: a frame asks for the same few
 * dozen strings over and over.
 */
const cache = new Map();
const TRANSPARENT = Object.freeze([0, 0, 0, 0]);

const byte = (v) => Math.round(Math.min(255, Math.max(0, v))) / 255;
const unit = (v) => Math.min(1, Math.max(0, v));

function hslToRgb(h, s, l) {
  // CSS Color 4: hsl() to sRGB
  h = ((h % 360) + 360) % 360;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function parse(css) {
  const s = css.trim().toLowerCase();
  if (s[0] === '#') {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const v = [...hex].map((c) => parseInt(c + c, 16));
      return [v[0], v[1], v[2], hex.length === 4 ? v[3] / 255 : 1];
    }
    if (hex.length === 6 || hex.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], hex.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  const m = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts.length > 3 ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
  if (m[1].startsWith('rgb')) {
    const ch = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
    return [...ch, alpha];
  }
  const [r, g, b] = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
  return [r, g, b, alpha];
}

/** `css` as premultiplied [r, g, b, a] (0..1); transparent black for what it cannot read. */
export function premultiplied(css) {
  let c = cache.get(css);
  if (c) return c;
  const v = parse(String(css));
  if (!v || v.some((x) => !Number.isFinite(x))) c = TRANSPARENT;
  else {
    const a = byte(unit(v[3]) * 255);
    c = Object.freeze([byte(v[0]) * a, byte(v[1]) * a, byte(v[2]) * a, a]);
  }
  if (cache.size > 4096) cache.clear();
  cache.set(css, c);
  return c;
}
