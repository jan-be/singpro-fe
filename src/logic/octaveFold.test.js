import { describe, it, expect } from 'vitest';
import { chooseOctaveShift, shiftToward } from './octaveFold.js';

/** Fold a chronological list of raw notes the way MusicBars does. */
const fold = (notes, { expectedTone, midTone }) => {
  let prev = null;
  return notes.map(([videoTime, raw]) => {
    const shift = chooseOctaveShift({ raw, videoTime, expectedTone, midTone, prev });
    prev = { raw, videoTime, shift };
    return raw + shift;
  });
};

describe('shiftToward', () => {
  it('folds to the octave nearest the target', () => {
    expect(shiftToward(27, 8)).toBe(-24);   // 27 → 3 (nearest to 8; 15 would be further)
    expect(shiftToward(20, 8)).toBe(-12);   // 20 → 8
    expect(shiftToward(8, 8)).toBe(0);
    expect(shiftToward(2, 20)).toBe(24);
  });
});

describe('chooseOctaveShift', () => {
  it('a held note wobbling around the fold boundary does not flip octaves', () => {
    // midTone 8: raw 26.0 is exactly 18 st away → nearest-octave folding flips
    // between 2 and 14 as the pitch wobbles around 26. With hysteresis it stays put.
    const wobble = [25.9, 26.1, 25.8, 26.2, 26.0, 25.7].map((raw, i) => [i * 0.06, raw]);
    const shown = fold(wobble, { midTone: 8 });
    const octaves = new Set(shown.map(s => Math.round((s - wobble[0][1]) / 12)));
    expect(octaves.size).toBe(1);
  });

  it('folds toward the note being sung rather than the line midpoint', () => {
    // Singer an octave below a high note: shown right on the target, not 6 st away from it
    expect(fold([[0, 20]], { expectedTone: 32, midTone: 24 })[0]).toBe(32);
    expect(fold([[0, 20]], { midTone: 24 })[0]).toBe(20);
  });

  it('keeps the shift across a short gap in the same register', () => {
    const shown = fold([[0, 26], [0.5, 26.5], [1.8, 26.2]], { midTone: 8 });
    expect(shown[2] - shown[0]).toBeCloseTo(0.2, 5);
  });

  it('re-decides after a long gap or a register change', () => {
    // Long gap → fresh decision toward the target
    expect(fold([[0, 26], [3, 26]], { expectedTone: 26, midTone: 8 })[1]).toBe(26);
    // Register change (an octave down) → folded again toward the target
    const shown = fold([[0, 26], [0.1, 14]], { expectedTone: 14, midTone: 8 });
    expect(shown[1]).toBe(14);
  });

  it('a continuous phrase keeps its octave even when the target note jumps', () => {
    // The chart leaps an octave while the singer holds the pitch: the held note
    // must not jump on screen just because the target changed.
    let prev = null;
    const a = chooseOctaveShift({ raw: 20, videoTime: 0, expectedTone: 20, midTone: 20, prev });
    prev = { raw: 20, videoTime: 0, shift: a };
    const b = chooseOctaveShift({ raw: 20.3, videoTime: 0.06, expectedTone: 32, midTone: 20, prev });
    expect(b).toBe(a);
  });
});
