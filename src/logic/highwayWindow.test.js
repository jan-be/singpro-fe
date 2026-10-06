import { describe, it, expect } from 'vitest';
import { LEAD_IN_SHARE, LONG_BREAK_SEC, COUNTDOWN_SEC, previousLineEnd, highwayWindow, countdown, cursorAlpha } from './highwayWindow.js';

const brk = start => ({ isBreak: true, start, length: 0 });
const note = (start, length) => ({ isBreak: false, start, length, tone: 0 });
const line = (...notes) => [brk(0), ...notes];
const TPS = 10; // ticks per second
const S = LEAD_IN_SHARE;
const share = w => (w.firstTick - w.startTick) / (w.endTick - w.startTick); // where the first note sits

describe('highwayWindow', () => {
  it('puts the first note the same share of the width in, on a short line and a long one', () => {
    const short = highwayWindow([{ line: line(note(100, 20), note(130, 14)), prevEnd: 20 }], { minLength: 30 });
    const long = highwayWindow([{ line: line(note(100, 200), note(330, 110)), prevEnd: 20 }], { minLength: 30 });
    expect(share(short)).toBeCloseTo(S);
    expect(share(long)).toBeCloseTo(S);
    // the notes fill the rest: the last one ends at the right edge
    expect(short.endTick).toBe(144);
    expect(long.endTick).toBe(440);
    expect(long.leadTicks).toBeCloseTo(340 * S / (1 - S)); // the run-up grows with the line, in ticks
  });

  it('gives a line sung right after another only the pause it has, and none when they touch or overlap', () => {
    const l = line(note(100, 60));
    const at = prevEnd => highwayWindow([{ line: l, prevEnd }], { minLength: 30 });
    expect(at(98)).toMatchObject({ startTick: 98, endTick: 160, leadTicks: 2 });
    expect(at(100)).toMatchObject({ startTick: 100, endTick: 160, leadTicks: 0 });
    expect(at(104).startTick).toBe(100);
  });

  it('runs up through the intro on the first line, even from a first note at tick 0', () => {
    const w = highwayWindow([{ line: line(note(0, 40)), prevEnd: previousLineEnd([line(note(0, 40))], 0) }], { minLength: 30 });
    expect(w.startTick).toBeLessThan(0);
    expect(share(w)).toBeCloseTo(S);
  });

  it('widens a line shorter than the minimum on the right, so its first note is where the others are', () => {
    const l = line(note(100, 5));
    const w = highwayWindow([{ line: l, prevEnd: -Infinity }], { minLength: 50 });
    expect(w).toMatchObject({ startTick: 100 - 50 * S, endTick: 100 - 50 * S + 50 });
    // after a short pause: the pause, and the rest of the minimum on the right
    expect(highwayWindow([{ line: l, prevEnd: 97 }], { minLength: 50 })).toMatchObject({ startTick: 97, endTick: 147 });
    // no minimum (a song of two lines): the line as it is, plus its run-up
    expect(share(highwayWindow([{ line: l, prevEnd: -Infinity }], { minLength: null }))).toBeCloseTo(S);
  });

  it('spans both parts of a duet and runs up to whichever sings first, from when both have moved on', () => {
    const w = highwayWindow([
      { line: line(note(100, 40)), prevEnd: 50 },
      { line: line(note(110, 60)), prevEnd: 99 },
    ], { minLength: 30 });
    expect(w).toEqual({ startTick: 99, endTick: 170, firstTick: 100, leadTicks: 1, prevEnd: 99 });
  });

  it('never starts before the line before ended, never cuts a note off, never falls short of the minimum, never puts the first note past its share', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2000; i++) {
      const first = Math.floor(rand() * 400);
      const notes = [note(first, 1 + Math.floor(rand() * 30))];
      while (rand() < 0.7) { const p = notes[notes.length - 1]; notes.push(note(p.start + p.length + Math.floor(rand() * 10), 1 + Math.floor(rand() * 20))); }
      const prevEnd = rand() < 0.2 ? -Infinity : first - Math.floor(rand() * 60);
      const minLength = rand() < 0.1 ? null : Math.floor(rand() * 120);
      const last = notes[notes.length - 1].start + notes[notes.length - 1].length;
      const w = highwayWindow([{ line: line(...notes), prevEnd }], { minLength });
      expect(w.startTick).toBeGreaterThanOrEqual(Math.min(first, prevEnd) - 1e-9);
      expect(w.startTick).toBeLessThanOrEqual(first);
      expect(w.endTick).toBeGreaterThanOrEqual(last - 1e-9);
      expect(w.endTick - w.startTick).toBeGreaterThanOrEqual((minLength ?? 0) - 1e-9);
      expect(share(w)).toBeLessThanOrEqual(S + 1e-9);
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

describe('countdown', () => {
  const longBreak = { firstTick: 500, prevEnd: 500 - LONG_BREAK_SEC * TPS, ticksPerSec: TPS };

  it('counts down the last 3 s to a line after a break of 10 s or more', () => {
    expect(countdown(500 - (COUNTDOWN_SEC + 0.1) * TPS, longBreak)).toBeNull();
    expect(countdown(500 - 3 * TPS, longBreak)).toMatchObject({ left: 3, share: 1, digit: 3, alpha: 0 });
    expect(countdown(500 - 2.5 * TPS, longBreak)).toMatchObject({ digit: 3, alpha: 1 });
    expect(countdown(500 - 1.5 * TPS, longBreak)).toMatchObject({ share: 0.5, digit: 2, alpha: 1 });
    expect(countdown(500 - 0.5 * TPS, longBreak)).toMatchObject({ digit: 1, alpha: 1 });
    expect(countdown(500 - 0.1 * TPS, longBreak).alpha).toBe(0.4); // fading out as it empties
    expect(countdown(500, longBreak)).toBeNull(); // the first note: gone
    expect(countdown(520, longBreak)).toBeNull();
  });

  it('is not there between ordinary lines', () => {
    expect(countdown(490, { ...longBreak, prevEnd: 500 - 9.9 * TPS })).toBeNull();
  });

  it('counts the intro as the break: from the song start before the first line', () => {
    const intro = { firstTick: 0, prevEnd: -Infinity, ticksPerSec: TPS };
    expect(countdown(-2 * TPS, { ...intro, songStartTick: -43 * TPS })).toMatchObject({ digit: 2 });
    expect(countdown(-2 * TPS, { ...intro, songStartTick: -8 * TPS })).toBeNull(); // an 8 s intro
  });
});

describe('cursorAlpha', () => {
  it('brightens from 0.35 to 0.6 over its run-up to the first note, and stays at 0.6 from it on', () => {
    expect(cursorAlpha(100 - 30, 100, 10)).toBe(0.35);
    expect(cursorAlpha(100 - 10, 100, 10)).toBe(0.35);
    expect(cursorAlpha(100 - 2, 100, 10)).toBe(0.55);
    expect(cursorAlpha(100, 100, 10)).toBe(0.6);
    expect(cursorAlpha(140, 100, 10)).toBe(0.6);
    expect(cursorAlpha(90, 100, 0)).toBe(0.6); // no run-up (a line straight after another)
  });
});
