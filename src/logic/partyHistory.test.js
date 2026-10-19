import { describe, test, expect, beforeEach } from 'vitest';
import {
  notePartySong, notePartySingers, notePartyQueue, loadParties, lastHostedParty, missedSongs,
  isLongParty, leftoverParty, dismissParty, LEFTOVER_FOR_MS, historySongIds, savePendingQueue, takePendingQueue,
} from './partyHistory';

// vitest runs in node: minimal storage stand-ins
const store = () => {
  const items = new Map();
  return {
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => { items.set(k, String(v)); },
    removeItem: (k) => { items.delete(k); },
    clear: () => items.clear(),
  };
};
globalThis.localStorage = store();
globalThis.sessionStorage = store();

const song = (id) => ({ songId: id, artist: `Artist ${id}`, title: `Title ${id}`, videoId: `v${id}`, extra: 'dropped' });
const T = Date.parse('2026-10-18T19:00:00Z');
const MIN = 60_000;

describe('partyHistory', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  test('a hosted party: its songs once each, who sang, and what was left in the queue', () => {
    notePartySong('K7QX', song('a'), { host: true, me: 'Host', now: T });
    notePartyQueue('K7QX', [song('b'), song('c'), { songId: null, title: 'being charted', job: { id: 3 } }], { now: T + MIN });
    notePartySong('K7QX', song('b'), { host: true, me: 'Host', now: T + 4 * MIN });
    notePartySong('K7QX', song('a'), { host: true, me: 'Host', now: T + 8 * MIN }); // again
    notePartySingers('K7QX', ['Host', 'Anna'], { now: T + 9 * MIN });
    notePartySingers('K7QX', ['Ben', 'Anna', ''], { now: T + 10 * MIN });
    notePartyQueue('K7QX', [song('c'), song('d')], { now: T + 11 * MIN });

    const party = lastHostedParty();
    expect(party.songs).toEqual([
      { songId: 'a', artist: 'Artist a', title: 'Title a', videoId: 'va' },
      { songId: 'b', artist: 'Artist b', title: 'Title b', videoId: 'vb' },
    ]);
    expect(party.singers).toEqual(['Host', 'Anna', 'Ben']);
    expect(missedSongs(party).map(s => s.songId)).toEqual(['c', 'd']);
    expect(party.startedAt).toBe(T);
    expect(party.lastAt).toBe(T + 11 * MIN);
  });

  test("a joiner's party is history for For you, not a party to start again", () => {
    notePartySong('ZZZZ', song('j'), { host: false, now: T });
    expect(lastHostedParty()).toBe(null);
    expect(historySongIds()).toEqual(['j']);
  });

  test('the same code hours later is another party; the most recent comes first', () => {
    notePartySong('K7QX', song('a'), { host: true, now: T });
    notePartySong('K7QX', song('b'), { host: true, now: T + 7 * 60 * MIN });
    expect(loadParties().map(p => p.songs.map(s => s.songId).join())).toEqual(['b', 'a']);
    // singers only ever go to a party that is on; an empty queue makes no party
    notePartySingers('OLD1', ['Anna'], { now: T });
    notePartyQueue('OLD1', [], { now: T });
    expect(loadParties()).toHaveLength(2);
  });

  test("the host's queue may come before the first song (Start again fills it as the party opens)", () => {
    notePartyQueue('NEW1', [song('b')], { now: T });
    notePartySong('NEW1', song('a'), { host: true, now: T + MIN });
    const party = lastHostedParty();
    expect([party.partyId, party.songs.map(s => s.songId), missedSongs(party).map(s => s.songId)]).toEqual(['NEW1', ['a'], ['b']]);
  });

  test('historySongIds: most recent first across parties, each once', () => {
    notePartySong('P1', song('a'), { now: T });
    notePartySong('P1', song('b'), { now: T + MIN });
    notePartySong('P2', song('c'), { now: T + 2 * MIN });
    notePartySong('P2', song('a'), { now: T + 3 * MIN });
    expect(historySongIds()).toEqual(['a', 'c', 'b']);
  });

  test('long parties, and at most ten kept', () => {
    for (let i = 0; i < 5; i++) notePartySong('LONG', song(`s${i}`), { host: true, now: T + i * MIN });
    expect(isLongParty(lastHostedParty())).toBe(true);
    notePartySong('SHRT', song('x'), { host: true, now: T + 10 * MIN });
    expect(isLongParty(lastHostedParty())).toBe(false);
    for (let i = 0; i < 12; i++) notePartySong(`P${i}`, song('y'), { now: T + (20 + i) * MIN });
    expect(loadParties()).toHaveLength(10);
  });

  test('the home page mentions only the last hosted party, only with 3+ unsung songs, for two weeks, until its ✕', () => {
    notePartySong('P1', song('a'), { host: true, now: T });
    notePartyQueue('P1', [song('b'), song('c')], { now: T + MIN });
    expect(leftoverParty(loadParties(), T + 2 * MIN)).toBe(null); // two left: not several
    notePartyQueue('P1', [song('b'), song('c'), song('d')], { now: T + 2 * MIN });
    expect(leftoverParty(loadParties(), T + 3 * MIN).partyId).toBe('P1');
    expect(leftoverParty(loadParties(), T + 2 * MIN + LEFTOVER_FOR_MS + 1)).toBe(null); // too long ago
    // a joiner's party changes nothing; a newer hosted one without leftovers ends the mention
    notePartySong('P2', song('x'), { host: false, now: T + 10 * MIN });
    expect(leftoverParty(loadParties(), T + 11 * MIN).partyId).toBe('P1');
    notePartySong('P3', song('y'), { host: true, now: T + 20 * MIN });
    expect(leftoverParty(loadParties(), T + 21 * MIN)).toBe(null);
  });

  test('its ✕ stops the mention for that party, and its songs stay history', () => {
    notePartySong('P1', song('a'), { host: true, now: T });
    notePartyQueue('P1', [song('b'), song('c'), song('d')], { now: T + MIN });
    const p = leftoverParty(loadParties(), T + 2 * MIN);
    dismissParty(p.partyId, p.startedAt);
    expect(leftoverParty(loadParties(), T + 2 * MIN)).toBe(null);
    expect(historySongIds()).toEqual(['a']);
  });

  test('broken or blocked storage keeps nothing and throws nothing', () => {
    localStorage.setItem('singspree_parties', '{not json');
    expect(loadParties()).toEqual([]);
    const real = globalThis.localStorage;
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    try {
      expect(() => notePartySong('K7QX', song('a'), { host: true })).not.toThrow();
      expect(lastHostedParty()).toBe(null);
    } finally {
      globalThis.localStorage = real;
    }
  });
});

describe('pending queue (Start again)', () => {
  beforeEach(() => sessionStorage.clear());

  test('taken once, without what the party already has', () => {
    savePendingQueue([song('b'), song('c'), song('d')], T);
    expect(takePendingQueue({ currentSong: { songId: 'b' }, queue: [song('d')] }, T + MIN).map(s => s.songId)).toEqual(['c']);
    expect(takePendingQueue({}, T + MIN)).toEqual([]);
  });

  test('a stale one is dropped', () => {
    savePendingQueue([song('b')], T);
    expect(takePendingQueue({}, T + 11 * MIN)).toEqual([]);
  });
});
