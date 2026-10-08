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

import { createMicCapture } from './micChunker.js';

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
    // null: the first channel; 0 / 1: that channel of a stereo input (a mixer panned left and right)
    this.channel = opts.channel ?? null;

    // Chunks while active; idle (song paused) only an input level, accumulated over ~100ms
    this.capture = createMicCapture({
      nativeRate: this.nativeRate,
      targetRate: this.targetRate,
      windowSamples: SAMPLE_SIZE,
      hopSamples: HOP_SIZE,
      levelsPerSec: IDLE_LEVELS_PER_SEC,
      onChunk: chunk => this.port.postMessage(chunk, [chunk.audio.buffer]),
      onLevel: volume => this.port.postMessage({ volume }),
    });

    this.port.onmessage = ({ data }) => {
      if (data && data.type === 'active') this.setActive(!!data.active);
    };
  }

  setActive(active) {
    // Back from a pause from a clean window: nothing from before leaks into the first chunk
    this.capture.setActive(active);
  }

  process(inputs) {
    if (!inputs[0] || !inputs[0][0]) return true;
    // 128 native-rate samples per render quantum, of the chosen channel where the input has it
    const input = (this.channel != null && inputs[0][this.channel]) || inputs[0][0];
    this.capture.push(input, input.length);
    return true;
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
