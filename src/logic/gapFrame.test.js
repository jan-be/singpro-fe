import { describe, it, expect } from 'vitest';
import { carryGap } from './gapFrame.js';

describe('carryGap', () => {
  it('keeps the distance from the base when the base changes', () => {
    // The solo chart plays at 22010 (1670 + a 20.34 s video offset), dragged 300 ms later;
    // the duet twin's own base is 5000: it gets the same 300 ms on top
    expect(carryGap(22310, 22010, 5000)).toBe(5300);
    expect(carryGap(5300, 5000, 22010)).toBe(22310);
  });

  it('is the identity when both charts share a base', () => {
    expect(carryGap(1500, 1260, 1260)).toBe(1500);
  });

  it('falls back to the new base without a usable gap or old base, and keeps the gap without a new base', () => {
    expect(carryGap(NaN, 1000, 2000)).toBe(2000);
    expect(carryGap(1500, undefined, 2000)).toBe(2000);
    expect(carryGap(1500, 1000, null)).toBe(1500);
  });
});
