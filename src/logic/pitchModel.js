// pitchModel.js — what both pitch workers share about swift-f0's output.

export const WINDOW_SAMPLES = 960; // 60 ms at 16 kHz, the window MicrophoneInput feeds

// swift-f0 constants (from core.py)
export const CONFIDENCE_THRESHOLD = 0.85;
export const MIN_PITCH_HZ = 46.875;
export const MAX_PITCH_HZ = 2093.75;

/**
 * The pitch of the most recent frame (swift-f0 returns one per STFT frame,
 * hop 256 at 16 kHz ≈ 16 ms), or 0 unless the model is confident and the
 * value is in the singing range.
 */
export function pickPitch(pitchHz, confidence) {
  const n = pitchHz?.length ?? 0;
  if (!n) return 0;
  const p = pitchHz[n - 1];
  return confidence[n - 1] >= CONFIDENCE_THRESHOLD && p >= MIN_PITCH_HZ && p <= MAX_PITCH_HZ ? p : 0;
}
