import { describe, it, expect } from 'vitest';
import { formatDuration } from './duration.js';

describe('formatDuration', () => {
  it('grows the unit with the length and drops what would only be noise', () => {
    expect(formatDuration(0)).toBe('0 sec');
    expect(formatDuration(12)).toBe('12 sec');
    expect(formatDuration(90)).toBe('1 min 30 sec');
    expect(formatDuration(300)).toBe('5 min');
    expect(formatDuration(599)).toBe('9 min 59 sec');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(2725)).toBe('45 min');
    expect(formatDuration(3600)).toBe('1 hr');
    expect(formatDuration(4320)).toBe('1 hr 12 min');
    expect(formatDuration(3 * 3600 + 5 * 60 + 59)).toBe('3 hr 5 min');
  });

  it('takes strings and rubbish in its stride and speaks other languages', () => {
    expect(formatDuration('4320')).toBe('1 hr 12 min');
    expect(formatDuration(null)).toBe('0 sec');
    expect(formatDuration(-5)).toBe('0 sec');
    expect(formatDuration(4320, 'de')).toBe('1 Std. 12 Min.');
    expect(formatDuration(4320, 'zz-not-a-language-!')).toBe('1 hr 12 min');
  });
});
