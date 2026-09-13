// PitchFinderWorklet.js — AudioWorklet that accumulates mic audio, downsamples
// to 16kHz, and sends raw samples to the main thread for ONNX pitch detection.
//
// Runs at the device's native sample rate (usually 48kHz). Resamples internally
// to 16kHz (swift-f0's native rate) using linear interpolation.
//
// While the song is paused the main thread switches the worklet to idle
// ({ type: 'active', active: false }): no resampling and no audio chunks, only
// a coarse input level a few times a second so the microphone panel's meter
// keeps working.

const TARGET_RATE = 16000;
const SAMPLE_SIZE = 960; // 60ms at 16kHz — optimal for swift-f0
const HOP_SIZE = SAMPLE_SIZE >> 2; // 240 samples = 75% overlap, ~67 chunks/sec
const IDLE_LEVELS_PER_SEC = 10;

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
    if (active) {
      // Start from a clean window: nothing from before the pause leaks into the first chunk
      this.buffer.fill(0);
      this.samplesUntilNext = SAMPLE_SIZE;
      this.resamplePos = 0;
      this.prevSample = 0;
    }
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

    // Downsample to target rate using linear interpolation
    const ratio = this.ratio;
    let pos = this.resamplePos;
    let prev = this.prevSample;

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
