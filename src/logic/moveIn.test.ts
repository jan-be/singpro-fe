import { describe, it, expect } from 'vitest';
import { renameOldKeys, decodeHandoff, takeHandoff, OLD_ORIGIN } from './moveIn';

/** A Storage stand-in that keeps its order, like the real one */
const storage = (init: Record<string, string> = {}) => {
  const map = new Map(Object.entries(init));
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => map.set(k, String(v)),
    removeItem: (k: string) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
};

/** What public/moving.html puts after #handoff= */
const pack = (data: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const place = (hash: string) => {
  const replaced: (string | URL | null | undefined)[] = [];
  return {
    location: { pathname: '/join/ABCD', search: '?qr', hash },
    history: { state: null, replaceState: (s: unknown, t: string, url?: string | URL | null) => replaced.push(url) },
    replaced,
  };
};

describe('keys from before the rename', () => {
  it('get their new names once; a value under the new name wins', () => {
    const s = storage({ singpro_guest: 'g1', 'singpro-lang': 'de', 'singpro.lyricsScript': 'x', singspree_volume: '0.5', singpro_volume: '0.9', other: '1' });
    renameOldKeys(s);
    expect(s.dump()).toEqual({ other: '1', singspree_volume: '0.5', singspree_guest: 'g1', 'singspree-lang': 'de', 'singspree.lyricsScript': 'x' });
  });
});

describe('the handoff from singpro.app', () => {
  const token = 'T'.repeat(22);

  it('writes what the old site stored, claims the session, and clears the address', async () => {
    const { location, history, replaced } = place(`#handoff=${pack({ l: { singpro_guest: 'g-ü', evil: 'x' }, s: { singpro_party: '{"p":1}' }, t: token, r: 'https://www.reddit.com/r/karaoke' })}`);
    const local = storage();
    const session = storage();
    const calls: unknown[] = [];
    const moved = takeHandoff({
      location, history, referrer: `${OLD_ORIGIN}/`, local, session,
      fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true }; },
    });
    await moved!.claim;
    expect(replaced).toEqual(['/join/ABCD?qr']);
    expect(local.dump()).toEqual({ singpro_guest: 'g-ü' });
    expect(session.dump()).toEqual({ singpro_party: '{"p":1}' });
    expect(calls).toEqual([['/api/auth/handoff/claim', { token }]]);
    expect(moved!.referrer).toBe('https://www.reddit.com/r/karaoke');
  });

  it('takes nothing from a page that did not come from singpro.app, but still clears the address', () => {
    const { location, history, replaced } = place(`#handoff=${pack({ l: { singpro_guest: 'attacker' }, t: token })}`);
    const local = storage();
    let fetched = false;
    const moved = takeHandoff({ location, history, referrer: 'https://evil.example/', local, session: storage(), fetchImpl: async () => { fetched = true; } });
    expect(moved).toBe(null);
    expect(replaced).toEqual(['/join/ABCD?qr']);
    expect(local.dump()).toEqual({});
    expect(fetched).toBe(false);
  });

  it("this browser's own values here win over the old site's", () => {
    const { location, history } = place(`#handoff=${pack({ l: { singpro_guest: 'old', singpro_volume: '0.2' } })}`);
    const local = storage({ singspree_guest: 'mine' });
    takeHandoff({ location, history, referrer: `${OLD_ORIGIN}/sing/x`, local, session: storage(), fetchImpl: async () => {} });
    renameOldKeys(local);
    expect(local.dump()).toEqual({ singspree_guest: 'mine', singspree_volume: '0.2' });
  });

  it('no fragment, or a broken one, is no handoff', () => {
    expect(decodeHandoff('')).toBe(null);
    expect(decodeHandoff('#handoff=%%%')).toBe(null);
    expect(decodeHandoff(`#handoff=${pack([1, 2])}`)).toEqual([1, 2]);
    const { location, history } = place('#top');
    expect(takeHandoff({ location, history, referrer: `${OLD_ORIGIN}/`, local: storage(), session: storage(), fetchImpl: async () => {} })).toBe(null);
  });
});
