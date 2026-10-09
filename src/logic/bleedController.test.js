import { describe, it, expect, beforeEach } from 'vitest';
import { keptReference, forgetKeptReference } from './bleedController.js';

const stem = (n) => ({ samples: new Float32Array(n), rate: 8000 });

describe('keptReference', () => {
  beforeEach(() => forgetKeptReference());

  it('makes the reference once per stem: the microphone back on, or another one, gets the same', async () => {
    let made = 0;
    const make = async () => { made++; return stem(4); };
    const a = await keptReference('/api/songs/s1/karaoke', make);
    const b = await keptReference('/api/songs/s1/karaoke', make);
    expect(made).toBe(1);
    expect(b).toBe(a);
  });

  it('keeps one song only: a new stem replaces it', async () => {
    let made = 0;
    const make = async () => { made++; return stem(4); };
    await keptReference('/api/songs/s1/karaoke', make);
    await keptReference('/api/songs/s2/karaoke', make);
    await keptReference('/api/songs/s1/karaoke', make);
    expect(made).toBe(3);
  });

  it('a failure is not kept: the next try makes it again', async () => {
    let made = 0;
    expect(await keptReference('/api/songs/s1/karaoke', async () => { made++; throw new Error('offline'); })).toBe(null);
    expect(await keptReference('/api/songs/s1/karaoke', async () => { made++; return null; })).toBe(null);
    const s = await keptReference('/api/songs/s1/karaoke', async () => { made++; return stem(2); });
    expect(made).toBe(3);
    expect(s.samples.length).toBe(2);
  });

  it('an AudioBuffer is a key too (decoded stems, Apple)', async () => {
    const buffer = {};
    let made = 0;
    await keptReference(buffer, async () => { made++; return stem(1); });
    await keptReference(buffer, async () => { made++; return stem(1); });
    expect(made).toBe(1);
  });
});
