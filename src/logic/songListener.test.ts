import { describe, test, expect } from 'vitest';
import { createPcmBuffer, toPcm16, RATE } from './songListener';
import { HOP_SAMPLES } from './pitchModel';

describe('songListener', () => {
  test('16-bit samples, clipped', () => {
    expect(Array.from(toPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });

  test('the capture windows overlap: only the newest hop of each is new', () => {
    const buf = createPcmBuffer(10 * HOP_SAMPLES);
    const window = (k) => Float32Array.from({ length: 2 * HOP_SAMPLES }, (_, i) => (i < HOP_SAMPLES ? 0 : (k + 1) / 100));
    buf.push(window(0));
    buf.push(window(1));
    expect(buf.length).toBe(2 * HOP_SAMPLES);
    const sent = buf.take();
    expect(sent.length).toBe(2 * HOP_SAMPLES);
    expect(sent[0]).toBe(toPcm16([0.01])[0]);
    expect(sent[HOP_SAMPLES]).toBe(toPcm16([0.02])[0]);
    expect(buf.unsent).toBe(0);
  });

  test('stops taking audio at its maximum', () => {
    const buf = createPcmBuffer(RATE);
    for (let k = 0; k < 40; k++) buf.push(new Float32Array(2 * HOP_SAMPLES));
    expect(buf.length).toBe(RATE);
    expect(buf.full()).toBe(true);
  });
});
