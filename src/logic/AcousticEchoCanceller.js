/**
 * AcousticEchoCanceller.js — Real-time Acoustic Echo Cancellation (AEC).
 *
 * Cancels speaker playback bleed (karaoke backing track + vocals) from the
 * microphone input using a Normalized LMS (NLMS) adaptive filter with
 * Double-Talk Detection (DTD) and adaptive residual spectral attenuation.
 */

const DEFAULT_SAMPLE_RATE = 16000;
const REF_BUFFER_CAPACITY = 32000; // 2.0s ring buffer at 16kHz
const FILTER_LENGTH = 256;          // 16ms FIR filter at 16kHz
const DEFAULT_ACOUSTIC_DELAY = 1600; // ~100ms default delay in samples (1600 samples at 16kHz)

export class AcousticEchoCanceller {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    this.filterLen = options.filterLen || FILTER_LENGTH;
    this.mu = options.stepSize || 0.15;
    this.eps = options.regularization || 1e-4;

    // Filter weights & reference delay line
    this.weights = new Float32Array(this.filterLen);
    this.refHistory = new Float32Array(this.filterLen);

    // Reference audio ring buffer
    this.refRingBuffer = new Float32Array(REF_BUFFER_CAPACITY);
    this.refWritePos = 0;
    this.totalRefReceived = 0;

    // Estimated acoustic propagation & buffer delay (in 16kHz samples)
    this.delaySamples = options.delaySamples || DEFAULT_ACOUSTIC_DELAY;

    // Power tracking for Double-Talk Detection
    this.micPower = 0;
    this.errPower = 0;
    this.refPower = 0;
  }

  /**
   * Feed freshly rendered reference playback samples (karaoke + vocals).
   * @param {Float32Array} samples - Reference audio samples at 16kHz
   */
  feedReference(samples) {
    if (!samples || samples.length === 0) return;
    const len = samples.length;
    for (let i = 0; i < len; i++) {
      this.refRingBuffer[this.refWritePos] = samples[i];
      this.refWritePos = (this.refWritePos + 1) % REF_BUFFER_CAPACITY;
    }
    this.totalRefReceived += len;
  }

  /** Check if reference audio is currently streaming */
  hasReference() {
    return this.totalRefReceived > this.delaySamples + this.filterLen;
  }

  /**
   * Set estimated acoustic latency offset in milliseconds.
   * @param {number} delayMs - Delay in milliseconds (typically 50-150ms)
   */
  setAcousticDelay(delayMs) {
    this.delaySamples = Math.max(0, Math.min(Math.floor((delayMs / 1000) * this.sampleRate), REF_BUFFER_CAPACITY - this.filterLen - 1000));
  }

  /**
   * Process an incoming microphone audio chunk (960 samples at 16kHz)
   * and return the speaker-bleed-cancelled signal.
   *
   * @param {Float32Array} micChunk - Raw 16kHz microphone chunk
   * @returns {Float32Array} Cleaned audio chunk
   */
  processChunk(micChunk) {
    const chunkLen = micChunk.length;
    if (!this.hasReference()) {
      return new Float32Array(micChunk);
    }

    const outChunk = new Float32Array(chunkLen);

    // Calculate start position in the ring buffer corresponding to acoustic delay
    // The reference audio played (delaySamples + chunkLen) samples ago corresponds to micChunk[0]
    let readPos = (this.refWritePos - this.delaySamples - chunkLen + REF_BUFFER_CAPACITY) % REF_BUFFER_CAPACITY;

    for (let i = 0; i < chunkLen; i++) {
      const micSample = micChunk[i];
      const refSample = this.refRingBuffer[readPos];
      readPos = (readPos + 1) % REF_BUFFER_CAPACITY;

      // Update FIR filter delay line
      this.refHistory.copyWithin(1, 0, this.filterLen - 1);
      this.refHistory[0] = refSample;

      // Compute estimated speaker bleed: y_hat[n] = w^T * x
      let yHat = 0;
      let refEnergy = 0;
      for (let k = 0; k < this.filterLen; k++) {
        const r = this.refHistory[k];
        yHat += this.weights[k] * r;
        refEnergy += r * r;
      }

      // Linear subtraction error: e[n] = mic[n] - y_hat[n]
      const err = micSample - yHat;

      // Double-Talk Detection (DTD):
      // Track short-term energy to detect if user is singing vs pure speaker echo
      this.micPower = 0.95 * this.micPower + 0.05 * (micSample * micSample);
      this.errPower = 0.95 * this.errPower + 0.05 * (err * err);
      this.refPower = 0.95 * this.refPower + 0.05 * (refSample * refSample);

      // If error power is significantly higher than reference estimate, user is singing.
      // Slow down filter adaptation to prevent cancelling the user's vocal pitch.
      const isDoubleTalk = this.errPower > 3.5 * (refEnergy * 0.1 + 1e-5);
      const step = isDoubleTalk ? this.mu * 0.02 : this.mu;

      const norm = step / (this.eps + refEnergy);
      for (let k = 0; k < this.filterLen; k++) {
        this.weights[k] += norm * err * this.refHistory[k];
      }

      // Residual spectral soft suppression during high speaker energy
      if (!isDoubleTalk && this.refPower > 1e-4 && this.errPower < this.refPower * 0.5) {
        outChunk[i] = err * 0.4;
      } else {
        outChunk[i] = err;
      }
    }

    return outChunk;
  }

  /** Reset internal filter state */
  reset() {
    this.weights.fill(0);
    this.refHistory.fill(0);
    this.refRingBuffer.fill(0);
    this.refWritePos = 0;
    this.totalRefReceived = 0;
    this.micPower = 0;
    this.errPower = 0;
    this.refPower = 0;
  }
}
