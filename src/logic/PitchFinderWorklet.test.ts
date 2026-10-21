import { describe, it, expect, beforeAll, vi, assert } from 'vitest';
import type { Mock } from 'vitest';
import type { CaptureOutput, PitchWorkletOptions, PitchWorkletRequest } from './micChunker';

/** The stand-in port: it records what the worklet posts */
type PostMessage = (message: CaptureOutput, transfer?: Transferable[]) => void;
type Port = { postMessage: Mock<PostMessage>, onmessage: ((e: { data: PitchWorkletRequest }) => void) | null };
/** The worklet as the test drives it: its port, and one render quantum's inputs at a time */
type TestWorklet = { port: Port, process(inputs: Float32Array[][]): boolean };

// The worklet registers itself with the AudioWorklet globals; stand them in
// and capture the class so it can be driven with synthetic render quanta.
let Worklet: AudioWorkletProcessorConstructor<PitchWorkletOptions>;
let lastPort: Port; // the port of the processor made last
beforeAll(async () => {
  globalThis.sampleRate = 48000;
  vi.stubGlobal('AudioWorkletProcessor', class {
    port: Port = lastPort = { postMessage: vi.fn<PostMessage>(), onmessage: null };
  });
  vi.stubGlobal('registerProcessor', (name: string, cls: AudioWorkletProcessorConstructor<PitchWorkletOptions>) => { Worklet = cls; });
  await import('./PitchFinderWorklet');
});

const makeWorklet = (): TestWorklet => {
  const worklet = new Worklet({ processorOptions: { nativeSampleRate: 48000, targetSampleRate: 16000 } });
  return { port: lastPort, process: inputs => worklet.process(inputs, [], {}) };
};

/** Feed `seconds` of a sine at 48kHz in 128-sample render quanta. */
const feed = (w: TestWorklet, seconds: number, freq = 440, amplitude = 0.5) => {
  const quanta = Math.round(seconds * 48000 / 128);
  let n = 0;
  for (let q = 0; q < quanta; q++) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i++, n++) block[i] = amplitude * Math.sin(2 * Math.PI * freq * n / 48000);
    w.process([[block]]);
  }
};
const messages = (w: TestWorklet) => w.port.postMessage.mock.calls.map(c => c[0]);
const audioMessages = (w: TestWorklet) => messages(w).filter(m => 'audio' in m);
const levelMessages = (w: TestWorklet) => messages(w).filter(m => !('audio' in m));
const setActive = (w: TestWorklet, active: boolean) => {
  assert(w.port.onmessage, 'the worklet takes no messages');
  w.port.onmessage({ data: { type: 'active', active } });
};

describe('PitchFinderWorklet', () => {
  it('posts 960-sample chunks about 33 times a second while active', () => {
    const w = makeWorklet();
    feed(w, 1);
    const chunks = audioMessages(w);
    // 16000 target samples: one chunk at 960, then every 480 → 32
    expect(chunks.length).toBeGreaterThanOrEqual(31);
    expect(chunks.length).toBeLessThanOrEqual(33);
    expect(chunks[0].audio.length).toBe(960);
    expect(chunks[0].volume).toBeCloseTo(0.5 / Math.SQRT2, 1); // RMS of a 0.5 sine
    expect(levelMessages(w).length).toBe(0);
    // a sine is a smooth, voiced sound: no chunk reports a hissed consonant
    expect(chunks.every(c => c.fric === 0)).toBe(true);
  });

  it('says where each chunk ends in the audio taken in while active (pos), standing still while paused', () => {
    const w = makeWorklet();
    feed(w, 0.5);
    let pos = audioMessages(w).map(c => c.pos);
    for (let i = 1; i < pos.length; i++) expect(pos[i] - pos[i - 1]).toBeCloseTo(0.03, 3);
    expect(pos.at(-1)).toBeLessThanOrEqual(0.5);
    const before = pos[pos.length - 1];
    setActive(w, false);
    feed(w, 2); // paused: the clock does not run
    w.port.postMessage.mockClear();
    setActive(w, true);
    feed(w, 0.2);
    pos = audioMessages(w).map(c => c.pos);
    expect(pos[0]).toBeGreaterThan(before);
    expect(pos.at(-1)).toBeLessThan(0.5 + 0.2 + 0.001); // 0.7 s taken in while active, not 2.7
  });

  it('reports a hiss in the native-rate input as a consonant (fric), which the 16 kHz chunk no longer holds', () => {
    const w = makeWorklet();
    let seed = 5, prev = 0;
    const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 31 - 1; };
    const quanta = (seconds: number, amp: number) => {
      for (let q = 0; q < Math.round(seconds * 48000 / 128); q++) {
        const block = new Float32Array(128);
        for (let i = 0; i < 128; i++) { const x = noise(); block[i] = amp * (x - prev) / 2; prev = x; }
        w.process([[block]]);
      }
    };
    quanta(0.5, 0.001); // a quiet room
    w.port.postMessage.mockClear();
    quanta(0.15, 0.05); // "sss"
    const chunks = audioMessages(w);
    expect(chunks.filter(c => c.fric === 1).length).toBeGreaterThanOrEqual(chunks.length - 1);
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
