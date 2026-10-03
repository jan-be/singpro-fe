// micChunker.js — the microphone's native-rate samples into the pitch model's
// 16 kHz windows: shared by MicrophoneInput.js (MediaStreamTrackProcessor, on
// the main thread) and PitchFinderWorklet.js (the audio thread).
//
// Resamples by linear interpolation and emits the newest WINDOW samples every
// HOP target samples. Alongside, it looks for hissed consonants in the
// native-rate signal (fricative.js), which the 16 kHz copy no longer holds:
// each chunk says whether its newest 30 ms had one (`fric`).
//
// Each chunk also says where it ends in the audio taken in (`pos`, seconds):
// the recording (AudioRecorder.js) pauses with the song just like the
// capture, so `pos` places every pitch in the recorded audio.
//
// The window is a ring: the newest sample overwrites the oldest and a chunk
// is unrolled into its own array. Shifting the whole window by one for every
// target sample moved ~15 million floats a second on the main thread.

import { createFricativeDetector } from './fricative.js';

/**
 * @param {{ nativeRate: number, targetRate?: number, windowSamples?: number, hopSamples?: number,
 *   onChunk: (chunk: { audio: Float32Array, volume: number, fric: number, pos: number }) => void }} options
 *   onChunk gets each window in an array of its own (free to transfer)
 */
export function createChunker({ nativeRate, targetRate = 16000, windowSamples = 960, hopSamples = 480, onChunk }) {
  const ratio = nativeRate / targetRate;
  const ring = new Float32Array(windowSamples);
  let head = 0;                    // the ring's oldest sample, where the next one goes
  let samplesUntilNext = windowSamples;
  // Fractional resampler state: the position between native samples
  let resamplePos = 0;
  let prevSample = 0;
  const fricative = createFricativeDetector(nativeRate);
  let activeSamples = 0;           // native samples taken in: the clock of a chunk's `pos`

  return {
    /** Native-rate samples input[0, inputLen). */
    push(input, inputLen = input.length) {
      let fed = 0; // input samples already given to the consonant detector
      for (let i = 0; i < inputLen; i++) {
        const cur = input[i];
        // Emit target-rate samples while our position hasn't passed this input sample
        while (resamplePos <= i) {
          const lo = Math.floor(resamplePos);
          const frac = resamplePos - lo;
          // Interpolate between previous and current sample
          ring[head] = lo < i ? prevSample * (1 - frac) + cur * frac : cur;
          if (++head === windowSamples) head = 0;

          if (--samplesUntilNext <= 0) {
            const audio = new Float32Array(windowSamples);
            audio.set(ring.subarray(head));
            audio.set(ring.subarray(0, head), windowSamples - head);
            let sumSq = 0;
            for (let j = 0; j < windowSamples; j++) sumSq += audio[j] * audio[j];
            const volume = Math.sqrt(sumSq / windowSamples);
            // The consonant detector sees the input up to this chunk's end, nothing later
            fricative.push(input, fed, i + 1);
            fed = i + 1;
            onChunk({ audio, volume, fric: fricative.flag(), pos: (activeSamples + i + 1) / nativeRate });
            samplesUntilNext += hopSamples;
          }

          resamplePos += ratio;
        }
        prevSample = cur;
      }
      fricative.push(input, fed, inputLen);
      activeSamples += inputLen;
      resamplePos -= inputLen;
    },

    /** Start from a clean window (after a pause): nothing from before leaks into the first chunk. */
    reset() {
      ring.fill(0);
      head = 0;
      samplesUntilNext = windowSamples;
      resamplePos = 0;
      prevSample = 0;
      fricative.reset();
    },
  };
}
