import { describe, it, expect } from 'vitest';
import { createFrameGovernor } from './frameGovernor';

// Feed `ms` worth of frames `interval` apart; returns what frame() said for each.
const run = (g, clock, interval, ms) => {
  const out = [];
  for (let t = 0; t < ms; t += interval) {
    clock.now += interval;
    out.push(g.frame(clock.now));
  }
  return out;
};

// Feed frames until `done()`; returns how long that took (ms), or Infinity.
const until = (g, clock, interval, done, maxMs) => {
  for (let t = interval; t <= maxMs; t += interval) {
    clock.now += interval;
    g.frame(clock.now);
    if (done()) return t;
  }
  return Infinity;
};

describe('createFrameGovernor', () => {
  it('paints every frame while the page keeps up', () => {
    const g = createFrameGovernor();
    const clock = { now: 0 };
    const steps = run(g, clock, 1000 / 60, 10000);
    expect(steps.every(s => s === 1)).toBe(true);
    expect(g.divisor).toBe(1);
  });

  it('leaves a fast display alone that runs the page at 60', () => {
    const g = createFrameGovernor();
    const clock = { now: 0 };
    run(g, clock, 1000 / 120, 500); // a 120 Hz phone, idle
    run(g, clock, 1000 / 60, 10000); // the party page at 60
    expect(g.divisor).toBe(1);
  });

  it('leaves a 50 Hz television at its own rate alone', () => {
    const g = createFrameGovernor();
    const clock = { now: 0 };
    run(g, clock, 20, 10000);
    expect(g.divisor).toBe(1);
  });

  it('paints every 2nd, then every 3rd frame on a starved page, at a steady cadence', () => {
    const g = createFrameGovernor();
    const clock = { now: 0 };
    run(g, clock, 1000 / 60, 500);
    expect(until(g, clock, 50, () => g.divisor === 2, 3000)).toBeLessThan(2100); // 20 fps
    expect(until(g, clock, 50, () => g.divisor === 3, 3000)).toBeLessThan(1100);
    const steps = run(g, clock, 50, 3000);
    expect(g.divisor).toBe(3); // never past the maximum
    const painted = steps.filter(s => s > 0);
    expect(painted.every(s => s === 3)).toBe(true);
    expect(painted.length).toBe(Math.floor(steps.length / 3));
  });

  it('engages on a page down to a frame or two a second', () => {
    const g = createFrameGovernor();
    const clock = { now: 0 };
    run(g, clock, 1000 / 60, 500);
    run(g, clock, 600, 6000);
    expect(g.divisor).toBe(3);
  });

  it('counts the rate, not the median frame: bursts between stalls are overload', () => {
    const g = createFrameGovernor();
    const clock = { now: 0 };
    run(g, clock, 1000 / 60, 500);
    // 5 quick frames then a 200 ms stall, over and over: 25 frames a second
    for (let i = 0; i < 8; i++) {
      run(g, clock, 1000 / 60, 5 * 1000 / 60);
      clock.now += 200;
      g.frame(clock.now);
    }
    expect(g.divisor).toBeGreaterThan(1);
  });

  it('steps back to every frame once there is room again', () => {
    const g = createFrameGovernor({ probationMs: 3000 });
    const clock = { now: 0 };
    run(g, clock, 1000 / 60, 500);
    run(g, clock, 50, 3000);
    expect(g.divisor).toBe(3);
    const toTwo = until(g, clock, 1000 / 60, () => g.divisor === 2, 10000);
    expect(toTwo).toBeGreaterThanOrEqual(3000);
    expect(toTwo).toBeLessThan(5000);
    expect(until(g, clock, 1000 / 60, () => g.divisor === 1, 10000)).toBeLessThan(5000);
  });

  it('undoes a step down that does not hold, and waits longer before the next', () => {
    const g = createFrameGovernor({ maxDivisor: 2, probationMs: 2000 });
    const clock = { now: 0 };
    run(g, clock, 1000 / 60, 500);
    until(g, clock, 50, () => g.divisor === 2, 3000);
    const first = until(g, clock, 1000 / 60, () => g.divisor === 1, 10000); // room at every 2nd frame: try every frame
    expect(first).toBeLessThan(4000);
    expect(until(g, clock, 50, () => g.divisor === 2, 3000)).toBeLessThan(2500); // which starves it again
    const second = until(g, clock, 1000 / 60, () => g.divisor === 1, 20000);
    expect(second).toBeGreaterThan(3900); // twice the probation
    expect(second).toBeLessThan(6000);
  });

  it('does not take a background tab or a pause for overload', () => {
    const g = createFrameGovernor();
    const clock = { now: 0 };
    run(g, clock, 1000 / 60, 500);
    clock.now += 5000; // hidden: no frames
    expect(g.frame(clock.now)).toBe(1);
    run(g, clock, 1000 / 60, 3000);
    expect(g.divisor).toBe(1);
  });

  it('walks custom levels: fewer pixels first, then fewer frames', () => {
    const levels = [{ divisor: 1 }, { divisor: 1, scale: 2 }, { divisor: 1, scale: 1.5 }, { divisor: 2, scale: 1.5 }];
    const g = createFrameGovernor({ levels });
    const clock = { now: 0 };
    run(g, clock, 1000 / 60, 500);
    expect(g.scale).toBe(Infinity);
    expect(until(g, clock, 50, () => g.level === 1, 3000)).toBeLessThan(2100);
    expect(g.scale).toBe(2);
    expect(g.divisor).toBe(1); // still every frame
    expect(until(g, clock, 50, () => g.level === 3, 3000)).toBeLessThan(2100);
    expect(g.scale).toBe(1.5);
    expect(g.divisor).toBe(2);
    // room again: back up the levels one probe at a time
    expect(until(g, clock, 1000 / 60, () => g.level === 0, 60000)).toBeLessThan(60000);
    expect(g.scale).toBe(Infinity);
  });

  it('counts frames a busy worker could not take as not shown', () => {
    const g = createFrameGovernor({ levels: [{ divisor: 1 }, { divisor: 1, scale: 1.5 }] });
    const clock = { now: 0 };
    // the page runs at 60, but the worker manages every other frame
    for (let i = 0; i < 180; i++) {
      clock.now += 1000 / 60;
      g.frame(clock.now);
      if (i % 2) g.dropped();
    }
    expect(g.level).toBe(1);
    // and a worker that keeps up leaves it alone
    const h = createFrameGovernor({ levels: [{ divisor: 1 }, { divisor: 1, scale: 1.5 }] });
    run(h, { now: 0 }, 1000 / 60, 3000);
    expect(h.level).toBe(0);
  });
});
