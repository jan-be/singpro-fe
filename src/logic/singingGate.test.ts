import { describe, test, expect } from 'vitest';
import { readTextFile } from './LyricsParser';
import { createSingingGate, createSingingEvidence, prepareChart, RETRO_S } from './singingGate';
import type { GateWindow, SingingGate } from './singingGate';
import type { LyricData } from './LyricsParser';

const HOP = 0.03;
const hzOf = (tone: number) => 440 * 2 ** ((tone - 33) / 12); // UltraStar tone → Hz

// 10 ticks a second (#BPM is a quarter of the ticks per minute), no gap. Lines of
// four half-second notes stepping up and down, two seconds of rest between lines.
async function chart({ lines = 12, rapLine = -1 } = {}) {
  const rows = ['#BPM:150', '#GAP:0'];
  const melody = [10, 14, 12, 7];
  for (let l = 0; l < lines; l++) {
    const start = l * 40;
    melody.forEach((tone, i) => rows.push(`${l === rapLine ? 'R' : ':'} ${start + i * 5} 4 ${tone + (l % 3)} la `));
    rows.push(`- ${start + 20}`);
  }
  rows.push('E');
  return readTextFile(rows.join('\n'));
}

const toneAt = (ld: LyricData, t: number) => {
  const ref = ld.lyricRefs[Math.floor(t * 10)];
  return ref && !ref.isSilent ? ld.lyricLines[ref.lineIndex][ref.syllableIndex] : null;
};

// Someone singing along: voiced on every note at its tone (a little vibrato), quiet in between
const singer = (ld: LyricData, from: number, to: number) => {
  const out: GateWindow[] = [];
  for (let t = from; t < to; t += HOP) {
    const note = toneAt(ld, t);
    const hz = note ? hzOf(note.tone) * 2 ** (0.2 * Math.sin(t * 30) / 12) : 0;
    out.push({ t, freq: hz, fric: 0, hzFirst: hz, hzLast: hz });
  }
  return out;
};

// Someone talking: syllables of 0.2 s every 0.3 s whatever the song does, each a falling glide
const talker = (from: number, to: number) => {
  const out: GateWindow[] = [];
  for (let t = from; t < to; t += HOP) {
    const phase = (t % 0.3) / 0.2;
    const hz = phase < 1 ? 190 * 2 ** (-3 * phase / 12) : 0;
    out.push({ t, freq: hz, fric: 0, hzFirst: hz && hz * 2 ** (0.6 / 12), hzLast: hz });
  }
  return out;
};

const run = (gate: SingingGate, ld: LyricData, windows: GateWindow[]) => windows.flatMap(w => gate.push(ld, w));

describe('what the gate reads off the chart', () => {
  test('notes, the margin around them, rests between lines, and the melody steps', async () => {
    const ld = await chart({ lines: 2 });
    const c = prepareChart(ld);
    expect(c.syllableAt(0)?.tone).toBe(10);
    expect(c.syllableAt(3)).not.toBeNull();
    expect(c.syllableAt(4)).toBeNull();            // between two notes
    expect(c.syllableAt(19)).toBeNull();           // the line's last note is ticks 15-18
    expect(c.near[22]).toBe(1);                     // within 0.4 s (4 ticks) of it
    expect(c.near[23]).toBe(0);                     // a rest, before the next line at 40
    expect([c.firstTick, c.lastTick]).toEqual([0, 58]);
    // three steps a line: up 4, down 2, down 5
    expect(c.steps.map(s => s.dc)).toEqual([4, -2, -5, 4, -2, -5]);
  });
});

describe('the evidence', () => {
  test('a singer following the chart reads as singing, someone talking through it does not', async () => {
    const ld = await chart();
    const c = prepareChart(ld);
    const sing = createSingingEvidence(), talk = createSingingEvidence();
    let ps = 0, pt = 0;
    for (const w of singer(ld, 0, 40)) ps = sing.push(c, 0, w);
    for (const w of talker(0, 40)) pt = talk.push(c, 0, w);
    expect(ps).toBeGreaterThan(0.9);
    expect(pt).toBeLessThan(0.02);
  });
});

describe('the gate', () => {
  test('a singer goes through at once, untouched', async () => {
    const ld = await chart();
    const gate = createSingingGate();
    for (const w of singer(ld, 0, 40)) expect(gate.push(ld, w)).toEqual([w]);
    expect(gate.open).toBe(true);
  });

  test('talking: held back, then let through without its pitch, in order', async () => {
    const ld = await chart();
    const gate = createSingingGate();
    const windows = talker(0, 40);
    const out = run(gate, ld, windows);
    expect(gate.open).toBe(false);
    // every window once, in order; whatever is still held is the last RETRO_S
    expect(out.map(w => w.t)).toEqual(windows.slice(0, out.length).map(w => w.t));
    expect(windows.length - out.length).toBeLessThanOrEqual(Math.ceil(RETRO_S / HOP) + 1);
    // after the first seconds nothing keeps a pitch
    const late = out.filter(w => w.t > 10);
    expect(late.length).toBeGreaterThan(500);
    expect(late.every(w => w.freq === 0 && w.fric === 0)).toBe(true);
  });

  test('talking, then singing: the gate opens and the last 2 s count after all', async () => {
    const ld = await chart({ lines: 20 });
    const gate = createSingingGate();
    const out = [...run(gate, ld, talker(0, 30)), ...run(gate, ld, singer(ld, 30, 80))];
    expect(gate.open).toBe(true);
    const opened = out.findIndex(w => w.t >= 30 && w.freq > 0);
    // the singing that counts starts no later than when the gate opened, less the held 2 s
    const sungLate = out.filter(w => w.t >= 30 && toneAt(ld, w.t));
    const kept = sungLate.filter(w => w.freq > 0).length / sungLate.length;
    expect(opened).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0.85);
    expect(out.map(w => w.t)).toEqual([...out.map(w => w.t)].sort((a, b) => a - b));
  });

  test('rap notes keep their pitch even while the gate is closed', async () => {
    const ld = await chart({ lines: 12, rapLine: 8 });
    const gate = createSingingGate();
    const out = run(gate, ld, talker(0, 40));
    expect(gate.open).toBe(false);
    const rap = out.filter(w => toneAt(ld, w.t)?.isRap && w.freq > 0);
    const sung = out.filter(w => { const note = toneAt(ld, w.t); return w.t > 10 && note && !note.isRap && w.freq > 0; });
    expect(rap.length).toBeGreaterThan(20);
    expect(sung).toHaveLength(0);
  });

  test('a new song starts afresh and drops what was held; a rewind drops it too', async () => {
    const a = await chart(), b = await chart();
    const gate = createSingingGate();
    run(gate, a, talker(0, 30));
    expect(gate.open).toBe(false);
    expect(gate.held).toBeGreaterThan(0);
    // the next song: someone singing from its first note goes through at once
    const first = singer(b, 0, 5)[0];
    expect(gate.push(b, first)).toEqual([first]);
    expect(gate.held).toBe(0);

    const c = await chart();
    const g2 = createSingingGate();
    run(g2, c, talker(0, 30));
    expect(g2.held).toBeGreaterThan(0);
    const back = g2.push(c, { t: 5, freq: 0, fric: 0 });
    expect(back.every(w => w.t === 5 || w.t < 5)).toBe(true);
  });

  test('without a chart everything goes through', () => {
    const gate = createSingingGate();
    const w = { t: 1, freq: 220, fric: 0 };
    // @ts-expect-error -- no chart at all, as null: the window itself all the same
    expect(gate.push(null, w)).toEqual([w]);
    // @ts-expect-error -- a chart without its notes (lyricRefs): the same
    expect(gate.push({}, w)).toEqual([w]);
  });
});
