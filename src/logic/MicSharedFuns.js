// MicSharedFuns.js — Shared constants and utilities for mic pitch detection.
// The actual pitch detection is now done by swift-f0 ONNX in PitchWorker.js.

// AudioContext sample rate — matches swift-f0's native 16kHz so no resampling needed.
// The browser downsamples from the hardware rate (usually 48kHz) to 16kHz automatically.
export const sampleSize = 1280; // 80ms at 16kHz — sufficient for swift-f0 (needs ≥256 samples)

// Minimum absolute RMS threshold — below this is definitely silence/digital noise.
// The real-time pipeline uses an adaptive noise gate (see MicrophoneInput.js) that
// tracks ambient noise and sets the gate dynamically. This constant is the absolute
// floor — even the adaptive gate won't go below this.
export const RMS_SILENCE_FLOOR = 0.002;

// Legacy alias for tests and pitchHzToNote safety check
export const RMS_SILENCE_THRESHOLD = RMS_SILENCE_FLOOR;

// Convert frequency (Hz) to MIDI note number
export const noteIntFromPitch = frequency => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
};

// Convert pitch Hz from swift-f0 to an UltraStar-compatible note value.
// Returns 0 for silence / no pitch.
export const pitchHzToNote = (pitchHz, volume) => {
  if (volume < RMS_SILENCE_THRESHOLD || pitchHz <= 0) return 0;

  const midiNote = noteIntFromPitch(pitchHz);
  // Convert MIDI to UltraStar space (offset -36)
  const note = (midiNote >= 0 && midiNote < 200) ? midiNote - 36 : 0;
  return note;
};

// Resample audio from sourceSR to targetSR using linear interpolation.
// Returns a new Float32Array at the target sample rate.
// Kept for tests that decode MP3s at arbitrary rates.
export const resample = (audioIn, sourceSR, targetSR) => {
  if (sourceSR === targetSR) return audioIn;

  const ratio = sourceSR / targetSR;
  const outLen = Math.ceil(audioIn.length / ratio);
  const out = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, audioIn.length - 1);
    const frac = srcIdx - lo;
    out[i] = audioIn[lo] * (1 - frac) + audioIn[hi] * frac;
  }

  return out;
};

// --- Adaptive noise gate ---
// Tracks ambient noise floor via exponential moving average.
// Gates frames where RMS < noiseFloor * GATE_MULTIPLIER.
// This makes pitch detection insensitive to microphone gain level.
// swift-f0's own confidence threshold (0.85) already rejects non-pitched
// audio, so the gate only needs to avoid sending obviously silent frames
// to the ONNX worker. Err on the side of letting audio through.
const GATE_MULTIPLIER = 2.0;       // frame must be 2x noise floor to be "signal"
const NOISE_FLOOR_ATTACK = 0.02;   // how fast noiseFloor rises (slow — resist transients)
const NOISE_FLOOR_DECAY = 0.05;    // how fast noiseFloor drops (~1-2s recovery from spikes)
const NOISE_FLOOR_CAP = 0.04;      // max noise floor — prevents loud transients from
                                    // raising the threshold so high that voice can't clear it.
                                    // Normal ambient is 0.005–0.02, voice is 0.03+.
                                    // Cap at 0.04 → max threshold = 0.08, easily cleared by voice.
const CALIBRATION_FRAMES = 8;      // first N frames seed noise floor (~640ms at 80ms/frame)

export function createNoiseGate() {
  let noiseFloor = 0;
  let frameCount = 0;

  return {
    /** Returns true if the frame should be GATED (i.e., is below the noise threshold). */
    shouldGate(rms) {
      frameCount++;

      // Calibration phase: seed noise floor from early frames
      if (frameCount <= CALIBRATION_FRAMES) {
        noiseFloor = noiseFloor === 0 ? rms : noiseFloor + (rms - noiseFloor) * 0.3;
        noiseFloor = Math.min(noiseFloor, NOISE_FLOOR_CAP);
        return true; // gate during calibration
      }

      const threshold = Math.max(RMS_SILENCE_FLOOR, noiseFloor * GATE_MULTIPLIER);

      if (rms < threshold) {
        // Quiet frame: update noise floor estimate
        // Asymmetric smoothing: rise slowly (resist transient aftershock),
        // decay faster (recover quickly when noise subsides)
        const alpha = rms > noiseFloor ? NOISE_FLOOR_ATTACK : NOISE_FLOOR_DECAY;
        noiseFloor += (rms - noiseFloor) * alpha;
        noiseFloor = Math.min(noiseFloor, NOISE_FLOOR_CAP);
        return true; // gated
      }

      return false; // signal detected, do NOT gate
    },

    getNoiseFloor() { return noiseFloor; },
  };
}
