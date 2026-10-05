import { describe, it, expect } from 'vitest';
import { parseLatencyHint } from './audioLatencyFlag';

describe('parseLatencyHint', () => {
  it('takes the named hints and seconds', () => {
    expect(parseLatencyHint('playback')).toBe('playback');
    expect(parseLatencyHint('interactive')).toBe('interactive');
    expect(parseLatencyHint('balanced')).toBe('balanced');
    expect(parseLatencyHint('0.1')).toBe(0.1);
  });

  it('is the default (null) for nothing, 0, and anything else', () => {
    expect(parseLatencyHint(null)).toBe(null);
    expect(parseLatencyHint('0')).toBe(null);
    expect(parseLatencyHint('off')).toBe(null);
    expect(parseLatencyHint('5')).toBe(null);
  });
});
