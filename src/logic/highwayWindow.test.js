import { describe, it, expect } from 'vitest';
import { LEAD_IN_SEC, previousLineEnd, highwayWindow, cursorAlpha } from './highwayWindow.js';

const brk = start => ({ isBreak: true, start, length: 0 });
const note = (start, length) => ({ isBreak: false, start, length, tone: 0 });
const line = (...notes) => [brk(0), ...notes];
const TPS = 10; // ticks per second: the full run-up is 15 ticks
const LEAD = LEAD_IN_SEC * TPS;

describe('highwayWindow', () => {
  it('starts 1.5 s before the first note after a long pause, so the cursor runs in from the left edge', () => {
    const w = highwayWindow([{ line: line(note(100, 20), note(130, 30)), prevEnd: 20 }], { minLength: 30, ticksPerSec: TPS });
    expect(w).toEqual({ startTick: 100 - LEAD, endTick: 160, firstTick: 100 });
  });

  it('gives a line sung right after another only the pause it has, and none when they touch or overlap', () => {
    const l = line(note(100, 60));
    const at = prevEnd => highwayWindow([{ line: l, prevEnd }], { minLength: 30, ticksPerSec: TPS }).startTick;
    expect(at(95)).toBe(95);
    expect(at(100)).toBe(100);
    expect(at(104)).toBe(100);
  });

  it('runs up through the intro on the first line, even from a first note at tick 0', () => {
    const w = highwayWindow([{ line: line(note(0, 40)), prevEnd: previousLineEnd([line(note(0, 40))], 0) }], { minLength: 30, ticksPerSec: TPS });
    expect(w.startTick).toBe(-LEAD);
  });

  it('keeps the run-up to a third of the width', () => {
    const w = highwayWindow([{ line: line(note(100, 20)), prevEnd: -Infinity }], { minLength: 10, ticksPerSec: TPS });
    expect(w).toMatchObject({ startTick: 90, endTick: 120 });
  });

  it('widens a short line to the minimum with the run-up counted in, on the left only as far as the pause allows', () => {
    const l = line(note(100, 5));
    const long = highwayWindow([{ line: l, prevEnd: -Infinity }], { minLength: 30, ticksPerSec: TPS });
    expect(long).toMatchObject({ startTick: 80, endTick: 110 }); // 15 of run-up, then 10 more, half each side
    const tight = highwayWindow([{ line: l, prevEnd: 97 }], { minLength: 30, ticksPerSec: TPS });
    expect(tight).toMatchObject({ startTick: 97, endTick: 127 });
    // no minimum (a song of two lines): the line as it is, plus its run-up
    expect(highwayWindow([{ line: l, prevEnd: -Infinity }], { minLength: null, ticksPerSec: TPS })).toMatchObject({ startTick: 97.5, endTick: 105 });
  });

  it('spans both parts of a duet and runs up to whichever sings first, from when both have moved on', () => {
    const w = highwayWindow([
      { line: line(note(100, 40)), prevEnd: 50 },
      { line: line(note(110, 60)), prevEnd: 90 },
    ], { minLength: 30, ticksPerSec: TPS });
    expect(w).toEqual({ startTick: 90, endTick: 170, firstTick: 100 });
  });

  it('never starts before the line before ended, never cuts a note off and never falls short of the minimum', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2000; i++) {
      const first = Math.floor(rand() * 400);
      const notes = [note(first, 1 + Math.floor(rand() * 30))];
      while (rand() < 0.7) { const p = notes[notes.length - 1]; notes.push(note(p.start + p.length + Math.floor(rand() * 10), 1 + Math.floor(rand() * 20))); }
      const prevEnd = rand() < 0.2 ? -Infinity : first - Math.floor(rand() * 60);
      const minLength = rand() < 0.1 ? null : Math.floor(rand() * 120);
      const last = notes[notes.length - 1].start + notes[notes.length - 1].length;
      const w = highwayWindow([{ line: line(...notes), prevEnd }], { minLength, ticksPerSec: 2 + rand() * 20 });
      expect(w.startTick).toBeGreaterThanOrEqual(Math.min(first, prevEnd) - 1e-9);
      expect(w.startTick).toBeLessThanOrEqual(first);
      expect(w.endTick).toBeGreaterThanOrEqual(last);
      expect(w.endTick - w.startTick).toBeGreaterThanOrEqual((minLength ?? 0) - 1e-9);
    }
  });
});

describe('previousLineEnd', () => {
  it('is where the last note before the line ends, past lines of a break alone', () => {
    const lines = [line(note(0, 4)), [brk(5)], [brk(8), note(10, 2)]];
    expect(previousLineEnd(lines, 0)).toBe(-Infinity);
    expect(previousLineEnd(lines, 1)).toBe(4);
    expect(previousLineEnd(lines, 2)).toBe(4);
    expect(previousLineEnd(lines, 3)).toBe(12);
  });
});

describe('cursorAlpha', () => {
  it('brightens from 0.35 to 0.6 over the 1.5 s before the first note, and stays at 0.6 from it on', () => {
    expect(cursorAlpha(100 - 3 * LEAD, 100, TPS)).toBe(0.35);
    expect(cursorAlpha(100 - LEAD, 100, TPS)).toBe(0.35);
    expect(cursorAlpha(100 - LEAD / 5, 100, TPS)).toBe(0.55);
    expect(cursorAlpha(100, 100, TPS)).toBe(0.6);
    expect(cursorAlpha(140, 100, TPS)).toBe(0.6);
  });
});
