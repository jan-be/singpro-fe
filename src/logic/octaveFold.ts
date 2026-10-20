/**
 * Octave folding for the note display.
 *
 * UltraStar charts are octave-agnostic (a song is often written an octave away
 * from how it is sung), so a sung pitch is shown in the octave nearest to the
 * chart note it is aiming at — the same folding the score uses. Two ways of
 * doing that failed visibly:
 *   - folding every note independently toward the *line's midpoint* made held
 *     notes that sit ~6 semitones from that midpoint flip back and forth;
 *   - locking the octave from the first note of a phrase painted the whole
 *     phrase wrong whenever that first note was a scoop or a blip.
 *
 * foldNotes() folds each note toward its own target note. A note sung close to
 * its bar ("anchor") always lands on it and cannot be dragged into the wrong
 * octave by its neighbours. Only a genuinely ambiguous note — near a tritone
 * from its target, where both candidate octaves are almost equally close — takes
 * the octave of an anchor in the same continuous run of voice: the previous
 * anchor if there is one, otherwise the next one. The display is recomputed
 * every frame over the whole line, so looking forwards is possible; it keeps a
 * scoop, or a held note whose bar changes underneath it, continuous with the
 * in-tune note that follows.
 */

/** Offset in semitones (multiple of 12) that folds `raw` nearest to `target`. */
export const shiftToward = (raw, target) => Math.round((target - raw) / 12) * 12;

/** A note closer than this to its target (after its own folding) is an anchor; further away it is ambiguous. */
export const AMBIGUOUS_SEMITONES = 4;
/** An ambiguous note takes a neighbour's octave only while that keeps it within this distance of its target. */
const INHERIT_MAX_SEMITONES = 8;
/** Raw pitch this close to the previous note = the same continuous voice. */
const CONTINUOUS_SEMITONES = 3;
/** Notes further apart in time than this start a new run. */
const CONTINUOUS_SECONDS = 1;
/** How far ahead an ambiguous note may look for an anchor when none precedes it in its run. */
const LOOKAHEAD_SECONDS = 1;

/**
 * @param {Array<{ raw: number, videoTime: number, target?: number }>} notes
 *        one player's visible notes in chronological order; `target` is the
 *        chart tone the note is aiming at (nearest syllable), if any
 * @param {object} opts
 * @param {number} opts.midTone  fallback target for notes with no chart note nearby
 * @returns {number[]} shift per note (multiples of 12)
 */
export function foldNotes(notes, { midTone }) {
  const n = notes.length;
  const shifts = new Array(n);
  const targets = new Array(n);
  const own = new Array(n);      // each note's own fold
  const isAnchor = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = notes[i].target !== undefined ? notes[i].target : midTone;
    targets[i] = t;
    own[i] = shiftToward(notes[i].raw, t);
    isAnchor[i] = Math.abs(notes[i].raw + own[i] - t) < AMBIGUOUS_SEMITONES;
  }

  const fits = (i, shift) => Math.abs(notes[i].raw + shift - targets[i]) <= INHERIT_MAX_SEMITONES;

  let start = 0;
  while (start < n) {
    let end = start + 1;
    while (end < n
      && Math.abs(notes[end].raw - notes[end - 1].raw) <= CONTINUOUS_SEMITONES
      && notes[end].videoTime - notes[end - 1].videoTime <= CONTINUOUS_SECONDS) end++;

    // Nearest anchor before / after each note of the run
    const before = new Array(end - start);
    const after = new Array(end - start);
    for (let i = start, last = -1; i < end; i++) { if (isAnchor[i]) last = i; before[i - start] = last; }
    for (let i = end - 1, next = -1; i >= start; i--) { if (isAnchor[i]) next = i; after[i - start] = next; }

    let prevShift; // chained fallback for stretches with no usable anchor
    for (let i = start; i < end; i++) {
      let shift;
      const b = before[i - start], a = after[i - start];
      if (isAnchor[i]) shift = own[i];
      else if (b >= 0 && fits(i, own[b])) shift = own[b];
      else if (a >= 0 && notes[a].videoTime - notes[i].videoTime <= LOOKAHEAD_SECONDS && fits(i, own[a])) shift = own[a];
      else if (prevShift !== undefined && fits(i, prevShift)) shift = prevShift;
      else shift = own[i];
      shifts[i] = shift;
      prevShift = shift;
    }
    start = end;
  }
  return shifts;
}
