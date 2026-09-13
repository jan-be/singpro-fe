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
});
