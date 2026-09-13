import { describe, it, expect, beforeEach } from 'vitest';
import { getGapOverride, setGapOverride, clearGapOverride } from './gapOverrides';

// vitest runs in node: a minimal localStorage stand-in
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
});

describe('gap overrides', () => {
  it('stores, reads and clears a per-song gap', () => {
    expect(getGapOverride('s1')).toBe(null);
    setGapOverride('s1', 12345);
    expect(getGapOverride('s1')).toBe(12345);
    expect(getGapOverride('s2')).toBe(null);
    clearGapOverride('s1');
    expect(getGapOverride('s1')).toBe(null);
  });

  it('ignores garbage', () => {
    setGapOverride('s1', NaN);
    setGapOverride('', 100);
    setGapOverride(null, 100);
    expect(getGapOverride('s1')).toBe(null);
    localStorage.setItem('singpro_gap_overrides', 'not json');
    expect(getGapOverride('s1')).toBe(null);
    setGapOverride('s1', 5); // recovers from the broken value
    expect(getGapOverride('s1')).toBe(5);
  });

  it('keeps the most recent 300 songs', () => {
    for (let i = 0; i < 305; i++) setGapOverride(`song${i}`, i);
    expect(getGapOverride('song0')).toBe(null);
    expect(getGapOverride('song4')).toBe(null);
    expect(getGapOverride('song5')).toBe(5);
    expect(getGapOverride('song304')).toBe(304);
    setGapOverride('song5', 55); // touching an entry makes it the newest again
    setGapOverride('song305', 305);
    expect(getGapOverride('song5')).toBe(55);
    expect(getGapOverride('song6')).toBe(null);
  });

  it('survives a blocked storage', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => setGapOverride('s1', 1)).not.toThrow();
    expect(getGapOverride('s1')).toBe(null);
  });
});
