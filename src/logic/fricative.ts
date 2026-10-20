// fricative.js — hissed consonants (s, f, sch, t, k, …) in the raw microphone signal.
//
// The pitch model only hears voiced sound, so the consonants of a word earn
// nothing: a rap line loses every "s" and "t", a sung syllable its start.
// This finds them the way SingStar's rap scoring did (US7674181B2, the
// description, not its claims): cut the signal into 128-sample frames and
// compare how much it changes over 3 samples with how much over 12. A vowel
// is smooth (its energy is low, v3 ≪ v12); a hiss is rough, with most energy
// at 4–10 kHz, so v3 comes close to v12 or passes it.
//
// It has to run on the native-rate input (48 kHz): the 16 kHz copy the pitch
// model reads has nothing above 8 kHz left. Frames count only when they are
// well above a quiet-frame floor that follows the room, so steady hiss and
// fans do not; drum hits from a TV still pass now and then (about 2 % of
// windows in the bleed test), so the server credits these frames only where
// a consonant makes sense (see scoreNote in the backend).
//
// Thresholds were tuned offline on real recordings (pitchlab/exp_fric).

export const FRAME_SAMPLES = 128;
const ROUGH = 0.9;               // v3 / v12 at or above this: fricative
const MARGIN = 4;                // v3 must be this many times the quiet-frame floor
const MIN_LEVEL = 0.0005;        // and at least this (digital silence, dither)
const FLOOR_UP_PER_S = 0.5;      // the floor creeps up slowly (log units per second)…
const FLOOR_DOWN_PER_S = 20;     // …and drops fast to a quieter frame
const WINDOW_SECONDS = 0.03;     // a pitch window's newest hop (HOP_SAMPLES at 16 kHz)
export const MIN_FRAMES = 3;     // fricative frames in that hop to flag the window

export function createFricativeDetector(sampleRate = 48000) {
  const up = FLOOR_UP_PER_S * FRAME_SAMPLES / sampleRate;
  const down = FLOOR_DOWN_PER_S * FRAME_SAMPLES / sampleRate;
  const frames = Math.max(1, Math.round(WINDOW_SECONDS * sampleRate / FRAME_SAMPLES));
  const recent = new Uint8Array(frames); // 1 = fricative, a ring of the newest frames
  let ringPos = 0;
  const hist = new Float32Array(12);     // the 12 samples before the current frame
  const frame = new Float32Array(FRAME_SAMPLES);
  let filled = 0;
  let logFloor = null;

  const classify = () => {
    let s0 = 0, s3 = 0, s12 = 0;
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const x = frame[i];
      const x3 = i >= 3 ? frame[i - 3] : hist[i + 9];
      const x12 = i >= 12 ? frame[i - 12] : hist[i];
      s0 += Math.abs(x);
      s3 += Math.abs(x - x3);
      s12 += Math.abs(x - x12);
    }
    hist.set(frame.subarray(FRAME_SAMPLES - 12));
    const v3 = s3 / FRAME_SAMPLES, v12 = s12 / FRAME_SAMPLES;
    const lv = Math.log(Math.max(v3, 1e-7));
    if (logFloor === null) logFloor = lv;
    else if (lv < logFloor) logFloor = Math.max(lv, logFloor - down);
    else logFloor = Math.min(lv, logFloor + up);
    const loud = v3 >= MARGIN * Math.exp(logFloor) && v3 >= MIN_LEVEL;
    return loud && v3 >= ROUGH * v12 ? 1 : 0;
  };

  return {
    /** Feed samples[from, to) (native rate). Complete frames are classified as they fill. */
    push(samples, from = 0, to = samples.length) {
      for (let i = from; i < to; i++) {
        frame[filled++] = samples[i];
        if (filled === FRAME_SAMPLES) {
          recent[ringPos] = classify();
          ringPos = (ringPos + 1) % frames;
          filled = 0;
        }
      }
    },
    /** Fricative frames among the complete frames of the last 30 ms. */
    recentFrames() {
      let n = 0;
      for (let i = 0; i < frames; i++) n += recent[i];
      return n;
    },
    /** 1 if the last 30 ms hold a consonant (what a pitch window reports), else 0. */
    flag() {
      return this.recentFrames() >= MIN_FRAMES ? 1 : 0;
    },
    /** After a pause: forget the recent frames (the floor stays: same room). */
    reset() {
      recent.fill(0);
      filled = 0;
      hist.fill(0);
    },
  };
}
