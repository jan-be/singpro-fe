import { describe, test, expect } from 'vitest';
import { startAtFromSearch, searchWithoutStartAt, startPoint, resumeTime } from './startAt';

// bpm 240 (x4 already): a beat is 0.25 s; gap 2 s
const lyricData = {
  bpm: 240, gap: 2000,
  lyricLines: [
    [{ isBreak: true, start: 0 }, { isBreak: false, start: 0 }, { isBreak: false, start: 4 }],   // 2.0 s
    [{ isBreak: true, start: 20 }, { isBreak: false, start: 24 }, { isBreak: false, start: 30 }], // 8.0 s
    [{ isBreak: true, start: 100 }, { isBreak: false, start: 120 }],                            // 32.0 s
  ],
};

describe('startAt', () => {
  test('reads a usable t only', () => {
    expect(startAtFromSearch('?t=83.2')).toBe(83.2);
    expect(startAtFromSearch('?l=1&t=12')).toBe(12);
    expect(startAtFromSearch('?t=0')).toBe(null);
    expect(startAtFromSearch('?t=abc')).toBe(null);
    expect(startAtFromSearch('')).toBe(null);
  });

  test('drops t and keeps the rest', () => {
    expect(searchWithoutStartAt('?t=83.2')).toBe('');
    expect(searchWithoutStartAt('?l=1&t=12')).toBe('?l=1');
  });

  test('starts a second before the line being sung', () => {
    expect(startPoint(lyricData, 10)).toBe(7);    // line at 8.0 s
    expect(startPoint(lyricData, 7.7)).toBe(7);   // that line begins within half a second
    expect(startPoint(lyricData, 33)).toBe(31);   // line at 32.0 s
  });

  test('a line that began long before: just before t', () => {
    expect(startPoint(lyricData, 25)).toBe(24);   // the 8 s line is 17 s back
  });

  test('never before the video starts, and without a chart', () => {
    expect(startPoint(lyricData, 0.5)).toBe(0);
    expect(startPoint(null, 40)).toBe(39);
  });
});

describe('resumeTime', () => {
  const on = { songId: 'Roar', ended: false, hostVideoTime: 30.4, playedSeconds: 31.2 };

  test("goes on from the host's last reported time with the party's song", () => {
    expect(resumeTime(on, 'Roar')).toBe(30.4);
    expect(resumeTime(on, 'roar')).toBe(30.4); // a miscased link to the same song
    expect(resumeTime({ ...on, hostVideoTime: undefined }, 'Roar')).toBe(31.2);
    expect(resumeTime({ songId: 'Roar', ended: false }, 'Roar')).toBe(0);
  });

  test('starts as before: another song, a play that is over, no song, an older server, a spot of its own', () => {
    expect(resumeTime(on, 'Firework')).toBe(null);
    expect(resumeTime({ ...on, ended: true }, 'Roar')).toBe(null);
    expect(resumeTime(null, 'Roar')).toBe(null);
    expect(resumeTime({ ...on, ended: undefined }, 'Roar')).toBe(null);
    expect(resumeTime(on, 'Roar', { openedAt: 83.2 })).toBe(null);
    expect(resumeTime(on, 'none')).toBe(null);
  });
});
