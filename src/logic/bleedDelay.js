/**
 * bleedDelay.js — how late a singer's notes are, measured from the music the
 * microphone hears (the speakers' "bleed").
 *
 * Everyone sings along to the sound coming out of the speakers, and that sound
 * reaches the scoring late: the playback chain (TV, Bluetooth, the stems'
 * place against the video clock), the room and the microphone path all add
 * up. The microphone hears the same sound, so how far the music in the mic
 * lags the song is the delay to take off the singer's notes, measured for
 * this play and this device, whatever the singing is like.
 *
 * The measurement is a whitened cross-correlation (GCC-PHAT) of the mic with
 * the song's instrumental stem, the way an echo canceller times its echo path
 * (Sony's patent does it with a white-noise test sound; here the music is the
 * test sound, so nothing is added). It runs over 8 s chunks of the mic, on the
 * clock the notes are stamped with, and adds up their correlation curves; the
 * peak of the sum is the delay once it stands out of the rest (z >= Z_MIN).
 *
 * Tested offline on 501 real recordings (2026-10-03, D:\delaytest): where the
 * peak was clear (about half), the delay it gives is within 44 ms of each
 * recording's own best delay on average and gains +739 points vs +522 for the
 * party's earlier songs and +493 for a fixed 140 ms. Where it is not clear the
 * caller falls back to a fixed delay.
 *
 * Pure functions plus one stateful estimator; BleedWorker.js runs it off the
 * main thread.
 */

export const RATE = 8000;          // Hz: everything here runs at 8 kHz (the correlation uses 100 Hz – 3.9 kHz)
export const D_MIN = -0.2;         // s: the delays searched
export const D_MAX = 0.6;
export const CHUNK_S = 8;          // s of microphone per correlation
export const STEP_S = 4;           // s between chunk starts (half overlap)
export const Z_MIN = 6;            // how far the peak must stand out to be trusted (tested threshold)
export const DETECTOR_LAG = 0.04;  // s: a pitch is stamped at its window's end, ~40 ms after the sound it hears
const EDGE = 0.01;                 // s: a peak this close to the search's ends does not count
const JUMP = 0.05;                 // s: a change of the song-minus-capture clock offset this big is a seek
const SMOOTH = Math.round(RATE / 1000);        // 1 ms box on the summed curve
const EXCLUDE = Math.round(0.01 * RATE);       // ±10 ms around the peak are not "the rest"
const LMAX = Math.round((D_MAX - D_MIN) * RATE);
const N = 1 << Math.ceil(Math.log2(CHUNK_S * RATE + LMAX + 1)); // 131072: no wrap-around for the lags searched
const BAND = [100, 3900];

// ── FFT (iterative radix-2, in place) ──
const fftCache = new Map();
function fftTables(n) {
  let t = fftCache.get(n);
  if (t) return t;
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  t = { rev, cos, sin };
  fftCache.set(n, t);
  return t;
}

/**
 * In-place complex FFT of (re, im); inverse = true for the unscaled inverse.
 * Radix-2 butterflies, two stages per pass over the arrays: for one twiddle
 * index the four points of a stage pair only meet each other, so they are
 * read once, run through both stages and written once. Each butterfly is the
 * plain radix-2 one, so the result is bit for bit the one-stage-a-pass
 * transform's, in three quarters of the time (Chrome, 131072 points).
 */
export function fft(re, im, inverse = false) {
  const n = re.length;
  const { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  let size = 2;
  if (Math.log2(n) % 2 === 1) { // an odd number of stages: the first one alone (its twiddle is 1)
    const wr = cos[0], wi = sign * sin[0];
    for (let a = 0; a < n; a += 2) {
      const b = a + 1;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi;
      re[a] += xr; im[a] += xi;
    }
    size = 4;
  }
  for (; size < n; size <<= 2) { // stages `size` and `2 * size`
    const half = size >> 1, step1 = n / size, step2 = step1 >> 1;
    for (let start = 0; start < n; start += size << 1) {
      for (let k = 0; k < half; k++) {
        const i0 = start + k, i1 = i0 + half, i2 = i0 + size, i3 = i2 + half;
        // first stage: (i0, i1) and (i2, i3), twiddle k
        let wr = cos[k * step1], wi = sign * sin[k * step1];
        let xr = re[i1] * wr - im[i1] * wi, xi = re[i1] * wi + im[i1] * wr;
        const r1 = re[i0] - xr, m1 = im[i0] - xi;
        const r0 = re[i0] + xr, m0 = im[i0] + xi;
        xr = re[i3] * wr - im[i3] * wi; xi = re[i3] * wi + im[i3] * wr;
        const r3 = re[i2] - xr, m3 = im[i2] - xi;
        const r2 = re[i2] + xr, m2 = im[i2] + xi;
        // second stage: (i0, i2), twiddle k, and (i1, i3), twiddle k + half
        wr = cos[k * step2]; wi = sign * sin[k * step2];
        xr = r2 * wr - m2 * wi; xi = r2 * wi + m2 * wr;
        re[i2] = r0 - xr; im[i2] = m0 - xi;
        re[i0] = r0 + xr; im[i0] = m0 + xi;
        wr = cos[(k + half) * step2]; wi = sign * sin[(k + half) * step2];
        xr = r3 * wr - m3 * wi; xi = r3 * wi + m3 * wr;
        re[i3] = r1 - xr; im[i3] = m1 - xi;
        re[i1] = r1 + xr; im[i1] = m1 + xi;
      }
    }
  }
}

/**
 * Whitened cross-correlation of one mic chunk with the stem around it.
 * mic: CHUNK_S * RATE samples whose first sample is stamped at song time s0;
 * ref: the stem from s0 - D_MAX for CHUNK_S + (D_MAX - D_MIN) seconds.
 * Returns c[l], l = 0..LMAX, where lag l means a delay of D_MAX - l / RATE.
 */
export function gccChunk(mic, ref) {
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(mic.subarray(0, Math.min(mic.length, N)));
  im.set(ref.subarray(0, Math.min(ref.length, N)));
  fft(re, im);                                   // both real signals in one transform
  const lo = Math.ceil(BAND[0] * N / RATE), hi = Math.floor(BAND[1] * N / RATE);
  const gr = new Float64Array(N), gi = new Float64Array(N);
  for (let k = lo; k <= hi; k++) {
    const m = (N - k) % N;
    // X = (Z[k] + conj(Z[N-k])) / 2, Y = (Z[k] - conj(Z[N-k])) / 2i
    const xr = (re[k] + re[m]) / 2, xi = (im[k] - im[m]) / 2;
    const yr = (im[k] + im[m]) / 2, yi = -(re[k] - re[m]) / 2;
    // conj(X) * Y, whitened
    const cr = xr * yr + xi * yi, ci = xr * yi - xi * yr;
    const mag = Math.hypot(cr, ci);
    if (mag < 1e-20) continue;
    gr[k] = cr / mag; gi[k] = ci / mag;
    gr[m] = gr[k]; gi[m] = -gi[k];              // Hermitian: the inverse is real
  }
  fft(gr, gi, true);
  return gr.subarray(0, LMAX + 1);
}

/** The delay (s) the summed curve points at and how far its peak stands out (robust z). */
export function peakOf(acc) {
  const n = acc.length;
  const sm = new Float64Array(n);
  let run = 0;
  const half = SMOOTH >> 1;
  for (let i = 0; i < n + half; i++) {          // centred moving average over SMOOTH samples
    if (i < n) run += acc[i];
    if (i - SMOOTH >= 0) run -= acc[i - SMOOTH];
    const c = i - half;
    if (c >= 0 && c < n) sm[c] = run / SMOOTH;
  }
  let k = 0;
  for (let i = 1; i < n; i++) if (sm[i] > sm[k]) k = i;
  // the smoothing flattens a sharp peak: its exact place is the raw curve's top under it
  let top = k;
  for (let i = Math.max(0, k - SMOOTH); i <= Math.min(n - 1, k + SMOOTH); i++) if (acc[i] > acc[top]) top = i;
  // typed arrays: their sort() is numeric, many times faster than an array's with a comparator
  const rest = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) if (i < k - EXCLUDE || i > k + EXCLUDE) rest[m++] = sm[i];
  const sorted = rest.subarray(0, m).sort();
  const med = sorted[m >> 1];
  const dev = sorted.map(v => Math.abs(v - med)).sort();
  const mad = 1.4826 * dev[m >> 1] + 1e-12;
  return { delay: D_MAX - top / RATE, z: (sm[k] - med) / mad };
}

// ── 16 kHz → 8 kHz ──
const HALFBAND = (() => {                       // 31-tap windowed sinc, cutoff 3.6 kHz at 16 kHz
  const taps = 31, fc = 3600 / 16000, h = new Float64Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - (taps - 1) / 2;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    h[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
})();

const FILTER_DELAY = (HALFBAND.length - 1) / 2 / 16000; // s: the filter's output lags its input this much

/** Streaming 2:1 decimator for the 16 kHz mic hops (keeps its filter history across calls). */
export function createDecimator() {
  const taps = HALFBAND.length;
  // the history twice over, so the newest `taps` samples are always one run
  // from the oldest (hist[pos .. pos + taps)): no modulo per tap
  const hist = new Float64Array(2 * taps);
  let pos = 0, phase = 0;
  return (x16) => {
    const out = new Float32Array(Math.ceil(x16.length / 2) + 1);
    let n = 0;
    for (let i = 0; i < x16.length; i++) {
      hist[pos] = hist[pos + taps] = x16[i]; pos = (pos + 1) % taps;
      phase ^= 1;
      if (phase) continue;
      let acc = 0;
      for (let j = 0; j < taps; j++) acc += HALFBAND[j] * hist[pos + j];
      out[n++] = acc;
    }
    return out.subarray(0, n);
  };
}

/** Any-rate mono audio to 8 kHz (linear interpolation; the caller hands in band-limited audio). */
export function resampleTo8k(x, rate) {
  if (rate === RATE) return x instanceof Float32Array ? x : Float32Array.from(x);
  const n = Math.floor(x.length * RATE / rate);
  const out = new Float32Array(n);
  const r = rate / RATE;
  for (let i = 0; i < n; i++) {
    const p = i * r, j = Math.floor(p), f = p - j;
    out[i] = j + 1 < x.length ? x[j] * (1 - f) + x[j + 1] * f : x[j] ?? 0;
  }
  return out;
}

/**
 * The running measurement for one song on one device.
 *   setReference(stem8k)          the instrumental stem at 8 kHz, song time 0 = its first sample
 *   pushAudio(x16, posEnd)        the mic's newest samples at 16 kHz; posEnd = the capture clock (s) at their end
 *   pushStamps(pos[], stamp[])    where windows ended on the capture clock and the song time they were stamped at
 *   step()                        correlates every chunk that is ready; returns the current estimate or null
 * Chunks whose stamps jump (a seek) or that have no stem under them are skipped.
 */
export function createBleedEstimator({ memory = 'window', window = 8, decay = 0.85, resetOnJump = true } = {}) {
  const decimate = createDecimator();
  const recent = [];                            // the summed chunks' curves (memory 'window')
  let lastM = null;                             // the previous chunk's song-minus-capture clock offset
  const clear = () => { acc.fill(0); recent.length = 0; chunks = 0; estimate = null; };
  const RING = 24 * RATE;                       // the newest 24 s of mic at 8 kHz
  const ring = new Float32Array(RING);
  let origin = null;                            // capture clock (s) of 8 kHz sample 0
  let written = 0;                              // 8 kHz samples written since the start
  let lastPos = null;                           // capture clock (s) of the newest sample
  const stamps = [];                            // [pos, stamp - pos], in arrival order
  let ref = null;
  let nextStart = null;                         // capture clock (s) where the next chunk starts
  const acc = new Float64Array(LMAX + 1);
  let chunks = 0;
  let estimate = null;

  const mapping = (p0, p1) => {
    const m = [];
    for (const [p, d] of stamps) if (p >= p0 && p <= p1) m.push(d);
    if (m.length < 20) return null;
    m.sort((a, b) => a - b);
    const q = (f) => m[Math.min(m.length - 1, Math.floor(f * m.length))];
    if (q(0.9) - q(0.1) > 0.05) return null;     // the stamps jumped inside the chunk (a seek)
    return q(0.5);
  };

  return {
    setReference(stem8k) { ref = stem8k; },
    pushAudio(x16, posEnd) {
      // Samples go where the capture clock puts them: the hop after a resume
      // follows a 30 ms the mic never sent as new audio, and that gap must not
      // slide everything after it. The filter's own delay is taken off too.
      const y = decimate(x16);
      const end = posEnd - FILTER_DELAY;
      if (origin === null) { origin = end - y.length / RATE; nextStart = origin; }
      const endIdx = Math.round((end - origin) * RATE);
      let startIdx = endIdx - y.length, from = 0;
      if (startIdx < written) { from = written - startIdx; startIdx = written; }
      for (let i = Math.max(written, startIdx - RING); i < startIdx; i++) ring[i % RING] = 0;
      for (let i = from; i < y.length; i++) ring[(startIdx + i - from) % RING] = y[i];
      written = Math.max(written, endIdx);
      lastPos = end;
    },
    pushStamps(pos, stamp) {
      for (let i = 0; i < pos.length; i++) stamps.push([pos[i], stamp[i] - pos[i]]);
      // stamps older than the ring are no use
      if (lastPos !== null) while (stamps.length && stamps[0][0] < lastPos - RING / RATE - 1) stamps.shift();
    },
    step() {
      if (!ref || lastPos === null) return estimate;
      while (nextStart !== null && nextStart + CHUNK_S + 0.5 <= lastPos) {
        const p0 = nextStart;
        nextStart += STEP_S;
        const startIdx = Math.round((p0 - origin) * RATE);
        if (startIdx < written - RING || startIdx < 0 || startIdx + CHUNK_S * RATE > written) continue; // out of the ring
        const m = mapping(p0, p0 + CHUNK_S);
        if (m === null) continue;
        // The song clock moved against the capture clock (a seek, a resync):
        // the sound path may have changed with it, so what was summed so far is dropped
        if (resetOnJump && lastM !== null && Math.abs(m - lastM) > JUMP) clear();
        lastM = m;
        const s0 = p0 + m;                                        // song time of the chunk's first sample
        const r0 = Math.round((s0 - D_MAX) * RATE);
        const rn = Math.round((CHUNK_S + D_MAX - D_MIN) * RATE);
        if (r0 < 0 || r0 + rn > ref.length) continue;
        const mic = new Float32Array(CHUNK_S * RATE);
        let energy = 0;
        for (let i = 0; i < mic.length; i++) { mic[i] = ring[(startIdx + i) % RING]; energy += mic[i] * mic[i]; }
        if (energy < 1e-6) continue;                              // a muted mic
        const c = Float64Array.from(gccChunk(mic, ref.subarray(r0, r0 + rn)));
        if (memory === 'decay') for (let l = 0; l <= LMAX; l++) acc[l] = acc[l] * decay + c[l];
        else for (let l = 0; l <= LMAX; l++) acc[l] += c[l];
        if (memory === 'window') {
          recent.push(c);
          if (recent.length > window) { const old = recent.shift(); for (let l = 0; l <= LMAX; l++) acc[l] -= old[l]; }
        }
        chunks++;
        const pk = peakOf(acc);
        // a peak on the search's edge is the edge, not a delay
        const inside = pk.delay > D_MIN + EDGE && pk.delay < D_MAX - EDGE;
        estimate = { delay: pk.delay + DETECTOR_LAG, measured: pk.delay, z: pk.z, chunks,
          confident: chunks >= 2 && inside && pk.z >= Z_MIN };
      }
      return estimate;
    },
    get chunks() { return chunks; },
  };
}

/**
 * What to take off each note: a fixed delay until the bleed is sure, then the
 * bleed's, gliding at most `maxStep` per note so a change never makes the
 * notes jump. A sure value is kept until a new sure one replaces it.
 */
export function createDelayPolicy({ fallback = 0.14, maxStep = 0.001 } = {}) {
  let target = fallback, applied = fallback, source = 'fixed', lastEstimate = null;
  return {
    update(estimate) {
      lastEstimate = estimate;
      if (estimate?.confident) { target = estimate.delay; source = 'bleed'; }
    },
    /** The delay for the next note (s). */
    next() {
      const d = target - applied;
      applied += Math.max(-maxStep, Math.min(maxStep, d));
      return applied;
    },
    state() { return { applied, target, source, z: lastEstimate?.z ?? null, chunks: lastEstimate?.chunks ?? 0 }; },
  };
}
