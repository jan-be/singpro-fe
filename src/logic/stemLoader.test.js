import { describe, it, expect } from 'vitest';
import { fetchStemIntoMemory } from './stemLoader';

const clock = (...ticks) => { let i = 0; return () => ticks[Math.min(i++, ticks.length - 1)]; };

describe('fetchStemIntoMemory', () => {
  it('fetches the file, wraps it in an object URL and reports size and time', async () => {
    const calls = [];
    const result = await fetchStemIntoMemory('/api/songs/x/karaoke', {
      fetchImpl: async (u) => { calls.push(u); return { ok: true, blob: async () => ({ size: 4084622 }) }; },
      createObjectURL: (blob) => `blob:${blob.size}`,
      now: clock(1000, 2830.4),
    });
    expect(calls).toEqual(['/api/songs/x/karaoke']);
    expect(result).toEqual({ objectUrl: 'blob:4084622', size: 4084622, ms: 1830 });
  });

  it('fails on an HTTP error and on an empty file, without making an object URL', async () => {
    let made = 0;
    const opts = { createObjectURL: () => { made++; return 'blob:never'; }, now: clock(0) };
    await expect(fetchStemIntoMemory('/x', { ...opts, fetchImpl: async () => ({ ok: false, status: 404 }) })).rejects.toThrow('HTTP 404');
    await expect(fetchStemIntoMemory('/x', { ...opts, fetchImpl: async () => ({ ok: true, blob: async () => ({ size: 0 }) }) })).rejects.toThrow('empty file');
    expect(made).toBe(0);
  });
});
