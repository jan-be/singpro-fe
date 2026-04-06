// PitchFinderWorklet.js — AudioWorklet that accumulates mic audio and sends
// raw samples to the main thread for ONNX-based pitch detection.
//
// Runs at 16kHz (the AudioContext sample rate, matching swift-f0's native rate).
// No resampling needed — audio goes directly to the ONNX worker.

const SAMPLE_SIZE = 1280; // 80ms at 16kHz — enough for swift-f0 (needs ≥256 samples)
const HOP_SIZE = SAMPLE_SIZE >> 2; // 320 samples = 75% overlap, ~50 chunks/sec

class PitchFinderWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(SAMPLE_SIZE);
    this.samplesUntilNext = SAMPLE_SIZE;
  }

  process(inputs) {
    if (!inputs[0] || !inputs[0][0]) return true;

    const input = inputs[0][0]; // 128 samples per render quantum
    const len = input.length;

    // Shift buffer left by `len` and append new samples at the end
    this.buffer.copyWithin(0, len);
    this.buffer.set(input, SAMPLE_SIZE - len);

    this.samplesUntilNext -= len;

    if (this.samplesUntilNext <= 0) {
      // Compute RMS volume in the worklet (cheap, avoids sending silent frames)
      let sumSq = 0;
      for (let i = 0; i < SAMPLE_SIZE; i++) sumSq += this.buffer[i] * this.buffer[i];
      const volume = Math.sqrt(sumSq / SAMPLE_SIZE);

      // Send a copy of the audio buffer + volume to main thread
      const copy = new Float32Array(this.buffer);
      this.port.postMessage({ audio: copy, volume }, [copy.buffer]);

      this.samplesUntilNext += HOP_SIZE;
    }

    return true;
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
