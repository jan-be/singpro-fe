import { describe, it, expect } from 'vitest';
import { songRegions, frameSeconds, formatTime } from './songRegions.js';

const brk = start => ({ isBreak: true, start, length: 0 });
const note = (start, length) => ({ isBreak: false, start, length, tone: 0 });
// bpm 120 → 2 ticks per second; gap 1000 ms
const data = (lines, p2) => ({ bpm: 120, gap: 1000, lyricLines: lines, ...(p2 ? { p2: { lyricLines: p2 } } : {}) });

describe('songRegions', () => {
  it('turns lyric lines into sung regions in seconds of video time', () => {
    const regions = songRegions(data([[brk(0)], [brk(0), note(0, 2), note(2, 2)], [brk(4), note(20, 4)]]));
    expect(regions).toEqual([
      { start: 1, end: 3, player: 1 },     // ticks 0–4 → 1 s + 0..2 s
      { start: 11, end: 13, player: 1 },   // ticks 20–24
    ]);
  });

  it('merges lines that follow each other closely', () => {
    const regions = songRegions(data([[brk(0), note(0, 2)], [brk(2), note(3, 2)], [brk(5), note(10, 2)]]));
    expect(regions).toEqual([{ start: 1, end: 3.5, player: 1 }, { start: 6, end: 7, player: 1 }]);
  });

  it('adds the second singer with its own colour tag, sorted by time', () => {
    const regions = songRegions(data([[brk(0), note(0, 2)]], [[brk(0), note(1, 2)], [brk(0), note(10, 2)]]));
    expect(regions).toEqual([
      { start: 1, end: 2, player: 1 },
      { start: 1.5, end: 2.5, player: 2 },
      { start: 6, end: 7, player: 2 },
    ]);
  });

  it('is empty without data', () => {
    expect(songRegions(null)).toEqual([]);
    expect(songRegions({})).toEqual([]);
  });
});

describe('frameSeconds / formatTime', () => {
  it('converts the frame tick into seconds', () => {
    expect(frameSeconds({ lyricData: { bpm: 120, gap: 1000 }, tickFloat: 4 })).toBe(3);
    expect(frameSeconds({})).toBe(0);
  });
  it('formats m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.7)).toBe('1:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});
