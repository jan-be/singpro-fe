import { describe, it, expect } from 'vitest';
import { clampOffset, cropRect, placement, rezoom, viewScale, MAX_ZOOM } from './avatarImage.js';

const landscape = { width: 1200, height: 800, view: 240 };

describe('avatar editor arithmetic', () => {
  it('zoom 1: the short side fills the view, the picture centred', () => {
    expect(viewScale({ ...landscape, zoom: 1 })).toBeCloseTo(0.3);
    const p = placement({ ...landscape, zoom: 1, dx: 0, dy: 0 });
    expect(p.top).toBeCloseTo(0);
    expect(p.left).toBeCloseTo(-60); // 1200 * 0.3 = 360 wide in a 240 view
    expect(cropRect({ ...landscape, zoom: 1, dx: 0, dy: 0 })).toEqual({ sx: 200, sy: 0, size: 800 });
  });

  it('the picture cannot be dragged off the view', () => {
    expect(clampOffset({ ...landscape, zoom: 1, dx: 500, dy: 30 })).toEqual({ dx: 60, dy: 0 });
    expect(clampOffset({ ...landscape, zoom: 1, dx: -500, dy: -30 })).toEqual({ dx: -60, dy: 0 });
    // dragged right as far as it goes: the crop starts at the picture's left edge
    expect(cropRect({ ...landscape, zoom: 1, dx: 60, dy: 0 }).sx).toBeCloseTo(0);
    expect(cropRect({ ...landscape, zoom: 1, dx: -60, dy: 0 }).sx).toBeCloseTo(400);
  });

  it('zoomed in, the crop is smaller and follows the drag', () => {
    const r = cropRect({ ...landscape, zoom: 2, dx: 0, dy: 0 });
    expect(r.size).toBeCloseTo(400);
    expect(r.sx).toBeCloseTo(400);
    expect(r.sy).toBeCloseTo(200);
    const up = cropRect({ ...landscape, zoom: 2, dx: 0, dy: 120 }); // picture moved down: we see more of its top
    expect(up.sy).toBeCloseTo(0);
  });

  it('rezoom keeps the same spot in the middle and stays within bounds', () => {
    const p = { ...landscape, zoom: 2, dx: 40, dy: 20 };
    const before = cropRect(p);
    const z = rezoom(p, 3);
    const after = cropRect({ ...p, ...z });
    expect(after.sx + after.size / 2).toBeCloseTo(before.sx + before.size / 2);
    expect(after.sy + after.size / 2).toBeCloseTo(before.sy + before.size / 2);
    expect(rezoom(p, 99).zoom).toBe(MAX_ZOOM);
    const out = rezoom(p, 0.2);
    expect(out.zoom).toBe(1);
    expect(Math.abs(out.dy)).toBeLessThanOrEqual(0);
  });

  it('a square picture at zoom 1 is cut whole', () => {
    expect(cropRect({ width: 256, height: 256, view: 200, zoom: 1, dx: 0, dy: 0 })).toEqual({ sx: 0, sy: 0, size: 256 });
  });
});
