import { describe, it, expect } from 'vitest';
import { buildSegments } from './noteSegments.js';

/** one point per tick, x = tick, y = 100, pitch 20 unless given */
const pt = (tf, extra = {}) => ({ tf, x: tf, y: 100, rawSemitone: 20, isHit: true, isSpecial: false, count: 1, ...extra });

describe('buildSegments', () => {
  it('keeps a held note as one segment', () => {
    const segs = buildSegments([pt(0), pt(1), pt(2), pt(3)]);
    expect(segs).toHaveLength(1);
    expect(segs[0].points).toHaveLength(4);
    expect(segs[0].hitCount).toBe(4);
  });

  it('splits on a pitch jump or a gap', () => {
    const segs = buildSegments([pt(0), pt(1), pt(2, { rawSemitone: 25 }), pt(3, { rawSemitone: 25 }), pt(7, { rawSemitone: 25 })]);
    expect(segs.map(s => s.points.length)).toEqual([2, 2, 1]);
  });

  it('only the part of a sung note inside a golden note is gold', () => {
    // singer starts at tick 0, golden note spans ticks 2-4, singer holds until tick 6
    const points = [0, 1, 2, 3, 4, 5, 6].map(tf => pt(tf, { isSpecial: tf >= 2 && tf <= 4 }));
    const segs = buildSegments(points);
    expect(segs.map(s => s.isSpecial)).toEqual([false, true, false]);
    expect(segs.map(s => [s.startTick, s.endTick])).toEqual([[0, 1], [2, 4], [5, 6]]);
  });

  it('the split segments share their joint so the line stays unbroken', () => {
    const points = [0, 1, 2, 3].map(tf => pt(tf, { isSpecial: tf >= 2, y: 100 + tf }));
    const [plain, gold] = buildSegments(points);
    expect(plain.points[plain.points.length - 1]).toEqual({ x: 1, y: 101 });
    expect(gold.points[0]).toEqual({ x: 1, y: 101 }); // starts where the plain part ended
    expect(gold.points[1]).toEqual({ x: 2, y: 102 });
    expect(gold.hitCount).toBe(2); // the joint is only a drawing point, not a second hit
  });

  it('a segment that starts on a golden note is gold from its first point', () => {
    const segs = buildSegments([pt(0, { isSpecial: true }), pt(1, { isSpecial: true })]);
    expect(segs).toHaveLength(1);
    expect(segs[0].isSpecial).toBe(true);
    expect(segs[0].points).toHaveLength(2);
  });

  it('tracks the widest overlap of a segment', () => {
    const segs = buildSegments([pt(0), pt(1, { count: 3 }), pt(2, { count: 2 })]);
    expect(segs[0].maxOverlap).toBe(3);
  });
});
