import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGapOverride, setGapOverride, clearGapOverride } from './gapOverrides';

// vitest runs in node: a minimal localStorage stand-in
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: unknown) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  });
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
    // @ts-expect-error a song id that is not one
    setGapOverride(null, 100);
    expect(getGapOverride('s1')).toBe(null);
    localStorage.setItem('singspree_gap_overrides', 'not json');
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

  it('gives way once the shared timing moved since it was saved', () => {
    setGapOverride('s1', 19110, 18580);
    expect(getGapOverride('s1', { shared: 18580, base: 18580 })).toBe(19110);
    expect(getGapOverride('s1', { shared: 18581, base: 18580 })).toBe(19110); // a rounding carry is no change
    expect(getGapOverride('s1', { shared: 18350, base: 18580 })).toBe(null);  // an admin corrected it since
    expect(getGapOverride('s1', { shared: 18580, base: 18580 })).toBe(null);  // and it is gone for good
    // without the shared gap (a caller that does not know it) the saved value stands
    setGapOverride('s2', 500, 400);
    expect(getGapOverride('s2')).toBe(500);
  });

  it('drops a value saved before they remembered the shared gap when the song has a correction now', () => {
    localStorage.setItem('singspree_gap_overrides', JSON.stringify({ old1: 19110, old2: 7000 }));
    expect(getGapOverride('old1', { shared: 18350, base: 18580 })).toBe(null);
    expect(getGapOverride('old2', { shared: 6500, base: 6500 })).toBe(7000);  // no correction: still the user's word
  });

  it('survives a blocked storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => setGapOverride('s1', 1)).not.toThrow();
    expect(getGapOverride('s1')).toBe(null);
  });
});
