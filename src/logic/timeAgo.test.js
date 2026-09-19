import { describe, it, expect } from 'vitest';
import { timeAgo } from './timeAgo.js';

const now = Date.UTC(2026, 8, 19, 12, 0, 0);
const ago = (ms) => timeAgo(new Date(now - ms), { now, lang: 'en' });

describe('timeAgo', () => {
  it('picks the unit that fits the distance', () => {
    expect(ago(10_000)).toBe('now');
    expect(ago(50_000)).toBe('50 sec. ago');
    expect(ago(90_000)).toBe('2 min. ago');
    expect(ago(3 * 3600_000)).toBe('3 hr. ago');
    expect(ago(24 * 3600_000)).toBe('yesterday');
    expect(ago(3 * 24 * 3600_000)).toBe('3 days ago');
    expect(ago(14 * 24 * 3600_000)).toBe('2 wk. ago');
    expect(ago(60 * 24 * 3600_000)).toBe('2 mo. ago');
    expect(ago(400 * 24 * 3600_000)).toBe('last yr.');
    expect(ago(800 * 24 * 3600_000)).toBe('2 yr. ago');
  });

  it('works forwards, from ISO strings and epoch numbers, and shrugs at garbage', () => {
    expect(timeAgo(now + 2 * 3600_000, { now, lang: 'en' })).toBe('in 2 hr.');
    expect(timeAgo(new Date(now - 60_000).toISOString(), { now, lang: 'en' })).toBe('1 min. ago');
    expect(timeAgo(now - 60_000, { now, lang: 'en' })).toBe('1 min. ago');
    expect(timeAgo('not a date', { now })).toBe('');
    expect(timeAgo(null, { now })).toBe('');
  });

  it('speaks the given language and falls back to English for an unknown one', () => {
    expect(timeAgo(now - 3 * 24 * 3600_000, { now, lang: 'de' })).toBe('vor 3 Tagen');
    expect(timeAgo(now - 3 * 24 * 3600_000, { now, lang: 'zz-ZZ-nonsense-!' })).toBe('3 days ago');
  });
});
