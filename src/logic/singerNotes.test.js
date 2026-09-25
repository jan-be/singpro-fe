import { describe, it, expect } from 'vitest';
import { graceIntervals, inIntervals, singerNotesOnLine } from './singerNotes.js';

const TPS = 4; // ticks per second: a one-second grace is 4 ticks

/** A part with the given notes on one line: lyricLines[0] = [line marker, ...notes], lyricRefs per tick. */
function part(notes) {
  const line = [{ start: notes[0]?.start ?? 0 }, ...notes.map(n => ({ ...n, isBreak: false }))];
  const lyricRefs = [];
  notes.forEach((n, j) => {
    for (let t = n.start; t < n.start + n.length; t++) lyricRefs[t] = { lineIndex: 0, syllableIndex: j + 1, isSilent: false };
  });
  return { lyricLines: [line], lyricRefs, grace: graceIntervals(line.slice(1), TPS) };
}

const at = (tick, freq = 440) => ({ videoTime: tick / TPS, freq }); // the song plays at gap 0
const line = { lineStartTick: 0, lastLineTick: 40, ticksPerSec: TPS, gapSec: 0 };

describe('graceIntervals', () => {
  it('merges the windows around neighbouring notes and keeps distant ones apart', () => {
    const grace = graceIntervals([{ start: 10, length: 4 }, { start: 16, length: 2 }, { start: 30, length: 2 }], 4);
    expect(grace).toEqual([[6, 22], [26, 36]]);
    expect([5, 6, 22, 23, 26, 36, 37].map(t => inIntervals(grace, t))).toEqual([false, true, true, false, true, true, false]);
  });
});

describe('singerNotesOnLine', () => {
  it('shows a singer within a second of a note of their part, hides them in its quiet stretches', () => {
    const p1 = part([{ start: 10, length: 4, tone: 5 }, { start: 30, length: 2, tone: 7 }]);
    const notes = [at(-8), at(8), at(12), at(12, 0), at(22), at(33), at(45)];
    const visible = singerNotesOnLine(notes, { chart: p1, grace: p1.grace, ...line });
    expect(visible.map(v => [v.tf, v.target])).toEqual([[8, 5], [12, 5], [33, 7]]);
    expect(visible.map(v => v.raw)).toEqual([33, 33, 33]);
    expect(notes[1].st).toBe(33); // the semitone is cached on the note
  });

  it("a duet's second singer is shown along the second part while the first part rests", () => {
    const p1 = part([]); // a line the first part sits out
    const p2 = part([{ start: 10, length: 4, tone: 9 }]);
    const notes = [at(10), at(12)];
    const second = singerNotesOnLine(notes, { chart: p2, grace: p2.grace, ...line });
    expect(second.map(v => [v.tf, v.target])).toEqual([[10, 9], [12, 9]]);
    const first = singerNotesOnLine(notes, { chart: p1, grace: p1.grace, ...line });
    expect(first).toEqual([]);
  });
});
