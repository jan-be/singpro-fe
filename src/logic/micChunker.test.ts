import { describe, it, expect } from 'vitest';
import { createChunker } from './micChunker';
import { createFricativeDetector } from './fricative';

// The chunking as it was before the ring: the whole window shifted by one for
// every target sample. The ring must give exactly the same chunks.
function createShiftChunker({ nativeRate, onChunk }) {
  const ratio = nativeRate / 16000;
  const SAMPLE_SIZE = 960, HOP_SIZE = 480;
  const buffer = new Float32Array(SAMPLE_SIZE);
  let samplesUntilNext = SAMPLE_SIZE, resamplePos = 0, prevSample = 0, activeSamples = 0;
  const fricative = createFricativeDetector(nativeRate);
  return {
    reset() {
      buffer.fill(0);
      samplesUntilNext = SAMPLE_SIZE;
      resamplePos = 0;
      prevSample = 0;
      fricative.reset();
    },
    push(channelData) {
      const inputLen = channelData.length;
      let fed = 0;
      for (let i = 0; i < inputLen; i++) {
        const cur = channelData[i];
        while (resamplePos <= i) {
          const frac = resamplePos - Math.floor(resamplePos);
          const lo = Math.floor(resamplePos);
          const sample = lo < i ? prevSample * (1 - frac) + cur * frac : cur;
          buffer.copyWithin(0, 1);
          buffer[SAMPLE_SIZE - 1] = sample;
          samplesUntilNext--;
          if (samplesUntilNext <= 0) {
            let sumSq = 0;
            for (let j = 0; j < SAMPLE_SIZE; j++) sumSq += buffer[j] * buffer[j];
            const volume = Math.sqrt(sumSq / SAMPLE_SIZE);
            fricative.push(channelData, fed, i + 1);
            fed = i + 1;
            onChunk({ audio: new Float32Array(buffer), volume, fric: fricative.flag(), pos: (activeSamples + i + 1) / nativeRate });
            samplesUntilNext += HOP_SIZE;
          }
          resamplePos += ratio;
        }
        prevSample = cur;
      }
      fricative.push(channelData, fed, inputLen);
      activeSamples += inputLen;
      resamplePos -= inputLen;
    },
  };
}

/** 4 s of a voice-like test signal: a gliding tone with hiss bursts (consonants) and silences. */
function testSignal(rate) {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const x = new Float32Array(4 * rate);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    phase += 2 * Math.PI * (220 + 110 * Math.sin(t)) / rate;
    const voiced = t % 1 < 0.6 ? 0.3 * Math.sin(phase) : 0;
    const hiss = t % 0.5 > 0.42 ? 0.2 * rand() : 0;
    x[i] = t > 3.5 ? 0 : voiced + hiss + 0.001 * rand();
  }
  return x;
}

function frames(x, sizes) {
  const out = [];
  for (let off = 0, k = 0; off < x.length; k++) {
    const n = Math.min(sizes[k % sizes.length], x.length - off);
    out.push(x.slice(off, off + n));
    off += n;
  }
  return out;
}

function chunks(make, rate, fr, resetAt) {
  const out = [];
  const c = make({ nativeRate: rate, onChunk: ch => out.push(ch) });
  fr.forEach((f, i) => { if (resetAt.has(i)) c.reset(); c.push(f); });
  return out;
}

describe('createChunker', () => {
  it.each([
    [48000, [480]], [48000, [128]], [44100, [441]], [44100, [128]], [16000, [160]],
    [22050, [1024]], [48000, [7, 480, 333, 1, 2048, 13]],
  ])('gives exactly the chunks of the shifted window (%i Hz, frames of %j)', (rate, sizes) => {
    const fr = frames(testSignal(rate), sizes);
    const resetAt = new Set([Math.floor(fr.length / 3), Math.floor(fr.length / 3) + 1, Math.floor(fr.length * 0.7)]);
    const want = chunks(createShiftChunker, rate, fr, resetAt);
    const got = chunks(createChunker, rate, fr, resetAt);
    expect(got.length).toBe(want.length);
    expect(want.length).toBeGreaterThan(100);
    expect(want.some(c => c.fric)).toBe(true);
    for (let i = 0; i < want.length; i++) {
      expect(got[i].pos).toBe(want[i].pos);
      expect(got[i].volume).toBe(want[i].volume);
      expect(got[i].fric).toBe(want[i].fric);
      // bit for bit
      expect(new Uint32Array(got[i].audio.buffer)).toEqual(new Uint32Array(want[i].audio.buffer));
    }
  });

  it('hands out each chunk in an array of its own', () => {
    const got = chunks(createChunker, 48000, frames(testSignal(48000), [480]), new Set());
    expect(new Set(got.map(c => c.audio.buffer)).size).toBe(got.length);
  });
});
