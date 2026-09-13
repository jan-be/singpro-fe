import { describe, it, expect, beforeAll, vi } from 'vitest';

// The worklet registers itself with the AudioWorklet globals; stand them in
// and capture the class so it can be driven with synthetic render quanta.
let Worklet;
beforeAll(async () => {
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = { postMessage: vi.fn(), onmessage: null }; }
  };
  globalThis.registerProcessor = (name, cls) => { Worklet = cls; };
  await import('./PitchFinderWorklet.js');
});

const makeWorklet = () => new Worklet({ processorOptions: { nativeSampleRate: 48000, targetSampleRate: 16000 } });

/** Feed `seconds` of a sine at 48kHz in 128-sample render quanta. */
const feed = (w, seconds, freq = 440, amplitude = 0.5) => {
  const quanta = Math.round(seconds * 48000 / 128);
  let n = 0;
  for (let q = 0; q < quanta; q++) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i++, n++) block[i] = amplitude * Math.sin(2 * Math.PI * freq * n / 48000);
    w.process([[block]]);
  }
};
const messages = w => w.port.postMessage.mock.calls.map(c => c[0]);
const audioMessages = w => messages(w).filter(m => m.audio);
const levelMessages = w => messages(w).filter(m => !m.audio);
const setActive = (w, active) => w.port.onmessage({ data: { type: 'active', active } });

describe('PitchFinderWorklet', () => {
  it('posts 960-sample chunks about 65 times a second while active', () => {
    const w = makeWorklet();
    feed(w, 1);
    const chunks = audioMessages(w);
    // 16000 target samples: one chunk at 960, then every 240 → 63
    expect(chunks.length).toBeGreaterThanOrEqual(60);
    expect(chunks.length).toBeLessThanOrEqual(66);
    expect(chunks[0].audio.length).toBe(960);
    expect(chunks[0].volume).toBeCloseTo(0.5 / Math.SQRT2, 1); // RMS of a 0.5 sine
    expect(levelMessages(w).length).toBe(0);
  });

  it('idles when the song is paused: no audio chunks, only a coarse level ~10x/s', () => {
    const w = makeWorklet();
    setActive(w, false);
    feed(w, 1);
    expect(audioMessages(w).length).toBe(0);
    const levels = levelMessages(w);
    expect(levels.length).toBeGreaterThanOrEqual(9);
    expect(levels.length).toBeLessThanOrEqual(11);
    expect(levels[0].volume).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  it('resumes with a fresh window: nothing from before the pause leaks into the first chunk', () => {
    const w = makeWorklet();
    feed(w, 0.5);
    setActive(w, false);
    feed(w, 0.5);
    w.port.postMessage.mockClear();
    setActive(w, true);
    // 100ms of silence (> one 60ms window): the first chunk must be all zeros, not old sine
    const quanta = Math.round(0.1 * 48000 / 128);
    for (let q = 0; q < quanta; q++) w.process([[new Float32Array(128)]]);
    const chunks = audioMessages(w);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...Array.from(chunks[0].audio, Math.abs))).toBe(0);
    expect(chunks[0].volume).toBe(0);
  });

  it('ignores a repeated "active" message (no window reset mid-stream)', () => {
    const w = makeWorklet();
    feed(w, 0.2);
    const before = audioMessages(w).length;
    setActive(w, true); // already active
    feed(w, 0.02); // 320 target samples: more than one hop, less than a full window
    expect(audioMessages(w).length).toBeGreaterThan(before);
  });
});
