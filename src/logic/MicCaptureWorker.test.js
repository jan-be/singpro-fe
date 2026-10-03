import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChunker } from './micChunker';

const OPTIONS = { nativeRate: 48000, targetRate: 16000, windowSamples: 960, hopSamples: 480, levelsPerSec: 10 };

// The worker's global scope, stood in
let posted;
beforeEach(async () => {
  vi.resetModules();
  posted = [];
  globalThis.self = { postMessage: vi.fn(msg => posted.push(msg)), onmessage: null };
  await import('./MicCaptureWorker.js');
});
const send = data => globalThis.self.onmessage({ data });

/** Something like AudioData: `samples` handed out by copyTo. */
const frame = samples => ({ numberOfFrames: samples.length, copyTo: dest => dest.set(samples), close: vi.fn() });

/** A stream of 10 ms frames whose pulls the test drives: next(n) delivers n frames and waits until they are read. */
function frameSource(signal) {
  let controller, off = 0;
  const readable = new ReadableStream({ start: c => { controller = c; } }, { highWaterMark: 0 });
  return {
    readable,
    async next(n) {
      for (let k = 0; k < n && off + 480 <= signal.length; k++, off += 480) controller.enqueue(frame(signal.slice(off, off + 480)));
      for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
    },
    fail: err => controller.error(err),
  };
}

const tone = (seconds) => {
  const x = new Float32Array(seconds * 48000);
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / 48000) + (i % 7919 < 900 ? 0.1 * Math.sin(i * 1.7) : 0);
  return x;
};

describe('MicCaptureWorker', () => {
  it('sends the chunks the main thread would make, bit for bit', async () => {
    const signal = tone(1);
    const src = frameSource(signal);
    send({ type: 'start', readable: src.readable, options: OPTIONS });
    await src.next(100);
    const want = [];
    const chunker = createChunker({ ...OPTIONS, onChunk: c => want.push(c) });
    for (let off = 0; off + 480 <= signal.length; off += 480) chunker.push(signal.slice(off, off + 480));
    const got = posted.filter(m => m.audio);
    expect(got.length).toBe(want.length);
    expect(got.length).toBeGreaterThan(30);
    got.forEach((c, i) => {
      expect(c.gen).toBe(0);
      expect([c.pos, c.volume, c.fric]).toEqual([want[i].pos, want[i].volume, want[i].fric]);
      expect(new Uint32Array(c.audio.buffer)).toEqual(new Uint32Array(want[i].audio.buffer));
    });
    // the audio is transferred, not copied
    expect(globalThis.self.postMessage.mock.calls.filter(([m]) => m.audio).every(([m, t]) => t?.[0] === m.audio.buffer)).toBe(true);
  });

  it('only sends levels while paused, tagged with the setActive call they follow', async () => {
    const src = frameSource(tone(2));
    send({ type: 'start', readable: src.readable, options: OPTIONS });
    await src.next(20);
    send({ type: 'active', active: false, gen: 1 });
    posted.length = 0;
    await src.next(50); // 0.5 s paused: ~5 levels, no chunks
    expect(posted.some(m => m.audio)).toBe(false);
    expect(posted.length).toBe(5);
    expect(posted.every(m => m.gen === 1 && m.volume > 0)).toBe(true);
    send({ type: 'active', active: true, gen: 2 });
    posted.length = 0;
    await src.next(20);
    const chunks = posted.filter(m => m.audio);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(m => m.gen === 2)).toBe(true);
  });

  it('says so when the stream cannot be read at all', async () => {
    const src = frameSource(tone(1));
    send({ type: 'start', readable: src.readable, options: OPTIONS });
    src.fail(new Error('no frames here'));
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
    expect(posted).toEqual([{ type: 'failed', error: 'no frames here' }]);
  });
});
