// levelCalibration.js — makes a quiet microphone count like a loud one.
//
// swift-f0 has no input normalisation: the same voice at a tenth of the level
// gets markedly less confident pitches, and the voice level of real phones
// differs thirty-fold (a phone held far away, a quiet singer, a low-gain
// mic). This tracks the level of windows the model is very sure are a voice
// and boosts the model's input toward a common voice level:
//   - slowly (a median in log units that moves a little per sure window), so
//     pauses and music between lines do not pull it around;
//   - only upwards (turning loud mics down cost them points);
//   - from windows with confidence ≥ 0.95 only, which instruments reach half
//     as often as a voice.
// Measured on real recordings together with the voicing tracker: held-out
// singers +317 on average instead of +183 with the tracker alone, with a
// little more quiet speaker music let through on quiet phones (+1 point).
// The gate and the volume the app shows stay on the raw level.

import { MIN_PITCH_HZ, MAX_PITCH_HZ } from './pitchModel';

export const VOICE_TARGET = 0.15;   // window RMS a voice is boosted toward
const STEP_PER_15MS = 0.005;        // log units per sure window at a 15 ms step (±0.0025 around the median)
export const UPDATE_CONFIDENCE = 0.95;
export const MAX_GAIN = 30;         // never more than +29.5 dB

/**
 * @param {{ stepSeconds?: number }} [options] time between windows; the step is
 *   scaled so the calibration adapts at the same speed per second
 */
export function createLevelCalibration({ stepSeconds = 0.015 } = {}) {
  const step = STEP_PER_15MS * (stepSeconds / 0.015);
  let voiceLog = Math.log(VOICE_TARGET); // log of the tracked voice level: starts at gain 1

  return {
    /** The factor for the next window's samples (1 … MAX_GAIN). */
    gain() {
      return Math.min(MAX_GAIN, Math.max(1, VOICE_TARGET / Math.exp(voiceLog)));
    },
    /**
     * A window's answer: its raw level and the model's own last frame
     * (before the voicing tracker). Only sure voice windows move the level.
     */
    update({ volume, pitchHz, confidence }) {
      if (!(volume > 0) || !(confidence >= UPDATE_CONFIDENCE) || !(pitchHz >= MIN_PITCH_HZ && pitchHz <= MAX_PITCH_HZ)) return;
      voiceLog += step * (0.5 - (Math.log(volume) < voiceLog ? 1 : 0));
    },
  };
}
