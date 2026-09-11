import { describe, it, expect } from 'vitest';
import { foldNotes, shiftToward } from './octaveFold.js';

/** notes: [videoTime, raw, target?] → displayed semitones */
const show = (notes, midTone = 8) => {
  const list = notes.map(([videoTime, raw, target]) => ({ videoTime, raw, target }));
  const shifts = foldNotes(list, { midTone });
  return list.map((n, i) => n.raw + shifts[i]);
};
/** number of octave jumps between consecutive displayed notes */
const jumps = (shown) => shown.filter((s, i) => i > 0 && Math.abs(s - shown[i - 1]) >= 6).length;
const run = (raws, target, t0 = 0) => raws.map((raw, i) => [t0 + i * 0.06, raw, target]);

describe('shiftToward', () => {
  it('folds to the octave nearest the target', () => {
    expect(shiftToward(27, 8)).toBe(-24);   // 27 → 3 (15 would be further from 8)
    expect(shiftToward(20, 8)).toBe(-12);   // 20 → 8
    expect(shiftToward(8, 8)).toBe(0);
    expect(shiftToward(2, 20)).toBe(24);
  });
});

describe('foldNotes', () => {
  it('a note sung in tune always lands on its own target, whatever came before', () => {
    // First two notes are a scoop from an octave below; the rest sit on the target.
    const notes = [[0, 9, 20], [0.06, 12, 20], ...run(Array.from({ length: 10 }, (_, i) => 20 + (i % 2) * 0.3), 20, 0.12)];
    const shown = show(notes);
    expect(shown.slice(2).every(s => Math.abs(s - 20) < 1)).toBe(true);
  });

  it('a singer an octave below the chart is shown on the bars', () => {
    const notes = Array.from({ length: 8 }, (_, i) => [i * 0.06, 8 + (i % 3), 20 + (i % 3)]);
    const shown = show(notes);
    expect(shown.every((s, i) => Math.abs(s - notes[i][2]) < 0.01)).toBe(true);
  });

  it('a held note wobbling around a tritone from its target does not flip octaves', () => {
    // 25.9 / 26.1 with target 20: per-note folding would give 25.9 and 14.1 alternately
    expect(jumps(show(run([25.9, 26.1, 25.8, 26.2, 26.0, 25.7, 26.3], 20)))).toBe(0);
    expect(jumps(show(run([26.1, 25.9, 26.2, 25.8], 20)))).toBe(0);
  });

  it('an ambiguous scoop takes the octave of the in-tune note that follows it', () => {
    // 25.5 is 5.5 above 20 (ambiguous); the voice then settles on 21 (in tune)
    const shown = show(run([25.5, 24, 22.5, 21, 21, 21], 20));
    expect(shown[0]).toBeCloseTo(25.5, 5); // same octave as the anchors, not folded down to 13.5
    expect(jumps(shown)).toBe(0);
  });

  it('a held note stays continuous when the bar under it changes', () => {
    // singer holds ~12.5; the chart goes 18 → 14, so the first half is ambiguous
    // (5.6 below 18) and the second half in tune. No octave jump in between.
    const notes = [...run([12.4, 12.4, 12.5], 18), ...run([12.5, 12.5, 12.4], 14, 0.18)];
    const shown = show(notes);
    expect(jumps(shown)).toBe(0);
    expect(shown[5]).toBeCloseTo(12.4, 5);
  });

  it('an ambiguous tail keeps the previous anchor\'s octave, even once a later anchor exists', () => {
    const anchorsThenTail = [...run([20, 20, 20], 20), ...run([25.5, 25.6], 20, 0.18)];
    const first = show(anchorsThenTail);
    expect(first[4]).toBeCloseTo(25.6, 5);
    // the voice continues and lands an octave up on 32: nothing already drawn is repainted
    const later = [...anchorsThenTail, ...run([27.8, 30, 32], 32, 0.3)];
    const second = show(later);
    expect(second.slice(0, 5)).toEqual(first);
    expect(jumps(second)).toBe(0); // 25.5 → 25.6 → 27.8 → 30 → 32
  });

  it('a run that slides into tune is drawn continuous with where it lands', () => {
    // 28.5 folds to 16.5 (3.5 below 20: an anchor); the ambiguous notes before it
    // are drawn in that octave too, rather than an octave up with a jump at the end
    const shown = show(run([25.5, 26.5, 27.5, 28.5], 20));
    expect(jumps(shown)).toBe(0);
    expect(shown[0]).toBeCloseTo(13.5, 5);
    expect(shown[3]).toBeCloseTo(16.5, 5);
  });

  it('a run with no anchor at all keeps the octave of its first note', () => {
    const shown = show(run([25.5, 26.0, 25.5, 25.9, 26.2, 25.7], 20));
    expect(jumps(shown)).toBe(0);
    expect(shown[0]).toBeCloseTo(25.5, 5);
  });

  it('a pause or a register change starts a new run', () => {
    const held = run([26.2, 26.2], 20);
    // after 1.5 s of silence the ambiguous note folds on its own (26.2 → 26.2, 6.2 above rounds toward 26.2? no: 26.2-20=6.2 → -12 → 14.2)
    expect(show([...held, [1.6, 26.2, 20]])[2]).toBeCloseTo(14.2, 5);
    // a leap of more than 3 st is not the same continuous voice either
    expect(show([...held, [0.12, 22.8, 20]])[2]).toBeCloseTo(22.8, 5);
  });

  it('notes with no chart note nearby fold toward the line midpoint', () => {
    expect(show([[0, 20], [0.06, 20.2]])).toEqual([8, 8.2]);
  });

  it('a melody leap of an octave is followed by the display (the note stays on its bar)', () => {
    // The chart jumps an octave; the singer keeps the pitch class. The score
    // counts that as a hit, so the display keeps the note on the target too.
    const notes = [...run([20, 20, 20, 20], 20), ...run([20, 20, 20], 32, 0.24)];
    const shown = show(notes);
    expect(shown[0]).toBe(20);
    expect(shown[6]).toBe(32);
  });
});
