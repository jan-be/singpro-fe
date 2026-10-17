import { describe, it, expect } from 'vitest';
import { rankSingers } from './scoreStrip';

describe('rankSingers', () => {
  it('best first, the score that rode on the newest note winning over the board', () => {
    const { rows } = rankSingers({ scores: { Ann: { score: 900 }, Bob: { score: 2000 } }, live: { Ann: 2500 }, me: 'Bob' });
    expect(rows.map(r => [r.username, r.score, r.rank])).toEqual([['Ann', 2500, 1], ['Bob', 2000, 2]]);
  });

  it('a singer who only has a live score yet is on it; nobody sang: empty', () => {
    expect(rankSingers({ scores: null, live: { Cat: 10 }, me: 'x' }).rows.map(r => r.username)).toEqual(['Cat']);
    expect(rankSingers({ scores: {}, live: {}, me: 'x' }).rows).toEqual([]);
  });

  it('more than fit: the best, and your own place as the last chip', () => {
    const scores = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}`, { score: 1000 - i * 10 }]));
    const { rows } = rankSingers({ scores, live: {}, me: 'p9', max: 4 });
    expect(rows.map(r => `${r.username}#${r.rank}`)).toEqual(['p0#1', 'p1#2', 'p2#3', 'p9#10']);
    expect(rankSingers({ scores, live: {}, me: 'p1', max: 4 }).rows.map(r => r.username)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('in a crowd: who the server put on screen, and your rank among everyone', () => {
    const lanes = { pinned: ['Ann'], spotlight: ['Bob', 'Cat'] };
    const live = { Ann: 500, Bob: 4000, Cat: 3000, Me: 100 };
    const out = rankSingers({ scores: {}, live, lanes, standing: { rank: 57, total: 200, score: 100 }, me: 'Me' });
    expect(out.rows.map(r => r.username)).toEqual(['Bob', 'Cat', 'Ann']);
    expect(out.mine).toEqual({ rank: 57, total: 200, score: 100 });
  });

  it('the key only moves when who is shown or the order changes, not with every point', () => {
    const a = rankSingers({ scores: {}, live: { Ann: 100, Bob: 50 }, me: 'Ann' });
    const b = rankSingers({ scores: {}, live: { Ann: 180, Bob: 60 }, me: 'Ann' });
    const c = rankSingers({ scores: {}, live: { Ann: 180, Bob: 200 }, me: 'Ann' });
    expect(b.key).toBe(a.key);
    expect(c.key).not.toBe(a.key);
  });
});
