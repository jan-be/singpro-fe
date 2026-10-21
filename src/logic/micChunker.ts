// micChunker.ts — the microphone's native-rate samples into the pitch model's
// 16 kHz windows: shared by MicCaptureWorker.ts and MicrophoneInput.ts
// (MediaStreamTrackProcessor, in a worker or on the main thread) and
// PitchFinderWorklet.ts (the audio thread).
//
// Resamples by linear interpolation and emits the newest WINDOW samples every
// HOP target samples. Alongside, it looks for hissed consonants in the
// native-rate signal (fricative.ts), which the 16 kHz copy no longer holds:
// each chunk says whether its newest 30 ms had one (`fric`).
//
// Each chunk also says where it ends in the audio taken in (`pos`, seconds):
// the recording (AudioRecorder.ts) pauses with the song just like the
// capture, so `pos` places every pitch in the recorded audio.
//
// The window is a ring: the newest sample overwrites the oldest and a chunk
// is unrolled into its own array. Shifting the whole window by one for every
// target sample moved ~15 million floats a second on the main thread.

import { createFricativeDetector } from './fricative';

/** One 16 kHz window of the microphone (createChunker) */
export interface MicChunk {
  /** the newest windowSamples samples, in an array of its own (free to transfer) */
  audio: Float32Array<ArrayBuffer>;
  /** the window's RMS */
  volume: number;
  /** 1 when its newest 30 ms held a hissed consonant (fricative.ts), else 0 */
  fric: 0 | 1;
  /** where it ends in the audio taken in, s */
  pos: number;
}

export interface ChunkerOptions {
  nativeRate: number;
  targetRate?: number;
  windowSamples?: number;
  hopSamples?: number;
  onChunk: (chunk: MicChunk) => void;
}

/** Native-rate samples in, 16 kHz windows out (createChunker) */
export interface Chunker {
  /** Native-rate samples input[0, inputLen). */
  push(input: ArrayLike<number>, inputLen?: number): void;
  /** Start from a clean window (after a pause): nothing from before leaks into the first chunk. */
  reset(): void;
}

export interface MicCaptureOptions extends ChunkerOptions {
  levelsPerSec?: number;
  onLevel: (volume: number) => void;
}

/** A microphone's whole capture (createMicCapture) */
export interface MicCapture {
  /** Native-rate samples input[0, inputLen). */
  push(input: ArrayLike<number>, inputLen?: number): void;
  setActive(value: boolean): void;
}

/** What a capture sends while the song is paused: the input level only */
export interface MicLevel {
  volume: number;
}

/** What a capture hands on: a chunk while active, else a level */
export type CaptureOutput = MicChunk | MicLevel;

/** The chunker's options as MicCaptureWorker.ts gets them (the callbacks are its own) */
export type MicCaptureWorkerOptions = Omit<MicCaptureOptions, 'onChunk' | 'onLevel'>;

/** Messages to MicCaptureWorker.ts: the stream to read; the song paused / runs again (`gen` tags everything sent after) */
export type MicCaptureRequest =
  | { type: 'start', readable: ReadableStream<AudioData>, options: MicCaptureWorkerOptions }
  | { type: 'active', active: boolean, gen: number };

/** MicCaptureWorker.ts's messages: chunks and levels tagged with the latest `gen`, or that the stream could not be read */
export type MicCaptureMessage = (CaptureOutput & { gen: number, type?: undefined }) | { type: 'failed', error: string };

/** Messages to PitchFinderWorklet.ts (its port) */
export type PitchWorkletRequest = { type: 'active', active: boolean };

/** What PitchFinderWorklet.ts's processorOptions hold */
export interface PitchWorkletOptions {
  nativeSampleRate?: number;
  targetSampleRate?: number;
}

/**
 * @param options
 *   onChunk gets each window in an array of its own (free to transfer)
 */
export function createChunker({ nativeRate, targetRate = 16000, windowSamples = 960, hopSamples = 480, onChunk }: ChunkerOptions): Chunker {
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
    push(input: ArrayLike<number>, inputLen = input.length) {
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

/**
 * A microphone's whole capture: chunks (createChunker) while the song plays;
 * while it is paused (setActive(false)) no resampling and no chunks, only a
 * coarse input level a few times a second for the microphone panel's meter.
 */
export function createMicCapture({ levelsPerSec = 10, onLevel, ...chunkOptions }: MicCaptureOptions): MicCapture {
  const chunker = createChunker(chunkOptions);
  let active = true;
  let idleSumSq = 0;
  let idleCount = 0;
  const idleSamplesPerLevel = Math.round(chunkOptions.nativeRate / levelsPerSec);

  return {
    /** Native-rate samples input[0, inputLen). */
    push(input: ArrayLike<number>, inputLen = input.length) {
      if (active) {
        chunker.push(input, inputLen);
        return;
      }
      let sumSq = 0;
      for (let i = 0; i < inputLen; i++) sumSq += input[i] * input[i];
      idleSumSq += sumSq;
      idleCount += inputLen;
      if (idleCount >= idleSamplesPerLevel) {
        const volume = Math.sqrt(idleSumSq / idleCount);
        idleSumSq = 0;
        idleCount = 0;
        onLevel(volume);
      }
    },

    setActive(value: boolean) {
      if (value === active) return;
      active = value;
      idleSumSq = 0;
      idleCount = 0;
      if (value) chunker.reset();
    },
  };
}
