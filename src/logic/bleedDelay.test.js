import { describe, it, expect } from 'vitest';
import { fft, gccChunk, peakOf, createBleedEstimator, createDelayPolicy, RATE, D_MAX, CHUNK_S, DETECTOR_LAG } from './bleedDelay';

// Band-limited noise at 8 kHz (smooth enough that linear interpolation reads it at any time)
function music(seconds, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const n = Math.round(seconds * RATE);
  const raw = Float32Array.from({ length: n }, rnd);
  const out = new Float32Array(n);
  const taps = 9;                                 // a gentle low-pass, ~1.5 kHz
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (let j = 0; j < taps; j++) a += raw[Math.max(0, i - j)];
    out[i] = a / taps;
  }
  return out;
}
const at = (x, t) => {                            // x (8 kHz) at time t, 0 outside
  const p = t * RATE, j = Math.floor(p), f = p - j;
  if (j < 0 || j + 1 >= x.length) return 0;
  return x[j] * (1 - f) + x[j + 1] * f;
};

/**
 * Feeds an estimator the way the app does: 30 ms hops of 16 kHz mic audio with
 * the capture clock, and the stamps of the windows. The mic hears the song at
 * song time = stamp - delay; stamp = capture clock + offset(capture clock).
 */
function feed(est, ref, { seconds, delay, offset = () => 5, gapsAt = [], noise = 0 }) {
  const HOP = 480;
  let captured = 0;                               // capture clock (s)
  let i = 0;
  let estimate = null;
  while (captured < seconds) {
    if (gapsAt.some(g => Math.abs(g - captured) < 0.015)) captured += 0.03; // a resume: the mic skips a hop
    const hop = new Float32Array(HOP);
    for (let k = 0; k < HOP; k++) {
      const p = captured + (k + 1) / 16000;
      hop[k] = at(ref, p + offset(p) - delay) + noise * (Math.sin(p * 9311) * Math.cos(p * 7177));
    }
    captured += HOP / 16000;
    est.pushAudio(hop, captured);
    est.pushStamps([captured], [captured + offset(captured)]);
    if (++i % 33 === 0) estimate = est.step();
  }
  return est.step() ?? estimate;
}

describe('fft', () => {
  it('inverts', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + i % 3);
    const im = new Float64Array(64);
    const orig = Float64Array.from(re);
    fft(re, im); fft(re, im, true);
    for (let i = 0; i < 64; i++) expect(re[i] / 64).toBeCloseTo(orig[i], 9);
  });
});

describe('gccChunk / peakOf', () => {
  it('finds the lag of the stem in the mic', () => {
    const ref = music(CHUNK_S + 2);
    const d = 0.173;
    const seg = ref.subarray(0, Math.round((CHUNK_S + 0.8) * RATE)); // stem from s0 - D_MAX
    const mic = Float32Array.from({ length: CHUNK_S * RATE }, (_, i) => at(ref, i / RATE + D_MAX - d));
    const { delay, z } = peakOf(Float64Array.from(gccChunk(mic, seg)));
    expect(delay).toBeCloseTo(d, 3);
    expect(z).toBeGreaterThan(20);
  });
});

describe('createBleedEstimator', () => {
  it('measures the delay on the stamp clock, plus the detector lag', () => {
    const ref = music(60);
    const est = createBleedEstimator();
    est.setReference(ref);
    const e = feed(est, ref, { seconds: 40, delay: 0.21 });
    expect(e.confident).toBe(true);
    expect(e.measured).toBeCloseTo(0.21, 2);
    expect(e.delay).toBeCloseTo(0.21 + DETECTOR_LAG, 2);
  });

  it('keeps its place across the hop a resume skips', () => {
    const ref = music(60, 7);
    const est = createBleedEstimator();
    est.setReference(ref);
    const e = feed(est, ref, { seconds: 40, delay: 0.12, gapsAt: [6.03, 12.06, 18.09, 24.12, 30.15] });
    expect(e.confident).toBe(true);
    expect(Math.abs(e.measured - 0.12)).toBeLessThan(0.003);
  });

  it('starts over after a seek, so the new sound path wins', () => {
    const ref = music(90, 3);
    const est = createBleedEstimator();
    est.setReference(ref);
    // the song jumps 20 s ahead at 30 s on the capture clock, and the delay changes with it
    const offset = (p) => (p < 30 ? 2 : 22);
    let delay = 0.05;
    const HOP = 480;
    let captured = 0, e = null, i = 0;
    while (captured < 60) {
      if (captured >= 30) delay = 0.18;
      const hop = new Float32Array(HOP);
      for (let k = 0; k < HOP; k++) { const p = captured + (k + 1) / 16000; hop[k] = at(ref, p + offset(p) - delay); }
      captured += HOP / 16000;
      est.pushAudio(hop, captured);
      est.pushStamps([captured], [captured + offset(captured)]);
      if (++i % 33 === 0) e = est.step() ?? e;
    }
    expect(e.confident).toBe(true);
    expect(e.measured).toBeCloseTo(0.18, 2);
  });

  it('is not sure of a mic that does not hear the stem', () => {
    const ref = music(60, 5), other = music(60, 9);
    const est = createBleedEstimator();
    est.setReference(ref);
    const e = feed(est, other, { seconds: 40, delay: 0.1 });
    expect(e.confident).toBe(false);
  });

  it('measures nothing without a stem', () => {
    const est = createBleedEstimator();
    const e = feed(est, music(30), { seconds: 20, delay: 0.1 });
    expect(e).toBeNull();
  });
});

describe('createDelayPolicy', () => {
  it('starts at the fallback and glides to a sure measurement', () => {
    const p = createDelayPolicy({ fallback: 0.14, maxStep: 0.001 });
    expect(p.next()).toBeCloseTo(0.14, 9);
    p.update({ confident: false, delay: 0.3 });
    expect(p.next()).toBeCloseTo(0.14, 9);
    p.update({ confident: true, delay: 0.17, z: 9, chunks: 3 });
    let d = 0;
    for (let i = 0; i < 10; i++) d = p.next();
    expect(d).toBeCloseTo(0.15, 6);
    for (let i = 0; i < 100; i++) d = p.next();
    expect(d).toBeCloseTo(0.17, 6);
    expect(p.state().source).toBe('bleed');
    // an unsure update keeps the last sure value
    p.update({ confident: false, delay: 0.4 });
    expect(p.next()).toBeCloseTo(0.17, 6);
  });
});
