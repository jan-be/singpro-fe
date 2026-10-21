// singingGate.ts — tells a singer from people talking near the microphone, so
// talk neither scores nor draws lines on the note highway.
//
// The pitch detector hears any voice (pitchModel.ts), and a voice that talks
// lands within a semitone of the note, octave-folded, about a quarter of the
// time: with nobody singing, talking near a mic earned points and drew lines.
// No single window tells talking from singing (a classifier on each window's
// sound and pitch separated them at AUC 0.82, far too weak), but the last few
// seconds do, measured against the chart. A singer follows the song: voiced on
// its notes and quiet in the rests between lines, often in tune, the pitch
// stepping the way the melody steps and steady within each window. Talking
// goes on regardless of the chart, at chance on the notes, and glides.
//
// The gate keeps those tallies, fading with a 20 s time constant of song time,
// and weighs them with a logistic model fitted offline (speechgate lab: 122
// real recordings against meeting speech mixed into 24 songs' instrumentals at
// the levels real recordings have, near and across the room). It is open while
// the chance of singing is at least 0.1 and closes below 0.02. While closed it
// holds the windows back: when it opens, the last 2 s count after all, so a
// singer's first notes after talking are not lost; older ones go on without
// their pitch. Rap notes always keep theirs (held in line with the others, so
// up to 2 s late while closed): rap is spoken, and there talking and rapping
// look alike (gating rap notes cost rappers up to 500 points).
//
// Measured on the replayed recordings (models fitted without the song): singers
// median 0, mean -7, worst -277 (a recording that is mostly the speakers);
// talking through a whole song without rap: -91 % of its points, -89 % of its
// drawn line. Talking between a singer's own lines is mostly kept: the gate
// stays open while the song is being sung.

import type { LyricLine, LyricNote, LyricRef } from './LyricsParser';

const TAU_S = 20;            // s: how fast the evidence fades
const OPEN_P = 0.1;          // the gate opens at this chance of singing...
const CLOSE_P = 0.02;        // ...and closes below this one
export const RETRO_S = 2;    // s: held windows that count when the gate opens
const REST_MARGIN_S = 0.4;   // s: a rest is at least this far from every note
const REWIND_S = 1;          // s: song time going back further is a rewind (noteScoring.ts)
const HISTORY_S = 6;         // s: voiced pitches kept for the melody steps

// Melody steps between two sung notes of a line (both at least MIN_NOTE_S long,
// at most MAX_GAP_S apart): the voice's pitch at the end of the first (its last
// TAIL_S, at most 70 % of the note) against the start of the second (from 30 %
// in, TAIL_S long), each the median of at least two voiced windows.
const MIN_NOTE_S = 0.12;
const MAX_GAP_S = 0.6;
const TAIL_S = 0.35;

// The model: p = 1 / (1 + exp(-(B + sum W[f] * feature f))). Features, each a
// share with a weak prior so an empty tally reads as "no idea":
//   onShare    voiced share of the windows on notes
//   restShare  voiced share of the windows in rests
//   logRestN   log(1 + rest windows): how much the rest share has seen
//   hitShare   in-tune share (±1 semitone, octave-folded) of the voiced note windows
//   agree      melody steps of 2+ semitones the voice took the same way (and 0.5+ st far)
//   logAgreeN  log(1 + those steps)
//   sameAgree  repeated tones the voice repeated (within a semitone)
//   pstep      mean pitch change from the window before (st, 1 after an unvoiced one, at most 3)
//   pwithin    mean pitch change across a window's own frames (st, at most 3)
// Fitted 2026-10-17, speechgate/train_final.py (gate/final.model.json).
const B = -6.2153;
const W = {
  onShare: 16.174, restShare: -6.2694, logRestN: 0.3218, hitShare: 11.3491, agree: 5.503,
  logAgreeN: -0.2222, sameAgree: -1.0576, pstep: 1.3549, pwithin: -17.7894,
};

/** What prepareChart reads of a part (LyricData, or P2's TimedLyrics) */
export interface GateChartSource {
  bpm: number;
  lyricRefs?: readonly (LyricRef | undefined)[];
  lyricLines?: readonly LyricLine[];
}

/** The part a voice sings as the gate reads it: { bpm, gap, lyricRefs, lyricLines } */
export interface GateLyrics extends GateChartSource {
  /** ms */
  gap: number;
  lyricRefs: readonly (LyricRef | undefined)[];
}

/** A melody step between two sung notes of a line, in ticks; dc = the chart's step in semitones */
export interface MelodyStep {
  aFrom: number;
  aEnd: number;
  bFrom: number;
  bEnd: number;
  dc: number;
}

/** What the gate needs of a part's chart (prepareChart) */
export interface GateChart {
  bpm: number;
  /** ticks per second */
  tps: number;
  /** the sung note at a tick, or null */
  syllableAt: (tick: number) => LyricNote | null;
  /** 1 for ticks within the rest margin of a note */
  near: Uint8Array;
  firstTick: number;
  lastTick: number;
  /** in the order their second window ends */
  steps: MelodyStep[];
}

/**
 * A pitch window as the gate reads it: t its song time (s), freq the tracker's
 * pitch (Hz, 0 = none), fric, hzFirst/hzLast the model's first and last frame.
 * The gate passes windows on as they came (or copies with freq 0 and fric 0).
 */
export interface GateWindow {
  t: number;
  freq: number;
  fric?: number;
  hzFirst?: number;
  hzLast?: number;
}

/** The evidence about one voice (createSingingEvidence) */
export interface SingingEvidence {
  reset(): void;
  /**
   * One window: t its song time (s), freq the tracker's pitch (Hz, 0 = none),
   * hzFirst/hzLast the model's first and last frame. Returns the chance of singing.
   */
  push(chart: GateChart, gapMs: number, w: GateWindow): number;
}

/** The singing gate for one voice (createSingingGate) */
export interface SingingGate<W extends GateWindow = GateWindow> {
  readonly open: boolean;
  /** The chance of singing after the last window and the windows held (the debug panel). */
  readonly chance: number;
  readonly held: number;
  /** One window in; the windows to use now out, oldest first. No chart (lyricRefs): the window itself. */
  push(lyricData: GateLyrics | { lyricRefs?: null } | null | undefined, w: W): W[];
  /** Everything held, without its pitch (rap notes with theirs). */
  flush(): W[];
}

/** The tallies of the evidence, faded together */
interface Tallies {
  onV: number; onN: number; reV: number; reN: number; hit: number; agr: number; dis: number;
  same: number; sameN: number; vN: number; dst: number; within: number;
}

const semitone = (hz: number) => 12 * Math.log2(hz / 440);
const fold = (d: number) => d - Math.round(d / 12) * 12;

/** What the gate needs of a part's chart, worked out once per chart (lyricRefs) and tempo. */
const charts = new WeakMap<readonly (LyricRef | undefined)[], GateChart>();
export function prepareChart(lyricData: GateChartSource): GateChart {
  const { lyricRefs = [], lyricLines = [], bpm } = lyricData;
  const cached = charts.get(lyricRefs);
  if (cached && cached.bpm === bpm) return cached;
  const tps = bpm / 60;
  const syllableAt = (tick: number) => {
    const ref = lyricRefs[tick];
    const s = ref && !ref.isSilent ? lyricLines[ref.lineIndex]?.[ref.syllableIndex] : null;
    return s && !s.isBreak ? s : null;
  };
  const n = lyricRefs.length;
  const margin = Math.ceil(REST_MARGIN_S * tps);
  const near = new Uint8Array(n + margin + 1); // ticks within `margin` of a note
  let firstTick = -1, lastTick = -1;
  for (let i = 0; i < n; i++) {
    if (!syllableAt(i)) continue;
    if (firstTick < 0) firstTick = i;
    lastTick = i;
    for (let d = Math.max(0, i - margin); d <= i + margin; d++) near[d] = 1;
  }
  // The melody steps, in ticks, in the order their second window ends
  const steps: MelodyStep[] = [];
  for (const line of lyricLines) {
    const notes = line.filter(s => !s.isBreak && s.tone !== undefined);
    for (let i = 0; i + 1 < notes.length; i++) {
      const a = notes[i], b = notes[i + 1];
      if (a.isRap || b.isRap) continue;
      if (a.length < MIN_NOTE_S * tps || b.length < MIN_NOTE_S * tps || b.start - (a.start + a.length) > MAX_GAP_S * tps) continue;
      const aEnd = a.start + a.length, bFrom = b.start + 0.3 * b.length;
      steps.push({
        aFrom: aEnd - Math.min(TAIL_S * tps, 0.7 * a.length), aEnd,
        bFrom, bEnd: Math.min(b.start + b.length, bFrom + TAIL_S * tps),
        dc: b.tone - a.tone,
      });
    }
  }
  steps.sort((x, y) => x.bEnd - y.bEnd);
  const chart = { bpm, tps, syllableAt, near, firstTick, lastTick, steps };
  charts.set(lyricRefs, chart);
  return chart;
}

/** The median of voiced pitches (semitones) in one octave: each folded toward the first. */
function median(pitches: number[]): number | null {
  if (pitches.length < 2) return null;
  const f0 = pitches[0];
  const q = pitches.map(p => f0 + fold(p - f0)).sort((x, y) => x - y);
  return q[q.length >> 1];
}

/**
 * The evidence about one voice and the chance that it sings, window by window.
 * `chart` from prepareChart(); returns the chance for each window pushed.
 */
export function createSingingEvidence({ tau = TAU_S }: { tau?: number } = {}): SingingEvidence {
  let c: Tallies = null!; // tallies, faded together (reset() below sets them)
  let lastT: number | null = null;
  let prevSt: number | null = null; // the window before: its pitch (null: unvoiced)
  let step = 0;           // the next melody step to judge (index into chart.steps)
  let history: [number, number][] = []; // [t, semitone] of recent voiced windows
  const reset = () => {
    c = { onV: 0, onN: 0, reV: 0, reN: 0, hit: 0, agr: 0, dis: 0, same: 0, sameN: 0, vN: 0, dst: 0, within: 0 };
    lastT = null; prevSt = null; step = 0; history = [];
  };
  reset();

  /** The first step not yet judged at song time t (after a rewind or a jump) */
  const seek = (chart: GateChart, t: number, toTick: (x: number) => number) => {
    let lo = 0, hi = chart.steps.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (chart.steps[m].bEnd < toTick(t)) lo = m + 1; else hi = m; }
    step = lo;
  };

  return {
    reset,
    /**
     * One window: t its song time (s), freq the tracker's pitch (Hz, 0 = none),
     * hzFirst/hzLast the model's first and last frame. Returns the chance of singing.
     */
    push(chart, gapMs, { t, freq, hzFirst = 0, hzLast = 0 }) {
      const toTick = (x: number) => chart.tps * (x - gapMs / 1000);
      const toSec = (tick: number) => gapMs / 1000 + tick / chart.tps;
      if (lastT !== null && t < lastT - REWIND_S) { lastT = t; seek(chart, t, toTick); history = []; }
      if (lastT !== null && t > lastT) {
        const d = Math.exp(-(t - lastT) / tau);
        for (const k in c) c[k as keyof Tallies] *= d;
      }
      if (lastT === null) seek(chart, t, toTick);
      if (lastT === null || t > lastT) lastT = t;

      const voiced = freq > 0;
      const st = voiced ? semitone(freq) : null;
      const tick = Math.floor(toTick(t));
      const syllable = tick >= 0 ? chart.syllableAt(tick) : null;
      if (syllable) {
        c.onN++;
        if (voiced) {
          c.onV++;
          if (Math.abs(fold(st! + 33 - syllable.tone)) <= 1) c.hit++; // 33: UltraStar's semitone of 440 Hz
        }
      } else if (tick >= chart.firstTick && tick <= chart.lastTick && !chart.near[tick]) {
        c.reN++;
        if (voiced) c.reV++;
      }
      if (voiced) {
        c.vN++;
        c.dst += prevSt === null ? 1 : Math.min(Math.abs(st! - prevSt), 3);
        if (hzFirst > 0 && hzLast > 0) c.within += Math.min(Math.abs(semitone(hzLast) - semitone(hzFirst)), 3);
        history.push([t, st!]);
        if (history[0][0] < t - HISTORY_S) history = history.filter(h => h[0] >= t - HISTORY_S);
      }
      prevSt = st;

      // melody steps whose second window has passed
      while (step < chart.steps.length && toSec(chart.steps[step].bEnd) <= t) {
        const s = chart.steps[step++];
        const within = (from: number, to: number) => history.filter(h => h[0] >= toSec(from) && h[0] <= toSec(to)).map(h => h[1]);
        const pa = median(within(s.aFrom, s.aEnd)), pb = median(within(s.bFrom, s.bEnd));
        if (pa === null || pb === null) continue;
        const ds = fold(pb - pa);
        if (Math.abs(s.dc) >= 2) {
          if (Math.sign(ds) === Math.sign(fold(s.dc)) && Math.abs(ds) >= 0.5) c.agr++; else c.dis++;
        } else if (s.dc === 0) {
          c.sameN++;
          if (Math.abs(ds) < 1) c.same++;
        }
      }

      const z = B
        + W.onShare * (c.onV + 0.5) / (c.onN + 1)
        + W.restShare * (c.reV + 0.2) / (c.reN + 1)
        + W.logRestN * Math.log1p(c.reN)
        + W.hitShare * (c.hit + 0.25) / (c.onV + 1)
        + W.agree * (c.agr + 0.5) / (c.agr + c.dis + 1)
        + W.logAgreeN * Math.log1p(c.agr + c.dis)
        + W.sameAgree * (c.same + 0.5) / (c.sameN + 1)
        + W.pstep * (c.dst + 0.5 * 10) / (c.vN + 10)
        + W.pwithin * (c.within + 0.3 * 10) / (c.vN + 10);
      return 1 / (1 + Math.exp(-z));
    },
  };
}

/**
 * The gate for one voice. push() takes each window in turn and returns the
 * windows to use now (judge, draw, send), oldest first: the window itself
 * while the voice sings; nothing while it is held; held windows when the gate
 * opens (with their pitch) or when they have waited RETRO_S (without it).
 *
 *   lyricData  the part this voice sings: { bpm, gap, lyricRefs, lyricLines }
 *   w          { t: song time (s), freq: Hz (0 = none), fric, hzFirst, hzLast, ...anything }
 *
 * A window let through without its pitch has freq 0 and fric 0. Another chart
 * (a new song, the other part of a duet) starts the evidence afresh.
 */
export function createSingingGate<W extends GateWindow = GateWindow>({ retroS = RETRO_S, open: openP = OPEN_P, close: closeP = CLOSE_P }: { retroS?: number, open?: number, close?: number } = {}): SingingGate<W> {
  const evidence = createSingingEvidence();
  let chartKey: readonly (LyricRef | undefined)[] | null = null;
  let isOpen = true;
  let started = false;
  let held: { w: W, rap: boolean }[] = [];
  let lastT: number | null = null;
  let p = 1;

  const silenced = (w: W): W => ({ ...w, freq: 0, fric: 0 });
  const takeHeld = (withPitch: boolean) => {
    const out = held.map(h => (withPitch || h.rap ? h.w : silenced(h.w)));
    held = [];
    return out;
  };

  return {
    get open() { return isOpen; },
    /** The chance of singing after the last window and the windows held (the debug panel). */
    get chance() { return p; },
    get held() { return held.length; },
    push(lyricData, w) {
      if (!lyricData?.lyricRefs) return [w];
      const out: W[] = [];
      if (chartKey !== lyricData.lyricRefs) {
        // another song or part: what is held belonged to the one before, and the evidence too
        held = [];
        evidence.reset();
        chartKey = lyricData.lyricRefs;
        started = false;
        lastT = null;
      }
      // a rewind: the held windows were after the place sung again, and would go out of order
      if (lastT !== null && w.t < lastT - REWIND_S) held = [];
      lastT = w.t;
      const chart = prepareChart(lyricData);
      p = evidence.push(chart, lyricData.gap, w);
      const tick = Math.floor(chart.tps * (w.t - lyricData.gap / 1000));
      const rap = tick >= 0 && !!chart.syllableAt(tick)?.isRap;

      const wasOpen = isOpen;
      if (!started) { isOpen = p >= openP; started = true; }
      else if (isOpen && p < closeP) isOpen = false;
      else if (!isOpen && p >= openP) isOpen = true;

      if (isOpen) {
        // opening: the held windows of the last RETRO_S count (older ones went on without their pitch)
        if (!wasOpen && held.length) out.push(...takeHeld(true));
        out.push(w);
        return out;
      }
      held.push({ w, rap });
      while (held.length && held[0].w.t < w.t - retroS) {
        const h = held.shift()!;
        out.push(h.rap ? h.w : silenced(h.w));
      }
      return out;
    },
    /** Everything held, without its pitch (rap notes with theirs). */
    flush() { return takeHeld(false); },
  };
}
