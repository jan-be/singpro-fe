import { describe, expect, test } from 'vitest';
import { profileView, sungTime } from './profileStats';

describe('profileView', () => {
  test('saved scores: the score page, with the songs played', () => {
    expect(profileView({ songsSung: 3, plays: 4, played: 11 })).toEqual({ kind: 'scores', played: 11 });
  });

  test('played but never scored: the played songs instead of zeros', () => {
    expect(profileView({ songsSung: 0, plays: 0, played: 7 })).toEqual({ kind: 'played', played: 7 });
  });

  test('nothing at all: the empty page', () => {
    expect(profileView({ songsSung: 0, plays: 0, played: 0 })).toEqual({ kind: 'empty', played: 0 });
  });

  test('an older backend without played songs: the saved scores are what was played', () => {
    expect(profileView({ songsSung: 2, plays: 5 })).toEqual({ kind: 'scores', played: 5 });
    expect(profileView({ songsSung: 0, plays: 0 }).kind).toBe('empty');
  });
});

describe('sungTime', () => {
  test('minutes under an hour, hours to a tenth after, never rounded up', () => {
    expect(sungTime(42 * 60 + 20, 'en')).toBe('42 min');
    expect(sungTime(3600 + 11 * 60, 'en')).toBe('1.1 hr');
    expect(sungTime(2 * 3600 - 1, 'en')).toBe('1.9 hr');
    expect(sungTime(3600 + 11 * 60, 'de')).toBe('1,1 Std.');
  });

  test('under a minute, or unknown: nothing to show', () => {
    expect(sungTime(59, 'en')).toBeNull();
    expect(sungTime(null, 'en')).toBeNull();
    expect(sungTime(undefined, 'en')).toBeNull();
  });
});
