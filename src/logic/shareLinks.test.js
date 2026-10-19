import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('./shareLinks.js');
};

const storage = (store = new Map()) => ({
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
});

describe('share links', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storage(new Map([['singspree_guest', 'guest-browser-1']])));
    vi.stubGlobal('sessionStorage', storage());
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('the song link, with the code when there is one; the code read back from a link', async () => {
    const { songShareUrl, codeOf } = await load();
    expect(songShareUrl('5I7Jr21fpoK', 'Ab12Cd34')).toBe('https://singspree.com/sing/5I7Jr21fpoK?r=Ab12Cd34');
    expect(songShareUrl('5I7Jr21fpoK', null)).toBe('https://singspree.com/sing/5I7Jr21fpoK');
    expect(songShareUrl('5I7Jr21fpoK', 'not a code')).toBe('https://singspree.com/sing/5I7Jr21fpoK');
    expect(songShareUrl(null)).toBe('https://singspree.com');
    expect(codeOf('https://singspree.com/sing/5I7Jr21fpoK?r=Ab12Cd34')).toBe('Ab12Cd34');
    expect(codeOf('https://singspree.com/sing/5I7Jr21fpoK')).toBe(null);
    expect(codeOf('nonsense')).toBe(null);
  });

  it('asks the server once per shared thing, with the guest id, and keeps the answer', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { code: 'Ab12Cd34' } }) }));
    vi.stubGlobal('fetch', fetch);
    const { shareLinkFor } = await load();
    const what = { kind: 'card', songId: 's1', partyId: 'ABCD', playStartedAt: 1760000000000 };
    expect(await shareLinkFor(what)).toBe('https://singspree.com/sing/s1?r=Ab12Cd34');
    expect(await shareLinkFor({ ...what })).toBe('https://singspree.com/sing/s1?r=Ab12Cd34');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...what, guestId: 'guest-browser-1' });
    await shareLinkFor({ ...what, kind: 'video' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a server that fails or is slow: the plain song link, asked again next time', async () => {
    let answer = () => Promise.reject(new Error('offline'));
    vi.stubGlobal('fetch', vi.fn(() => answer()));
    const { shareLinkFor } = await load();
    expect(await shareLinkFor({ kind: 'card', songId: 's1' })).toBe('https://singspree.com/sing/s1');
    answer = () => new Promise(() => {}); // never answers
    vi.useFakeTimers();
    const slow = shareLinkFor({ kind: 'card', songId: 's1' }, { wait: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await slow).toBe('https://singspree.com/sing/s1');
  });

  it('a sent share goes out as a beacon with the code; a link without one sends nothing', async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    const { shareSent } = await load();
    shareSent('https://singspree.com/sing/s1?r=Ab12Cd34');
    shareSent('https://singspree.com/sing/s1');
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/shares/Ab12Cd34/sent');
  });

  it('a good song: three stars, or a best beaten; a first play alone is not', async () => {
    const { isGoodSong } = await load();
    expect(isGoodSong({ stars: 3 })).toBe(true);
    expect(isGoodSong({ stars: 2, newBest: true, previousBest: null })).toBe(false);
    expect(isGoodSong({ stars: 1, newBest: true, previousBest: 1200 })).toBe(true);
    expect(isGoodSong({ stars: 2, newBest: false, previousBest: 5000 })).toBe(false);
    expect(isGoodSong(null)).toBe(false);
  });

  it('the landing: kept for its song until answered', async () => {
    const { captureShareArrival, pendingLanding, landingDone } = await load();
    captureShareArrival('s1', 'Ab12Cd34');
    expect(pendingLanding('s1')).toEqual({ code: 'Ab12Cd34' });
    expect(pendingLanding('s2')).toBe(null);
    landingDone();
    expect(pendingLanding('s1')).toBe(null);
    captureShareArrival('s1', 'bad');
    expect(pendingLanding('s1')).toBe(null);
  });

  it('the visit: once per code; an unknown code is null', async () => {
    const fetch = vi.fn(async (url) => (url.includes('ZZZZZZZZ')
      ? { ok: false, status: 404 }
      : { ok: true, status: 200, json: async () => ({ data: { songId: 's1', from: { name: 'Anna', score: 7240, stars: 4 } } }) }));
    vi.stubGlobal('fetch', fetch);
    const { visitShare } = await load();
    expect((await visitShare('Ab12Cd34')).from.name).toBe('Anna');
    await visitShare('Ab12Cd34');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await visitShare('ZZZZZZZZ')).toBe(null);
    expect(await visitShare('nope')).toBe(null);
  });
});
