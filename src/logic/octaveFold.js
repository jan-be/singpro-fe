/**
 * Octave folding for the note display.
 *
 * UltraStar charts are octave-agnostic (the same song is often written an
 * octave away from how it is actually sung), so sung pitches are shown
 * folded into the octave of the chart. Folding each note independently to
 * the octave nearest some reference makes a held note that sits ~6 semitones
 * from that reference flip between octaves as it wobbles — visible "bumps and
 * drops by an octave" that the detector never produced.
 *
 * chooseOctaveShift() therefore decides the shift once per sung phrase and
 * keeps it while the raw pitch stays continuous (or the singer stays in the
 * same register across a short gap), and picks a fresh shift toward the note
 * being sung, falling back to the line's midpoint.
 */

/** Offset in semitones that folds `raw` nearest to `target` (a multiple of 12). */
export const shiftToward = (raw, target) => Math.round((target - raw) / 12) * 12;

const CONTINUOUS_SEMITONES = 3;   // raw pitch this close to the previous note = same phrase (vibrato, slides)
const SAME_REGISTER_SECONDS = 2;  // across a gap this short, keep the previous shift if the register matches

/**
 * @param {object} args
 * @param {number} args.raw           raw detected semitone
 * @param {number} args.videoTime     time of this note (s)
 * @param {number|undefined} args.expectedTone  chart tone being sung at this time, if any
 * @param {number} args.midTone       middle of the line's tone range (fallback target)
 * @param {{ raw: number, videoTime: number, shift: number }|null} args.prev  previous note of the same player (chronological)
 * @returns {number} semitone shift to add to `raw` for display (multiple of 12)
 */
export function chooseOctaveShift({ raw, videoTime, expectedTone, midTone, prev }) {
  if (prev) {
    const dt = videoTime - prev.videoTime;
    const sameRegister = Math.abs(raw - prev.raw) <= CONTINUOUS_SEMITONES;
    if (sameRegister && dt >= 0 && dt <= SAME_REGISTER_SECONDS) return prev.shift;
  }
  return shiftToward(raw, expectedTone !== undefined ? expectedTone : midTone);
}
