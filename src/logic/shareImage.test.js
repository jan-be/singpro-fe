import { describe, it, expect } from 'vitest';
import { cardNames, leaderboardRows, melodyOf, rankByScore, waveform } from './shareImage.js';

const p = (username, score, extra = {}) => ({ username, score, ...extra });

describe('rankByScore', () => {
  it('orders by this song\'s score, not the party total, and ties share a rank', () => {
    const ranked = rankByScore([p('a', 500, { cumulativeScore: 9000 }), p('b', 800), p('c', 800), p('d', 100)]);
    expect(ranked.map(x => [x.username, x.rank])).toEqual([['b', 1], ['c', 1], ['a', 3], ['d', 4]]);
  });

  it('leaves the scores it was given alone', () => {
    const scores = [p('a', 1), p('b', 2)];
    rankByScore(scores);
    expect(scores.map(x => x.username)).toEqual(['a', 'b']);
    expect(rankByScore(undefined)).toEqual([]);
  });
});

describe('leaderboardRows', () => {
  const ranked = rankByScore(Array.from({ length: 9 }, (_, i) => p(`s${i}`, 9000 - i * 1000)));

  it('shows everyone while they fit', () => {
    expect(leaderboardRows(ranked.slice(0, 5), 's4')).toEqual({ rows: ranked.slice(0, 5), more: 0 });
  });

  it('past that, the top ones and a row for the rest', () => {
    const { rows, more } = leaderboardRows(ranked, 's1');
    expect(rows.map(r => r.username)).toEqual(['s0', 's1', 's2', 's3']);
    expect(more).toBe(5);
  });

  it('always keeps the sharer', () => {
    const { rows, more } = leaderboardRows(ranked, 's7');
    expect(rows.map(r => r.username)).toEqual(['s0', 's1', 's2', 's7']);
    expect(more).toBe(5);
  });
});

const CHART = [
  '#TITLE:Test', '#ARTIST:Test', '#BPM:100', '#GAP:0',
  ': 0 4 0 a', ': 4 4 12 b', '- 10', ': 20 10 6 c', 'E',
].join('\n');

const DUET = [
  '#TITLE:Duet', '#ARTIST:Test', '#BPM:100', '#GAP:0',
  'P1', ': 0 10 0 a', 'P2', ': 10 10 5 b', ': 20 10 7 c', 'E',
].join('\n');

describe('melodyOf', () => {
  it('places each note in 0..1 by time and pitch', async () => {
    const m = await melodyOf(CHART);
    expect(m).toEqual([
      { x0: 0, x1: 4 / 30, y: 0 },
      { x0: 4 / 30, x1: 8 / 30, y: 1 },
      { x0: 20 / 30, x1: 1, y: 0.5 },
    ]);
  });

  it('takes the part that was sung in a duet', async () => {
    expect(await melodyOf(DUET, 1)).toHaveLength(1);
    const p2 = await melodyOf(DUET, 2);
    expect(p2).toHaveLength(2);
    expect(p2[0].x0).toBe(0);
    expect(p2[1].y).toBe(1);
  });

  it('is null without a chart or notes', async () => {
    expect(await melodyOf(null)).toBe(null);
    expect(await melodyOf('#TITLE:x\n#BPM:100\nE')).toBe(null);
    expect(await melodyOf('not a chart')).toBe(null);
  });
});

describe('waveform', () => {
  it('is silent where nobody sings and higher where the tune is', () => {
    const bars = waveform([{ x0: 0, x1: 0.25, y: 0 }, { x0: 0.5, x1: 1, y: 1 }], 4);
    expect(bars[0]).toBeGreaterThan(0);
    expect(bars[1]).toBe(0);
    expect(bars[3]).toBeGreaterThan(bars[0]);
    expect(Math.max(...bars)).toBeLessThanOrEqual(1);
  });

  it('a bar only partly sung is lower than a full one at the same pitch', () => {
    const [half, full] = waveform([{ x0: 0, x1: 0.1, y: 1 }, { x0: 0.5, x1: 1, y: 1 }], 2);
    expect(half).toBeLessThan(full);
  });

  it('copes with no melody', () => {
    expect(waveform(null, 3)).toEqual([0, 0, 0]);
  });
});

describe('cardNames', () => {
  const qingTian = {
    title: 'Qing Tian', artist: 'Jay Chou', language: 'Mandarin',
    titles: { Hans: { title: '晴天', artist: '周杰伦' }, Hant: { title: '晴天', artist: '周杰倫' } },
  };

  it('shows a title in its own script whatever the UI language, with the romanised names under it', () => {
    expect(cardNames(qingTian, 'en')).toEqual({ title: '晴天', artist: '周杰伦', lang: 'zh-Hans', roman: 'Jay Chou – Qing Tian' });
    expect(cardNames(qingTian, 'zh-TW')).toMatchObject({ title: '晴天', artist: '周杰倫', lang: 'zh-Hant' });
  });

  it('keeps the artist when only the title has a script of its own', () => {
    const song = { title: 'Yoru ni kakeru', artist: 'YOASOBI', titles: { Jpan: { title: '夜に駆ける' } } };
    expect(cardNames(song, 'de')).toEqual({ title: '夜に駆ける', artist: 'YOASOBI', lang: 'ja', roman: 'YOASOBI – Yoru ni kakeru' });
  });

  it('a song without one is as it is', () => {
    expect(cardNames({ title: 'Butter', artist: 'BTS' }, 'ko')).toEqual({ title: 'Butter', artist: 'BTS' });
    expect(cardNames(null, 'en')).toEqual({ title: undefined, artist: undefined });
  });
});
