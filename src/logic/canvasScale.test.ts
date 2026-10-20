import { describe, it, expect } from 'vitest';
import { layerScale } from './canvasScale';

describe('layerScale', () => {
  it('is the device pixel ratio where the canvas fits', () => {
    expect(layerScale({ dpr: 2.625, cssWidth: 412, cssHeight: 200, maxSize: 4096 })).toBe(2.625); // a phone
    expect(layerScale({ dpr: 1, cssWidth: 1248, cssHeight: 200, maxSize: 16384 })).toBe(1); // a desktop
  });

  it('keeps the canvas within the GPU texture limit', () => {
    // the Fire TV stick: ratio 4, 1248 CSS px, limit 4096 — 4992 px were never shown
    const scale = layerScale({ dpr: 4, cssWidth: 1248, cssHeight: 200, maxSize: 4096 });
    expect(Math.round(1248 * scale)).toBeLessThanOrEqual(4096);
    expect(Math.round(1248 * scale)).toBeGreaterThan(4090);
  });

  it('follows the governor cap, but never below one pixel per CSS pixel', () => {
    expect(layerScale({ dpr: 4, cssWidth: 1248, cssHeight: 200, maxSize: 4096, cap: 1.5 })).toBe(1.5);
    expect(layerScale({ dpr: 2.625, cssWidth: 412, cssHeight: 200, maxSize: 4096, cap: 2 })).toBe(2);
    expect(layerScale({ dpr: 3, cssWidth: 412, cssHeight: 200, maxSize: 4096, cap: 0.5 })).toBe(1);
    expect(layerScale({ dpr: 1, cssWidth: 1248, cssHeight: 200, maxSize: 4096, cap: 1.5 })).toBe(1); // never up
  });
});
