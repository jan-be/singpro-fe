// pitchModel.js — what both pitch workers share about swift-f0's output.

export const WINDOW_SAMPLES = 960; // 60 ms at 16 kHz, the window MicrophoneInput feeds
// A new window every 30 ms. How often the voice is sampled does not change the
// score (each note counts for the time since the previous one), so this is the
// cheapest rate that keeps scores steady: half the model calls of the 15 ms it
// used to be. PitchFinderWorklet.js keeps its own copy of the constant.
export const HOP_SAMPLES = 480;

// swift-f0 constants (from core.py)
export const CONFIDENCE_THRESHOLD = 0.85;
export const MIN_PITCH_HZ = 46.875;
export const MAX_PITCH_HZ = 2093.75;

/**
 * The pitch of the most recent frame (swift-f0 returns one per STFT frame,
 * hop 256 at 16 kHz ≈ 16 ms), or 0 unless the model is confident and the
 * value is in the singing range. Every window on its own; the workers use
 * createVoicingTracker, which also looks at the windows before.
 */
export function pickPitch(pitchHz, confidence) {
  const n = pitchHz?.length ?? 0;
  if (!n) return 0;
  const p = pitchHz[n - 1];
  return confidence[n - 1] >= CONFIDENCE_THRESHOLD && p >= MIN_PITCH_HZ && p <= MAX_PITCH_HZ ? p : 0;
}

export const VOICING = {
  hi: CONFIDENCE_THRESHOLD, // a window starts a pitch at this confidence, as pickPitch
  strict: 0.95,  // …but below this it must continue one (the previous window or its own earlier frame)
  continueSt: 1, // semitones for that continuation
  continueS: 0.035, // s: how old the previous accepted window may be
  anchor: 0.98,  // a window this confident anchors a hold
  holdS: 0.3,    // s: the hold after the last anchor
  holdSt: 2,     // semitones from the anchor pitch while holding (octave-folded, like the score)
  holdMin: 0.2,  // confidence still accepted while holding; below it the model's pitch is noise
  bridgeS: 0.07, // s: a window below `hi` needs an accepted window this recently: it may bridge a
                 // miss or two but never start a note (a consonant or breath drawn as the note's
                 // start, early; lone low-confidence windows drawn as dots)
  phraseS: 2,    // s: the phrase window (0 turns the phrase rule off)
  phraseAnchorS: 0.6, // s of anchor windows within phraseS that make a phrase
  phraseMin: 0.5, // confidence accepted inside a phrase
  spanCapS: 0.05, // s: an anchor counts for the time since the previous window, at most this
};

const semitones = hz => 12 * Math.log2(hz / 440);
const inRange = p => p >= MIN_PITCH_HZ && p <= MAX_PITCH_HZ;

/**
 * The voicing decision for a stream of windows, replacing pickPitch.
 *
 * swift-f0 judges every 60 ms window alone, and a sung phrase loses each
 * window where the model wavers below 0.85: fast rap and soft or breathy
 * singing most of all. The tracker keeps listening for a moment after a window
 * it is sure of, and asks borderline windows to continue something, which is
 * what separates a voice from instruments:
 *   1. entry  confidence ≥ 0.85, but a window below 0.95 must continue the
 *             previous accepted window (≤ 35 ms, ≤ 1 semitone) or agree with
 *             its own second-to-last frame (≥ 0.85, ≤ 1 semitone). Lone
 *             borderline hits are mostly instruments.
 *   2. hold   for 0.3 s after an anchor (confidence ≥ 0.98): confidence ≥ 0.2
 *             within 2 semitones of the anchor's pitch, octave-folded.
 *   3. phrase with ≥ 0.6 s of anchors in the last 2 s: confidence ≥ 0.5.
 * Rules 2 and 3 only continue a note: a window below 0.85 needs an accepted
 * window within the last 70 ms, so they bridge a miss or two but never start
 * a note on a consonant or a breath (which drew notes starting early) or
 * stand alone (drawn as dots).
 * It only looks at this and earlier windows and always reports this window's
 * own last-frame pitch, so notes keep their time. Measured on real recordings
 * with the level calibration: singers 6/6 better on a held-out set (+279 on
 * average), note starts as early as before, no more false pitches on music
 * without a voice than pickPitch.
 *
 * `t` is the window's time in seconds on a clock that runs with the audio
 * (MicrophoneInput's chunk clock), not performance.now(): windows reach the
 * worker in bursts.
 */
export function createVoicingTracker(options = {}) {
  const P = { ...VOICING, ...options };
  let anchorT = -Infinity, anchorSt = 0; // last anchor window
  let lastT = -Infinity, lastSt = 0;     // last accepted window
  let prevT = null;                      // previous window seen
  let anchors = [];                      // [t, span] of anchors within phraseS, oldest first
  let head = 0;
  let anchorSum = 0;

  return {
    /** swift-f0's frames for one window (last = newest) → Hz, or 0 for no pitch. */
    pick(pitchHz, confidence, t) {
      const n = pitchHz?.length ?? 0;
      if (!n) return 0;
      const span = prevT === null ? P.spanCapS : Math.min(t - prevT, P.spanCapS);
      prevT = t;
      if (P.phraseS) {
        while (head < anchors.length && t - anchors[head][0] > P.phraseS) anchorSum -= anchors[head++][1];
        if (head > 512) { anchors = anchors.slice(head); head = 0; }
      }
      const p = pitchHz[n - 1];
      const c = confidence[n - 1];
      if (!inRange(p)) return 0;
      const st = semitones(p);

      let ok = false;
      if (c >= P.hi) { // 1. entry
        ok = true;
        if (c < P.strict) {
          ok = t - lastT <= P.continueS + 1e-9 && Math.abs(st - lastSt) <= P.continueSt;
          if (!ok && n >= 2) {
            const p1 = pitchHz[n - 2];
            ok = confidence[n - 2] >= P.hi && inRange(p1) && Math.abs(semitones(p1) - st) <= P.continueSt;
          }
        }
      }
      const bridges = c >= P.hi || t - lastT <= P.bridgeS + 1e-9; // unsure windows only continue a note
      if (!ok && bridges && c >= P.holdMin && t - anchorT <= P.holdS + 1e-9) { // 2. hold
        let d = st - anchorSt;
        d -= Math.round(d / 12) * 12;
        ok = Math.abs(d) <= P.holdSt;
      }
      if (!ok && bridges && P.phraseS && c >= P.phraseMin && anchorSum >= P.phraseAnchorS - 1e-9) ok = true; // 3. phrase
      if (!ok) return 0;

      lastT = t;
      lastSt = st;
      if (c >= P.anchor) {
        anchorT = t;
        anchorSt = st;
        if (P.phraseS) { anchors.push([t, span]); anchorSum += span; }
      }
      return p;
    },
  };
}
