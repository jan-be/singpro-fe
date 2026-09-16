import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('./referrer.js');
};

const setUp = ({ referrer = '', origin = 'https://singpro.app', store = new Map() } = {}) => {
  vi.stubGlobal('document', { referrer });
  vi.stubGlobal('window', { location: { origin } });
  vi.stubGlobal('sessionStorage', {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  });
  return store;
};

describe('referrer', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('remembers where an external link sent us', async () => {
    setUp({ referrer: 'https://alternativeto.net/software/singpro/' });
    const { captureReferrer, getReferrer } = await load();
    captureReferrer();
    expect(getReferrer()).toBe('https://alternativeto.net/software/singpro/');
  });

  it('treats our own pages as no referrer', async () => {
    setUp({ referrer: 'https://singpro.app/sing/J5T97Pd4HrQ' });
    const { captureReferrer, getReferrer } = await load();
    captureReferrer();
    expect(getReferrer()).toBe(null);
  });

  it('a direct visit has none', async () => {
    setUp({ referrer: '' });
    const { captureReferrer, getReferrer } = await load();
    captureReferrer();
    expect(getReferrer()).toBe(null);
  });

  it('keeps the first referrer, so in-app navigation cannot erase it', async () => {
    const store = setUp({ referrer: 'https://news.ycombinator.com/' });
    const first = await load();
    first.captureReferrer();

    // later in the same tab, document.referrer is gone
    setUp({ referrer: '', store });
    const later = await load();
    later.captureReferrer();
    expect(later.getReferrer()).toBe('https://news.ycombinator.com/');
  });

  it('truncates an absurdly long referrer', async () => {
    setUp({ referrer: 'https://example.com/?q=' + 'x'.repeat(2000) });
    const { captureReferrer, getReferrer } = await load();
    captureReferrer();
    expect(getReferrer().length).toBe(500);
  });

  it('survives sessionStorage being unavailable', async () => {
    vi.stubGlobal('document', { referrer: 'https://alternativeto.net/' });
    vi.stubGlobal('window', { location: { origin: 'https://singpro.app' } });
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    const { captureReferrer, getReferrer } = await load();
    expect(() => captureReferrer()).not.toThrow();
    expect(getReferrer()).toBe(null);
  });
});
