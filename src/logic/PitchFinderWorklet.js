// PitchFinderWorklet.js — AudioWorklet that accumulates mic audio, downsamples
// to 16kHz, and sends raw samples to the main thread for ONNX pitch detection.
//
// Runs at the device's native sample rate (usually 48kHz). Resamples internally
// to 16kHz (swift-f0's native rate) using linear interpolation, the same
// chunks as MicrophoneInput's track-processor path (micChunker.js): each
// says whether its newest 30 ms held a hissed consonant (`fric`) and where it
// ends in the audio captured while active (`pos`, seconds).
//
// While the song is paused the main thread switches the worklet to idle
// ({ type: 'active', active: false }): no resampling and no audio chunks, only
// a coarse input level a few times a second so the microphone panel's meter
// keeps working.

import { createChunker } from './micChunker.js';

const TARGET_RATE = 16000;
const SAMPLE_SIZE = 960; // 60ms at 16kHz — optimal for swift-f0
const HOP_SIZE = SAMPLE_SIZE >> 1; // 480 samples = 30 ms, ~33 chunks/sec (pitchModel.HOP_SAMPLES)
const IDLE_LEVELS_PER_SEC = 10;

class PitchFinderWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.nativeRate = opts.nativeSampleRate || sampleRate; // sampleRate is a global in worklet scope
    this.targetRate = opts.targetSampleRate || TARGET_RATE;

    this.chunker = createChunker({
      nativeRate: this.nativeRate,
      targetRate: this.targetRate,
      windowSamples: SAMPLE_SIZE,
      hopSamples: HOP_SIZE,
      onChunk: chunk => this.port.postMessage(chunk, [chunk.audio.buffer]),
    });

    // Idle (song paused): only an input level, accumulated over ~100ms
    this.active = true;
    this.idleSumSq = 0;
    this.idleCount = 0;
    this.idleSamplesPerLevel = Math.round(this.nativeRate / IDLE_LEVELS_PER_SEC);

    this.port.onmessage = ({ data }) => {
      if (data && data.type === 'active') this.setActive(!!data.active);
    };
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.idleSumSq = 0;
    this.idleCount = 0;
    // Start from a clean window: nothing from before the pause leaks into the first chunk
    if (active) this.chunker.reset();
  }

  process(inputs) {
    if (!inputs[0] || !inputs[0][0]) return true;

    const input = inputs[0][0]; // 128 native-rate samples per render quantum
    const inputLen = input.length;

    if (!this.active) {
      let sumSq = 0;
      for (let i = 0; i < inputLen; i++) sumSq += input[i] * input[i];
      this.idleSumSq += sumSq;
      this.idleCount += inputLen;
      if (this.idleCount >= this.idleSamplesPerLevel) {
        this.port.postMessage({ volume: Math.sqrt(this.idleSumSq / this.idleCount) });
        this.idleSumSq = 0;
        this.idleCount = 0;
      }
      return true;
    }

    this.chunker.push(input, inputLen);
    return true;
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
