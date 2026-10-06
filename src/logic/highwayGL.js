/**
 * Draws a note highway scene (glScene.js) with WebGL2: in the highway's
 * worker (HighwayWorker.js) on the page's canvas handed over as an
 * OffscreenCanvas, or where that cannot be, on the page's own <canvas> on the
 * main thread (highwayRenderer.js). Why WebGL: where the browser fills a 2D
 * canvas on the CPU (a Fire TV stick: no GPU raster for canvases on its
 * PowerVR), every glowing line, bar and label of every frame was filled pixel
 * by pixel, which needed most of a core and fell to half the frame rate.
 * Here the GPU fills them: each shape is computed per pixel from its distance
 * to the edge (anti-aliased by the same distance), with one draw per run of
 * shapes of a kind.
 *
 *   boxes    rounded rectangles: fill, a stroke centred on the edge, dashes
 *   strokes  segments of a line through shared points; a pixel is drawn by its
 *            nearest segment only (the ones within WINDOW either side are
 *            asked), so a translucent halo is as even as on a 2D canvas, where
 *            the line is one path
 *   sprites  text and avatars, drawn into an atlas with a 2D canvas once each
 *
 * createGLRenderer(canvas) throws if this browser cannot (no WebGL2 here, a
 * shader that does not compile): from the worker the main thread takes over
 * then; on the main thread the highway is not drawn.
 */
import { BOX_FLOATS, STROKE_FLOATS, SPRITE_FLOATS, BACKDROP, BOXES, STROKES, SPRITES, FADE, EDGE_FADE } from './glScene';

const VERT_W = 512;     // the point texture's width (a line's points, row by row)
const ATLAS = 1024;     // the sprite atlas's side
const WINDOW = 8;       // segments either side that may be nearer to a pixel
const GPU_SPRITE = 10;  // device-pixel sprite instance: x, y, w, h, u0, v0, u1, v1, alpha, clip

const HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;      // canvas, device pixels
uniform float uDpr;     // device pixels per CSS pixel
uniform float uClipX;   // the cursor, CSS pixels
vec4 toClip(vec2 dev) { vec2 c = dev / uRes * 2.0 - 1.0; return vec4(c.x, -c.y, 0.0, 1.0); }
float clipCover(float x, float on) { return on > 0.5 ? clamp((uClipX - x) * uDpr + 0.5, 0.0, 1.0) : 1.0; }
`;

const BOX_VS = `${HEAD}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;    // x, y, w, h
layout(location = 2) in vec4 aParams;  // radius, stroke width, dash, clip
layout(location = 3) in vec4 aFill;
layout(location = 4) in vec4 aStroke;
out vec2 vLocal;
out float vX;
flat out vec4 vShape;   // half size, radius, stroke width
flat out vec2 vFlags;   // dash, clip
flat out vec4 vFill;
flat out vec4 vStroke;
void main() {
  float pad = aParams.y * 0.5 + 1.5 / uDpr;
  vec2 p = mix(aRect.xy - pad, aRect.xy + aRect.zw + pad, aCorner);
  vLocal = p - (aRect.xy + aRect.zw * 0.5);
  vX = p.x;
  vShape = vec4(aRect.zw * 0.5, aParams.x, aParams.y);
  vFlags = aParams.zw;
  vFill = aFill;
  vStroke = aStroke;
  gl_Position = toClip(p * uDpr);
}`;

const BOX_FS = `${HEAD}
in vec2 vLocal;
in float vX;
flat in vec4 vShape;
flat in vec2 vFlags;
flat in vec4 vFill;
flat in vec4 vStroke;
out vec4 outColor;
// How far along the outline a point lies, clockwise from the top edge's left
// end: where a 2D canvas's roundRect path starts, so the dashes fall the same
float along(vec2 p, vec2 hs, float r) {
  vec2 c = max(hs - r, 0.0);
  float A = 1.5707963 * r, Lx = 2.0 * c.x, Ly = 2.0 * c.y;
  vec2 q = clamp(p, -c, c);
  vec2 d = p - q;
  if (d.x == 0.0 && d.y == 0.0) {
    float t = p.y + c.y, b = c.y - p.y, l = p.x + c.x, rr = c.x - p.x;
    float m = min(min(t, b), min(l, rr));
    if (m == t) return p.x + c.x;
    if (m == rr) return Lx + A + p.y + c.y;
    if (m == b) return Lx + 2.0 * A + Ly + c.x - p.x;
    return 2.0 * Lx + 3.0 * A + Ly + c.y - p.y;
  }
  if (d.x == 0.0) return d.y < 0.0 ? q.x + c.x : Lx + 2.0 * A + Ly + c.x - q.x;
  if (d.y == 0.0) return d.x > 0.0 ? Lx + A + q.y + c.y : 2.0 * Lx + 3.0 * A + Ly + c.y - q.y;
  if (d.x > 0.0 && d.y < 0.0) return Lx + atan(d.x, -d.y) * r;
  if (d.x > 0.0) return Lx + A + Ly + atan(d.y, d.x) * r;
  if (d.y > 0.0) return 2.0 * Lx + 2.0 * A + Ly + atan(-d.x, d.y) * r;
  return 2.0 * Lx + 3.0 * A + 2.0 * Ly + atan(-d.y, -d.x) * r;
}
void main() {
  vec2 hs = vShape.xy;
  float r = vShape.z, sw = vShape.w;
  vec2 q = abs(vLocal) - (hs - r);
  float dd = (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r) * uDpr; // device pixels, < 0 inside
  float fill = min(clamp(0.5 - dd, 0.0, 1.0), 2.0 * min(hs.x, hs.y) * uDpr);
  float hw = sw * 0.5 * uDpr;
  float line = sw > 0.0 ? clamp(hw + 0.5 - abs(dd), 0.0, min(1.0, 2.0 * hw)) : 0.0;
  if (vFlags.x > 0.5 && line > 0.0) {
    float m = mod(along(vLocal, hs, r), 5.0); // [3, 2]: 3 on, 2 off
    line *= clamp((3.0 - m) * uDpr + 0.5, 0.0, 1.0) * clamp(m * uDpr + 0.5, 0.0, 1.0);
  }
  vec4 c = (vStroke * line + vFill * fill * (1.0 - vStroke.a * line)) * clipCover(vX, vFlags.y);
  if (c.a <= 0.0) discard;
  outColor = c;
}`;

const STROKE_VS = `${HEAD}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;    // vertex, first, last, clip
layout(location = 2) in vec4 aRadii;  // halo, line, core, arc (1: segments asked round the ring)
layout(location = 3) in vec4 aC1;
layout(location = 4) in vec4 aC2;
layout(location = 5) in vec4 aC3;
uniform highp sampler2D uVerts;
flat out ivec3 vSeg;
flat out vec4 vRadii;
flat out vec4 vC1;
flat out vec4 vC2;
flat out vec4 vC3;
flat out float vClip;
vec2 vert(int i) { return texelFetch(uVerts, ivec2(i % ${VERT_W}, i / ${VERT_W}), 0).xy; }
void main() {
  int i = int(aSeg.x + 0.5), last = int(aSeg.z + 0.5);
  vec2 a = vert(i), b = i < last ? vert(i + 1) : a;
  float pad = aRadii.x + 1.5 / uDpr;
  vec2 p = mix(min(a, b) - pad, max(a, b) + pad, aCorner);
  vSeg = ivec3(i, int(aSeg.y + 0.5), last);
  vRadii = aRadii;
  vC1 = aC1; vC2 = aC2; vC3 = aC3;
  vClip = aSeg.w;
  gl_Position = toClip(p * uDpr);
}`;

const STROKE_FS = `${HEAD}
uniform highp sampler2D uVerts;
flat in ivec3 vSeg;
flat in vec4 vRadii;
flat in vec4 vC1;
flat in vec4 vC2;
flat in vec4 vC3;
flat in float vClip;
out vec4 outColor;
vec2 vert(int i) { return texelFetch(uVerts, ivec2(i % ${VERT_W}, i / ${VERT_W}), 0).xy; }
// The ends are taken as they are (not a + 1.0 * (b - a)), so two segments
// measure their shared point identically and a tie is a tie
float dist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float l2 = dot(ab, ab);
  if (l2 <= 0.0) return length(p - a);
  float t = dot(p - a, ab) / l2;
  vec2 q = t <= 0.0 ? a : (t >= 1.0 ? b : a + t * ab);
  return length(p - q);
}
float cover(float r, float dd) { return r > 0.0 ? clamp(r * uDpr - dd + 0.5, 0.0, 1.0) : 0.0; }
void main() {
  // The pixel's centre from gl_FragCoord: a position interpolated across each
  // segment's own quad differed in the last bit between two segments, and
  // both could find the other nearer and leave a hole
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  int i = vSeg.x, first = vSeg.y, last = vSeg.z;
  vec2 a = vert(i), b = i < last ? vert(i + 1) : a;
  float d = dist(p, a, b);
  if (d * uDpr > vRadii.x * uDpr + 0.5) discard;
  // drawn by the nearest segment only; a tie goes to the earlier one
  if (vRadii.w > 0.5) {
    // An arc (the countdown ring): its two ends meet when it is nearly a full
    // circle, so the segments are asked round the ring, never one twice (or
    // the halo would be doubled where the ends meet; a 2D canvas strokes it
    // as one path)
    int n = last - first, back = min(${WINDOW}, (n - 1) / 2), fwd = min(${WINDOW}, n - 1 - back), s = i - first;
    for (int k = 1; k <= ${WINDOW}; k++) {
      if (k > back) break;
      int j = first + (s - k + n) % n;
      if (dist(p, vert(j), vert(j + 1)) <= d) discard;
    }
    for (int k = 1; k <= ${WINDOW}; k++) {
      if (k > fwd) break;
      int j = first + (s + k) % n;
      if (dist(p, vert(j), vert(j + 1)) < d) discard;
    }
  } else {
    vec2 end = a;
    for (int k = 1; k <= ${WINDOW}; k++) {
      int j = i - k;
      if (j < first) break;
      vec2 start = vert(j);
      if (dist(p, start, end) <= d) discard;
      end = start;
    }
    vec2 start = b;
    for (int k = 1; k <= ${WINDOW}; k++) {
      int j = i + k;
      if (j >= last) break;
      vec2 next = vert(j + 1);
      if (dist(p, start, next) < d) discard;
      start = next;
    }
  }
  float dd = d * uDpr;
  float c1 = cover(vRadii.x, dd), c2 = cover(vRadii.y, dd), c3 = cover(vRadii.z, dd);
  vec4 c = vC1 * c1;
  c = vC2 * c2 + c * (1.0 - vC2.a * c2);
  c = vC3 * c3 + c * (1.0 - vC3.a * c3);
  c *= clipCover(p.x, vClip);
  if (c.a <= 0.0) discard;
  outColor = c;
}`;

const SPRITE_VS = `${HEAD}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBox;   // device pixels
layout(location = 2) in vec4 aUv;
layout(location = 3) in vec2 aMisc;  // alpha, clip
out vec2 vUv;
out float vX;
flat out vec2 vMisc;
void main() {
  vec2 p = aBox.xy + aBox.zw * aCorner;
  vUv = mix(aUv.xy, aUv.zw, aCorner);
  vX = p.x / uDpr;
  vMisc = aMisc;
  gl_Position = toClip(p);
}`;

const SPRITE_FS = `${HEAD}
uniform sampler2D uAtlas;
in vec2 vUv;
in float vX;
flat in vec2 vMisc;
out vec4 outColor;
void main() {
  vec4 c = texture(uAtlas, vUv) * vMisc.x * clipCover(vX, vMisc.y);
  if (c.a <= 0.0) discard;
  outColor = c;
}`;

// The backdrop band and the side fades: one triangle over the canvas
const FULL_VS = `${HEAD}
layout(location = 0) in vec2 aCorner;
void main() { gl_Position = vec4(aCorner * 4.0 - 1.0, 0.0, 1.0); }`;

const BACKDROP_FS = `${HEAD}
out vec4 outColor;
void main() {
  float t = 1.0 - gl_FragCoord.y / uRes.y; // 0 at the top
  float a = 0.45 * min(1.0, min(t, 1.0 - t) / 0.18);
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;

const FADE_FS = `${HEAD}
uniform float uWidth;   // CSS pixels
out vec4 outColor;
void main() {
  float x = gl_FragCoord.x / uDpr, w = uWidth * ${EDGE_FADE.toFixed(4)};
  float e = max(1.0 - x / w, 1.0 - (uWidth - x) / w);
  outColor = vec4(0.0, 0.0, 0.0, clamp(e, 0.0, 1.0)); // erases: blended (0, 1 - a)
}`;

function compile(gl, vs, fs, name) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`highway ${name} shader: ${gl.getShaderInfoLog(sh)}`);
    }
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`highway ${name} program: ${gl.getProgramInfoLog(prog)}`);
  }
  const u = {};
  for (const n of ['uRes', 'uDpr', 'uClipX', 'uVerts', 'uAtlas', 'uWidth']) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

const ATTRS = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };

const PROGRAMS = [[BOX_VS, BOX_FS, 'box'], [STROKE_VS, STROKE_FS, 'stroke'], [SPRITE_VS, SPRITE_FS, 'sprite'], [FULL_VS, BACKDROP_FS, 'backdrop'], [FULL_VS, FADE_FS, 'fade']];

/** A sprite atlas: shelves of pictures, emptied when full (what is still drawn comes back by itself). */
class Atlas {
  constructor() { this.reset(); }
  reset() { this.x = 0; this.y = 0; this.row = 0; this.placed = new Map(); }
  place(w, h) {
    if (w + 1 > ATLAS || h + 1 > ATLAS) return null;
    if (this.x + w + 1 > ATLAS) { this.x = 0; this.y += this.row + 1; this.row = 0; }
    if (this.y + h + 1 > ATLAS) return null;
    const at = { x: this.x, y: this.y };
    this.x += w + 1;
    this.row = Math.max(this.row, h);
    return at;
  }
}

/**
 * The renderer for `canvas`: an OffscreenCanvas (in the worker) or the page's
 * <canvas> (on the main thread). Throws when WebGL2 cannot draw the highway
 * here. draw(scene) paints a frame; onLost is called if the GPU context goes
 * away; destroy() lets go of what it holds on the GPU.
 */
export function createGLRenderer(canvas, { onLost } = {}) {
  const gl = canvas.getContext('webgl2', ATTRS);
  if (!gl) throw new Error('no WebGL2 context');
  if (!(gl.getParameter(gl.MAX_TEXTURE_SIZE) >= ATLAS)) throw new Error('textures too small for the sprite atlas');
  const lost = (e) => { e.preventDefault(); onLost?.(); };
  canvas.addEventListener?.('webglcontextlost', lost);
  const [box, stroke, sprite, backdrop, fade] = PROGRAMS.map(([vs, fs, n]) => compile(gl, vs, fs, n));

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

  // One vertex array per kind: the unit quad at 0, its instance attributes after
  const kind = (layout, floats) => {
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    let offset = 0;
    const attrs = layout.map((size, k) => {
      const at = { loc: k + 1, size, offset };
      gl.enableVertexAttribArray(at.loc);
      gl.vertexAttribDivisor(at.loc, 1);
      offset += size * 4;
      return at;
    });
    gl.bindVertexArray(null);
    return { vao, buf, attrs, stride: floats * 4 };
  };
  const boxes = kind([4, 4, 4, 4], BOX_FLOATS);
  const strokes = kind([4, 4, 4, 4, 4], STROKE_FLOATS);
  const sprites = kind([4, 4, 2], GPU_SPRITE);
  const full = gl.createVertexArray();
  gl.bindVertexArray(full);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const texture = (unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, unit === 0 ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, unit === 0 ? gl.NEAREST : gl.LINEAR);
    return t;
  };
  const vertTex = texture(0);
  const atlasTex = texture(1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS, ATLAS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  let vertData = new Float32Array(VERT_W * 2 * 4);

  const atlas = new Atlas();
  // Text and pictures go into the atlas through a 2D canvas of the same kind
  // as the one drawn on: a worker has no <canvas>, and on the main thread a
  // <canvas> is the source every WebGL2 takes (OffscreenCanvas came later)
  const scratch = typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
    ? new OffscreenCanvas(16, 16)
    : Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
  const sx = scratch.getContext('2d');
  if (!sx) throw new Error('no 2D canvas for the text');
  const images = new Map(); // id -> ImageBitmap (in a worker), or a canvas (on the main thread)
  let gpuSprites = new Float32Array(GPU_SPRITE * 64);

  /** Draw into the scratch canvas of w x h device pixels and copy it to a new place in the atlas. */
  const upload = (w, h, paint) => {
    const at = atlas.place(w, h);
    if (!at) return null;
    scratch.width = w; // (resizing clears it and its state)
    scratch.height = h;
    paint(sx);
    gl.activeTexture(gl.TEXTURE1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, at.x, at.y, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    return { u0: at.x / ATLAS, v0: at.y / ATLAS, u1: (at.x + w) / ATLAS, v1: (at.y + h) / ATLAS, w, h };
  };

  /** A text sprite: drawn at `dpr` with its anchor (where fillText would put x, y) on a device pixel. */
  const textSprite = (def, dpr) => {
    sx.font = def.font;
    sx.textAlign = def.align;
    sx.textBaseline = def.baseline;
    const m = sx.measureText(def.text);
    const pad = 1 + (def.stroke ? def.lineWidth / 2 : 0);
    const left = Math.ceil((m.actualBoundingBoxLeft + pad) * dpr);
    const top = Math.ceil((m.actualBoundingBoxAscent + pad) * dpr);
    const w = Math.max(1, left + Math.ceil((m.actualBoundingBoxRight + pad) * dpr));
    const h = Math.max(1, top + Math.ceil((m.actualBoundingBoxDescent + pad) * dpr));
    const s = upload(w, h, (c) => {
      c.setTransform(dpr, 0, 0, dpr, left, top);
      c.font = def.font;
      c.textAlign = def.align;
      c.textBaseline = def.baseline;
      if (def.stroke) {
        c.lineWidth = def.lineWidth;
        c.strokeStyle = def.stroke;
        c.strokeText(def.text, 0, 0);
      }
      c.fillStyle = def.fill;
      c.fillText(def.text, 0, 0);
    });
    return s && { ...s, left, top };
  };

  const imageSprite = (def) => {
    const bitmap = images.get(def.image);
    if (!bitmap) return null;
    // through the 2D canvas, so it arrives premultiplied like the text does
    return upload(bitmap.width, bitmap.height, (c) => c.drawImage(bitmap, 0, 0));
  };

  /** The scene's sprites as device-pixel quads from the atlas (placing what is not there yet). */
  const resolveSprites = (scene) => {
    const { sprites: s, nSprites, defs, dpr } = scene;
    const count = nSprites / SPRITE_FLOATS;
    if (gpuSprites.length < count * GPU_SPRITE) gpuSprites = new Float32Array(count * GPU_SPRITE * 2);
    for (let attempt = 0; attempt < 2; attempt++) {
      const last = attempt === 1;
      let full = false;
      for (let k = 0; k < count && !full; k++) {
        const i = k * SPRITE_FLOATS;
        const def = defs[s[i]];
        const isImage = def.image !== undefined;
        const key = isImage ? def.key : `${def.key}\u0001${dpr}`;
        let p = atlas.placed.get(key);
        if (!p && (!isImage || images.has(def.image))) {
          p = isImage ? imageSprite(def) : textSprite(def, dpr);
          if (p) atlas.placed.set(key, p);
          else if (!last) full = true; // no room: empty the atlas and place this frame's again
        }
        const o = k * GPU_SPRITE;
        if (!p) { gpuSprites.fill(0, o, o + GPU_SPRITE); continue; }
        if (isImage) {
          gpuSprites[o] = Math.round(s[i + 1] * dpr);
          gpuSprites[o + 1] = Math.round(s[i + 2] * dpr);
          gpuSprites[o + 2] = Math.round(s[i + 3] * dpr);
          gpuSprites[o + 3] = Math.round(s[i + 4] * dpr);
        } else {
          gpuSprites[o] = Math.round(s[i + 1] * dpr) - p.left;
          gpuSprites[o + 1] = Math.round(s[i + 2] * dpr) - p.top;
          gpuSprites[o + 2] = p.w;
          gpuSprites[o + 3] = p.h;
        }
        gpuSprites[o + 4] = p.u0; gpuSprites[o + 5] = p.v0; gpuSprites[o + 6] = p.u1; gpuSprites[o + 7] = p.v1;
        gpuSprites[o + 8] = s[i + 5]; gpuSprites[o + 9] = s[i + 6];
      }
      if (!full) return;
      atlas.reset(); // full: start over with only what this frame draws
    }
  };

  const uniforms = (p, scene) => {
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.uRes, canvas.width, canvas.height);
    gl.uniform1f(p.u.uDpr, scene.dpr);
    gl.uniform1f(p.u.uClipX, scene.clipX);
    if (p.u.uVerts) gl.uniform1i(p.u.uVerts, 0);
    if (p.u.uAtlas) gl.uniform1i(p.u.uAtlas, 1);
    if (p.u.uWidth) gl.uniform1f(p.u.uWidth, scene.cssWidth ?? scene.width / scene.dpr);
  };

  const run = (k, start, count) => {
    gl.bindVertexArray(k.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, k.buf);
    for (const a of k.attrs) gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, k.stride, a.offset + start * k.stride);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  };

  return {
    draw(scene) {
      if (gl.isContextLost()) return;
      if (canvas.width !== scene.width) canvas.width = scene.width;
      if (canvas.height !== scene.height) canvas.height = scene.height;
      for (const id of scene.forget) {
        images.get(id)?.close?.();
        images.delete(id);
        atlas.placed.delete(`i\u0001${id}`);
      }
      for (const { id, image } of scene.images) images.set(id, image);

      // this frame's instances and points
      gl.bindBuffer(gl.ARRAY_BUFFER, boxes.buf);
      gl.bufferData(gl.ARRAY_BUFFER, scene.boxes.subarray(0, scene.nBoxes), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, strokes.buf);
      gl.bufferData(gl.ARRAY_BUFFER, scene.strokes.subarray(0, scene.nStrokes), gl.DYNAMIC_DRAW);
      const nv = scene.nVerts / 2;
      if (nv > 0) {
        const rows = Math.ceil(nv / VERT_W);
        if (vertData.length < rows * VERT_W * 2) vertData = new Float32Array(rows * VERT_W * 2);
        vertData.set(scene.verts.subarray(0, scene.nVerts));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, vertTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, VERT_W, rows, 0, gl.RG, gl.FLOAT, vertData.subarray(0, rows * VERT_W * 2));
      }
      if (scene.nSprites > 0) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        resolveSprites(scene);
        gl.bindBuffer(gl.ARRAY_BUFFER, sprites.buf);
        gl.bufferData(gl.ARRAY_BUFFER, gpuSprites.subarray(0, (scene.nSprites / SPRITE_FLOATS) * GPU_SPRITE), gl.DYNAMIC_DRAW);
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      for (const [k, start, count] of scene.batches) {
        if (k === FADE) {
          gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
          uniforms(fade, scene);
          gl.bindVertexArray(full);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 3);
          continue;
        }
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (k === BACKDROP) {
          uniforms(backdrop, scene);
          gl.bindVertexArray(full);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 3);
        } else if (k === BOXES) {
          uniforms(box, scene);
          run(boxes, start, count);
        } else if (k === STROKES) {
          uniforms(stroke, scene);
          run(strokes, start, count);
        } else if (k === SPRITES) {
          uniforms(sprite, scene);
          run(sprites, start, count);
        }
      }
      gl.bindVertexArray(null);
    },

    // (the page's own canvas can get a renderer again: React's StrictMode
    // makes one, lets it go and makes the next on the same element)
    destroy() {
      canvas.removeEventListener?.('webglcontextlost', lost);
      for (const id of images.keys()) images.get(id)?.close?.();
      images.clear();
      if (gl.isContextLost()) return;
      for (const p of [box, stroke, sprite, backdrop, fade]) gl.deleteProgram(p.prog);
      for (const k of [boxes, strokes, sprites]) { gl.deleteVertexArray(k.vao); gl.deleteBuffer(k.buf); }
      gl.deleteVertexArray(full);
      gl.deleteBuffer(quad);
      gl.deleteTexture(vertTex);
      gl.deleteTexture(atlasTex);
    },
  };
}
