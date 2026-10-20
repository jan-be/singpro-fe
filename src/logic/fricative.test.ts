import { describe, it, expect } from 'vitest';
import { createFricativeDetector, FRAME_SAMPLES } from './fricative';

const SR = 48000;

/** A deterministic noise source (xorshift), uniform in [-1, 1). */
const rng = (seed = 1) => () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) / 2 ** 31) - 1;
};

/** `seconds` of signal from gen(n) at 48 kHz. */
const make = (seconds, gen) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, n) => gen(n));
const vowel = (amp = 0.3, hz = 200) => n => amp * (Math.sin(2 * Math.PI * hz * n / SR) + 0.5 * Math.sin(4 * Math.PI * hz * n / SR));
// a hiss: first differences of white noise put most of its energy in the upper half of the spectrum, like an "s"
const hiss = (amp, seed = 7) => { const r = rng(seed); let prev = 0; return () => { const x = r(); const y = amp * (x - prev) / 2; prev = x; return y; }; };
const quietRoom = (seed = 3) => { const r = rng(seed); return () => 0.0005 * r(); };

/** Push the signal in pieces of `step` samples; the flag after every piece. */
const flags = (det, x, step = 480) => {
  const out = [];
  for (let i = 0; i < x.length; i += step) { det.push(x, i, Math.min(x.length, i + step)); out.push(det.flag()); }
  return out;
};
const share = a => a.reduce((s, v) => s + v, 0) / a.length;

describe('createFricativeDetector', () => {
  it('finds a hiss after a quiet room, not a sung vowel', () => {
    const det = createFricativeDetector(SR);
    flags(det, make(0.5, quietRoom()));
    expect(share(flags(det, make(0.15, hiss(0.05))))).toBeGreaterThan(0.8);
    // (the first 30 ms after the hiss still remember it)
    expect(share(flags(det, make(0.5, vowel())).slice(3))).toBe(0);
  });

  it('says nothing in silence or a quiet room', () => {
    const det = createFricativeDetector(SR);
    expect(share(flags(det, make(0.5, () => 0)))).toBe(0);
    expect(share(flags(det, make(1, quietRoom())))).toBe(0);
  });

  it('stops counting a steady hiss once the floor has caught up with it (a fan, an air conditioner)', () => {
    const det = createFricativeDetector(SR);
    flags(det, make(0.5, quietRoom()));
    const f = flags(det, make(6, hiss(0.02)));
    expect(share(f.slice(0, 20))).toBeGreaterThan(0.8);   // the first 200 ms: a consonant as far as it knows
    expect(share(f.slice(-100))).toBe(0);                  // the last second: background
  });

  it('gives the same answer however the input is cut into pieces', () => {
    const x = new Float32Array([...make(0.3, quietRoom()), ...make(0.1, hiss(0.05)), ...make(0.2, vowel())]);
    const a = createFricativeDetector(SR), b = createFricativeDetector(SR);
    const fa = [], fb = [];
    // both report after every full 30 ms; one is fed in odd pieces in between
    for (let i = 0; i + 1440 <= x.length; i += 1440) {
      a.push(x, i, i + 1440); fa.push(a.recentFrames());
      for (let j = i; j < i + 1440; j += 37) b.push(x, j, Math.min(i + 1440, j + 37));
      fb.push(b.recentFrames());
    }
    expect(fb).toEqual(fa);
  });

  it('forgets the recent frames on reset', () => {
    const det = createFricativeDetector(SR);
    flags(det, make(0.3, quietRoom()));
    flags(det, make(0.05, hiss(0.05)));
    expect(det.flag()).toBe(1);
    det.reset();
    expect(det.recentFrames()).toBe(0);
    expect(FRAME_SAMPLES).toBe(128);
  });
});
