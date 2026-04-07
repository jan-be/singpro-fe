// PitchFinderWorklet.js — AudioWorklet that accumulates mic audio, downsamples
// to 16kHz, and sends raw samples to the main thread for ONNX pitch detection.
//
// Runs at the device's native sample rate (usually 48kHz). Resamples internally
// to 16kHz (swift-f0's native rate) using linear interpolation.

const TARGET_RATE = 16000;
const SAMPLE_SIZE = 1280; // 80ms at 16kHz — enough for swift-f0
const HOP_SIZE = SAMPLE_SIZE >> 2; // 320 samples = 75% overlap, ~50 chunks/sec

class PitchFinderWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.nativeRate = opts.nativeSampleRate || sampleRate; // sampleRate is a global in worklet scope
    this.targetRate = opts.targetSampleRate || TARGET_RATE;
    this.ratio = this.nativeRate / this.targetRate;

    this.buffer = new Float32Array(SAMPLE_SIZE);
    this.samplesUntilNext = SAMPLE_SIZE;

    // Fractional resampler state — tracks position between native samples
    this.resamplePos = 0;
    this.prevSample = 0;
  }

  process(inputs) {
    if (!inputs[0] || !inputs[0][0]) return true;

    const input = inputs[0][0]; // 128 native-rate samples per render quantum

    // Downsample to target rate using linear interpolation
    const ratio = this.ratio;
    let pos = this.resamplePos;
    let prev = this.prevSample;
    const inputLen = input.length;

    for (let i = 0; i < inputLen; i++) {
      const cur = input[i];

      // Emit target-rate samples while our position hasn't passed this input sample
      while (pos <= i) {
        const frac = pos - Math.floor(pos);
        const lo = Math.floor(pos);
        // Interpolate between previous and current sample
        const sample = lo < i ? prev * (1 - frac) + cur * frac : cur;

        // Shift buffer left by 1 and append
        this.buffer.copyWithin(0, 1);
        this.buffer[SAMPLE_SIZE - 1] = sample;
        this.samplesUntilNext--;

        if (this.samplesUntilNext <= 0) {
          // Compute RMS volume
          let sumSq = 0;
          for (let j = 0; j < SAMPLE_SIZE; j++) sumSq += this.buffer[j] * this.buffer[j];
          const volume = Math.sqrt(sumSq / SAMPLE_SIZE);

          const copy = new Float32Array(this.buffer);
          this.port.postMessage({ audio: copy, volume }, [copy.buffer]);

          this.samplesUntilNext += HOP_SIZE;
        }

        pos += ratio;
      }

      prev = cur;
    }

    // Save state for next render quantum
    this.resamplePos = pos - inputLen;
    this.prevSample = prev;

    return true;
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
