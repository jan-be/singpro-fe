import { describe, it, expect } from 'vitest';
import { calcScore } from './MicInputToTick.js';
import { readTextFile } from './LyricsParser.js';

// A five second intro, then one 20-tick note starting at tick 0 — the shape
// 99% of the catalogue has.
const CHART = ['#BPM:100', '#GAP:5000', ': 0 20 12 laa', 'E'].join('\n');
const HZ_TONE_12 = 440 * Math.pow(2, (12 - 33) / 12);

const sing = (from, to) => {
  const notes = [];
  for (let t = from; t <= to + 1e-9; t += 0.05) notes.push({ videoTime: t, freq: HZ_TONE_12 });
  return { notes, score: 0 };
};

describe('calcScore', () => {
  it('gives nothing for holding the first note through the intro', async () => {
    const lyricData = await readTextFile(CHART);
    const player = sing(0, 4.95);
    calcScore(lyricData, player);
    expect(player.score).toBe(0);
  });

  it('scores the note once it actually starts', async () => {
    const lyricData = await readTextFile(CHART);
    const player = sing(5, 8);
    calcScore(lyricData, player);
    expect(player.score).toBeGreaterThan(19);
    expect(player.score).toBeLessThanOrEqual(20);
  });

  it('scores a rap note for any voiced pitch', async () => {
    const RAP = ['#BPM:100', '#GAP:0', 'R 0 20 10 yo', 'E'].join('\n');
    const lyricData = await readTextFile(RAP);
    const player = { notes: [], score: 0 };
    // 200 Hz is nowhere near the nominal tone 10 (~116 Hz), in any octave
    for (let t = 0; t <= 3 + 1e-9; t += 0.05) player.notes.push({ videoTime: t, freq: 200 });
    calcScore(lyricData, player);
    expect(player.score).toBeGreaterThan(19);
    expect(player.score).toBeLessThanOrEqual(20);
  });
});

// The score as it was worked out before it became lazy: calcScore over the
// whole window on every local note, written down here so the lazy one can be
// held against it.
const eagerReference = () => {
  const players = {};
  const score = (lyricData, notes) => {
    if (notes.length < 2) return 0;
    const { bpm, gap, lyricRefs, lyricLines } = lyricData;
    const tickRate = bpm / 60;
    let s = 0;
    for (let i = 0; i < notes.length - 1; i++) {
      const { videoTime, freq } = notes[i];
      if (freq <= 0) continue;
      const dt = Math.min(notes[i + 1].videoTime - videoTime, 0.2);
      if (dt <= 0) continue;
      const tick = Math.floor(tickRate * (videoTime - gap / 1000));
      const ref = lyricRefs?.[tick];
      if (!ref || ref.isSilent) continue;
      const syllable = lyricLines[ref.lineIndex]?.[ref.syllableIndex];
      if (!syllable || syllable.isBreak) continue;
      const expected = syllable.tone;
      const semitone = 12 * Math.log2(freq / 440) + 33;
      const octaveAdj = Math.round((expected - semitone) / 12) * 12;
      if (syllable.isRap || Math.abs(semitone + octaveAdj - expected) <= 1) s += dt * tickRate * (syllable.isSpecial ? 2 : 1);
    }
    return Math.round(s);
  };
  const prune = (p, videoTime) => {
    while (p.notes.length > 0 && p.notes[0].videoTime < videoTime - 30) p.notes.shift();
    p.notes.push({ videoTime, freq: p.lastFreq });
  };
  const get = (name) => (players[name] ??= { notes: [], score: 0 });
  return {
    players,
    local(tickData, freq, name, videoTime) {
      const p = get(name); p.lastFreq = freq; prune(p, videoTime);
      p.score = score(tickData.lyricData, p.notes);
    },
    remote(notes) {
      for (const { username, freq, videoTime } of notes) { const p = get(username); p.lastFreq = freq; prune(p, videoTime); }
    },
  };
};

// Deterministic pseudo-random numbers (mulberry32)
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// A duet with every note kind, lines and pauses, long enough for the 30 s window to fill
const longDuet = () => {
  const part = (offset, r) => {
    const lines = [];
    let t = offset;
    for (let line = 0; line < 40; line++) {
      for (let k = 0; k < 6; k++) {
        const kind = [':', ':', ':', '*', 'R', 'G', 'F'][Math.floor(r() * 7)];
        const len = 1 + Math.floor(r() * 8);
        lines.push(`${kind} ${t} ${len} ${Math.floor(r() * 24) - 4} la `);
        t += len + Math.floor(r() * 3);
      }
      t += 4 + Math.floor(r() * 30);
      lines.push(`- ${t}`);
    }
    return lines;
  };
  const r = rng(7);
  return ['#BPM:283.5', '#GAP:1800', 'P1', ...part(0, r), 'P2', ...part(37, r), 'E'].join('\n');
};

describe('the lazy score', () => {
  it('is the score every note used to be judged to, through seeks, timing fixes, part changes and remote notes', async () => {
    const { getAndSetHitNotesByPlayer, applyRemoteNotes } = await import('./MicInputToTick.js');
    const { getTickData, getP2TickData } = await import('./LyricsParser.js');
    const ld = await readTextFile(longDuet());
    const toneHz = (tone) => 440 * Math.pow(2, (tone - 33) / 12);

    for (const seed of [1, 2, 3]) {
      const r = rng(seed);
      const ref = eagerReference();
      let live = {};
      let videoTime = 0, part = 1, me = 'me', checked = 0, scored = 0;
      ld.gap = 1800;
      for (let step = 0; step < 8000; step++) {
        videoTime += 0.03 * (0.3 + r() * 1.4); // ~33 notes a second with jitter
        if (r() < 0.002) videoTime = Math.max(0, videoTime - r() * 40); // a seek back
        if (r() < 0.002) videoTime += r() * 20;                        // and forward
        if (r() < 0.003) ld.gap = 1800 + Math.round((r() - 0.5) * 400); // the host fixes the timing in place
        if (r() < 0.002) part = part === 1 ? 2 : 1;                     // a duet part change
        if (r() < 0.0005) me = me === 'me' ? 'me2' : 'me';               // the local name changes (sign-in)
        const delay = 0.08 + r() * 0.1;
        const noteTime = videoTime - delay;

        const td = part === 2 ? getP2TickData(ld, videoTime) : getTickData(ld, videoTime);
        const target = td.lyricRef && !td.lyricRef.isSilent ? td.currentLine[td.lyricRef.syllableIndex]?.tone ?? 10 : 10;
        const x = r();
        const freq = x < 0.15 ? 0 : x < 0.2 ? -1 : toneHz(target + (r() - 0.5) * 5 + (r() < 0.2 ? 12 : 0));
        if (td.lyricRef) {
          live = getAndSetHitNotesByPlayer(td, live, freq, me, noteTime);
          ref.local(td, freq, me, noteTime);
        }
        if (r() < 0.3) {
          // others' notes, now and then under a name this browser sang as before
          const batch = ['a', 'b', r() < 0.01 ? (me === 'me' ? 'me2' : 'me') : 'c']
            .map(username => ({ username, freq: r() < 0.2 ? 0 : 100 + r() * 400, videoTime: noteTime - r() * 0.3 }));
          live = applyRemoteNotes(live, batch);
          ref.remote(batch);
        }
        if (r() < 0.01) ld.gap = 1800 + Math.round((r() - 0.5) * 400); // also between a note and the read
        if (r() < 0.05 || step === 7999) {
          for (const name of Object.keys(ref.players)) {
            expect(live[name].score).toBe(ref.players[name].score);
            if (ref.players[name].score > 0) scored++;
            expect(live[name].notes.map(n => [n.videoTime, n.freq])).toEqual(ref.players[name].notes.map(n => [n.videoTime, n.freq]));
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
      expect(scored).toBeGreaterThan(100); // the local singer's, over notes that hit something
    }
  });
});
