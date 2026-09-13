import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return (await import('./sessionId.js')).getSessionId;
};

describe('getSessionId', () => {
  const store = new Map();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses the stored id', async () => {
    const getSessionId = await load();
    const first = getSessionId();
    expect(getSessionId()).toBe(first);
    expect(store.get('sessionId')).toBe(first);
  });

  it('works without crypto.randomUUID (old WebView, or plain http)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: a => { a.fill(7); return a; } });
    const getSessionId = await load();
    expect(getSessionId()).toBe('07'.repeat(16));
  });

  it('works without any crypto at all', async () => {
    vi.stubGlobal('crypto', undefined);
    const getSessionId = await load();
    expect(getSessionId()).toMatch(/^[0-9a-f]+-/);
  });

  it('survives sessionStorage throwing, and stays stable', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    const getSessionId = await load();
    const first = getSessionId();
    expect(first).toBeTruthy();
    expect(getSessionId()).toBe(first);
  });
});
