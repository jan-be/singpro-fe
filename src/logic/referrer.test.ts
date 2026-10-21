import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('./referrer');
};

/**
 * A page load at `url`: document.referrer, location, history (replaceState
 * moves the location, as the browser's does) and a sessionStorage backed by
 * `store`, which a later load in the same tab passes on.
 */
const setUp = ({ referrer = '', url = 'https://singspree.com/', store = new Map<string, string>() } = {}) => {
  const location = { href: '', origin: '', hostname: '', pathname: '', search: '', hash: '' };
  const moveTo = (href: string) => {
    const u = new URL(href, location.origin || url);
    Object.assign(location, { href: u.href, origin: u.origin, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash });
  };
  moveTo(url);
  const replaced: { state: unknown; to: string }[] = [];
  const history = { state: { idx: 0 }, replaced, replaceState: vi.fn((state: unknown, _title: string, to: string) => { replaced.push({ state, to }); moveTo(to); }) };
  vi.stubGlobal('document', { referrer });
  vi.stubGlobal('window', { location, history });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: unknown) => store.set(k, String(v)),
  });
  return { store, location, history };
};

/** A fresh page load, captured the way index.tsx does. */
const arrive = async (opts?: Parameters<typeof setUp>[0]) => {
  const env = setUp(opts);
  const mod = await load();
  mod.captureReferrer();
  return { ...env, ...mod };
};

describe('referrer', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('remembers where an external link sent us', async () => {
    const { getReferrer, getArrival } = await arrive({ referrer: 'https://alternativeto.net/software/singspree/' });
    expect(getReferrer()).toBe('https://alternativeto.net/software/singspree/');
    expect(getArrival()).toBe(null);
  });

  it('treats our own pages as no referrer', async () => {
    const { getReferrer } = await arrive({ referrer: 'https://singspree.com/sing/J5T97Pd4HrQ' });
    expect(getReferrer()).toBe(null);
  });

  it('a direct visit has none', async () => {
    const { getReferrer, getArrival } = await arrive({ referrer: '' });
    expect(getReferrer()).toBe(null);
    expect(getArrival()).toBe(null);
  });

  it('keeps the first referrer, so in-app navigation cannot erase it', async () => {
    const { store } = await arrive({ referrer: 'https://news.ycombinator.com/' });

    // later in the same tab, document.referrer is gone
    const later = await arrive({ referrer: '', store });
    expect(later.getReferrer()).toBe('https://news.ycombinator.com/');
  });

  it('truncates an absurdly long referrer', async () => {
    const { getReferrer } = await arrive({ referrer: 'https://example.com/?q=' + 'x'.repeat(2000) });
    expect(getReferrer()?.length).toBe(500);
  });

  it('keeps it for the page load when sessionStorage is unavailable', async () => {
    const { location, history } = setUp({ referrer: 'https://alternativeto.net/', url: 'https://singspree.com/join/ABCD?qr' });
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    const { captureReferrer, getReferrer, getArrival } = await load();
    expect(() => captureReferrer()).not.toThrow();
    // the join flow (join page → party) is client-side, so this page load is all it needs
    expect(getReferrer()).toBe('https://alternativeto.net/');
    expect(getArrival()).toBe('qr');
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(location.search).toBe('');
  });

  describe('arrivals by our own links', () => {
    it('the party QR code: recorded, and the tag leaves the address bar', async () => {
      const { getArrival, getReferrer, location, history } = await arrive({ url: 'https://singspree.com/join/ABCD?qr' });
      expect(getArrival()).toBe('qr');
      expect(getReferrer()).toBe(null);
      expect(location.pathname + location.search).toBe('/join/ABCD');
      expect(history.replaced).toEqual([{ state: { idx: 0 }, to: '/join/ABCD' }]); // the router's state survives
    });

    it('the copied party link', async () => {
      const { getArrival, location } = await arrive({ url: 'https://singspree.com/join/ABCD?l' });
      expect(getArrival()).toBe('link');
      expect(location.search).toBe('');
    });

    it('a tagged link opened from a web page keeps that page as the referrer too', async () => {
      const { getArrival, getReferrer } = await arrive({ url: 'https://singspree.com/join/ABCD?l', referrer: 'https://discord.com/channels/1/2' });
      expect(getArrival()).toBe('link');
      expect(getReferrer()).toBe('https://discord.com/channels/1/2');
    });

    it('only the tag is taken out: other parameters and the hash stay', async () => {
      const { getArrival, location } = await arrive({ url: 'https://singspree.com/join/ABCD?debug=1&qr#x' });
      expect(getArrival()).toBe('qr');
      expect(location.pathname + location.search + location.hash).toBe('/join/ABCD?debug=1#x');
    });

    it('a join URL without a tag: typed, passed on from the address bar, or an old link', async () => {
      const { getArrival, history } = await arrive({ url: 'https://singspree.com/join/ABCD' });
      expect(getArrival()).toBe('join');
      expect(history.replaceState).not.toHaveBeenCalled();
    });

    it('the legacy /mic/ link and a language-prefixed join URL are join URLs as well', async () => {
      expect((await arrive({ url: 'https://singspree.com/mic/ABCD/Jan' })).getArrival()).toBe('join');
      const prefixed = await arrive({ url: 'https://singspree.com/de/join/ABCD?qr' });
      expect(prefixed.getArrival()).toBe('qr');
      expect(prefixed.location.pathname + prefixed.location.search).toBe('/de/join/ABCD'); // the router's redirect takes it from here
    });

    it('a friend invite link, whose ?add=1 stays for the profile page to act on', async () => {
      const { getArrival, location, history } = await arrive({ url: 'https://singspree.com/u/Jan?add=1' });
      expect(getArrival()).toBe('invite');
      expect(location.search).toBe('?add=1');
      expect(history.replaceState).not.toHaveBeenCalled();
    });

    it('a shared song link: recorded as a share, its code kept for the landing, the tag out of the address bar', async () => {
      const { getArrival, location, store } = await arrive({ url: 'https://singspree.com/sing/5I7Jr21fpoK?r=Ab12Cd34' });
      expect(getArrival()).toBe('share');
      expect(location.pathname + location.search).toBe('/sing/5I7Jr21fpoK');
      expect(JSON.parse(store.get('singspree_share_landing') ?? 'null')).toEqual({ songId: '5I7Jr21fpoK', code: 'Ab12Cd34' });
      // a reload of the song page is the same arrival, and no new landing
      store.delete('singspree_share_landing');
      const reloaded = await arrive({ url: 'https://singspree.com/sing/5I7Jr21fpoK', store });
      expect(reloaded.getArrival()).toBe('share');
      expect(store.has('singspree_share_landing')).toBe(false);
    });

    it('a share tag with a code that is not one is taken out and counts as nothing', async () => {
      const { getArrival, location, store } = await arrive({ url: 'https://singspree.com/sing/5I7Jr21fpoK?r=../../x' });
      expect(getArrival()).toBe(null);
      expect(location.search).toBe('');
      expect(store.has('singspree_share_landing')).toBe(false);
      // ?r on another page is not a share
      expect((await arrive({ url: 'https://singspree.com/?r=Ab12Cd34' })).getArrival()).toBe(null);
    });

    it('?q elsewhere is the home page search, not anything of ours', async () => {
      const { getArrival, history } = await arrive({ url: 'https://singspree.com/?q=abba' });
      expect(getArrival()).toBe(null);
      expect(history.replaceState).not.toHaveBeenCalled();
      expect((await arrive({ url: 'https://singspree.com/u/Jan' })).getArrival()).toBe(null);
    });

    it('survives the join flow and a reload: once captured, the tab keeps it', async () => {
      const { store } = await arrive({ url: 'https://singspree.com/join/ABCD?qr' });
      // join page → party, client-side; then the singer reloads the party page
      const reloaded = await arrive({ url: 'https://singspree.com/sing/5I7Jr21fpoK', store });
      expect(reloaded.getArrival()).toBe('qr');
      // or reloads the join page, whose address no longer has the tag
      const again = await arrive({ url: 'https://singspree.com/join/ABCD', store });
      expect(again.getArrival()).toBe('qr');
    });

    it('a tagged link is a new arrival even in a tab that had one; anything else is not', async () => {
      const { store } = await arrive({ url: 'https://singspree.com/', referrer: 'https://www.google.com/' });
      const untagged = await arrive({ url: 'https://singspree.com/join/ABCD', store });
      expect(untagged.getArrival()).toBe(null);
      expect(untagged.getReferrer()).toBe('https://www.google.com/');

      const pasted = await arrive({ url: 'https://singspree.com/join/WXYZ?l', store });
      expect(pasted.getArrival()).toBe('link');
      expect(pasted.getReferrer()).toBe(null); // this arrival had none
    });

    it('a tab captured by an older release (referrer, no arrival) reads as no arrival', async () => {
      const store = new Map([['singspree_referrer', '']]);
      const { getArrival } = await arrive({ url: 'https://singspree.com/join/ABCD', store });
      expect(getArrival()).toBe(null);
    });

    it('ignores a stored value it does not know', async () => {
      const store = new Map([['singspree_referrer', ''], ['singspree_arrival', 'carrier-pigeon']]);
      const { getArrival } = await arrive({ url: 'https://singspree.com/', store });
      expect(getArrival()).toBe(null);
    });
  });

  describe('partyJoinUrl', () => {
    it('tags the QR code and the copied link with one letter, and leaves the plain URL alone', async () => {
      setUp();
      const { partyJoinUrl } = await load();
      expect(partyJoinUrl('ABCD', 'qr', 'singspree.com')).toBe('https://singspree.com/j/ABCD?qr');
      expect(partyJoinUrl('ABCD', 'link', 'singspree.com')).toBe('https://singspree.com/j/ABCD?l');
      expect(partyJoinUrl('ABCD', undefined, 'singspree.com')).toBe('https://singspree.com/j/ABCD');
      expect(partyJoinUrl('ABCD', 'qr')).toBe('https://singspree.com/j/ABCD?qr'); // this page's host
      expect(new TextEncoder().encode(partyJoinUrl('ABCD', 'qr', 'singspree.com')).length).toBeLessThanOrEqual(32); // QR version 2
    });

    it('what it generates reads back as the same arrival', async () => {
      setUp();
      const { partyJoinUrl, arrivalFrom } = await load();
      for (const via of ['qr', 'link']) {
        const u = new URL(partyJoinUrl('K7QX', via, 'singspree.com'));
        expect(arrivalFrom(u.pathname, u.search).arrival).toBe(via);
      }
      const plain = new URL(partyJoinUrl('K7QX', null, 'singspree.com'));
      expect(arrivalFrom(plain.pathname, plain.search).arrival).toBe('join');
    });
  });
});
