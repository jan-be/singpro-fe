import { describe, it, expect, vi } from 'vitest';
import { createPartyAccess, fetchInParty } from './partyAccess';

describe('createPartyAccess', () => {
  it('waits until the page is in its party', async () => {
    const access = createPartyAccess();
    const waiting = access.wait(1000);
    access.open();
    expect(await waiting).toBe(true);
    expect(await access.wait(1000)).toBe(true);
    expect(access.ready).toBe(true);
  });

  it('gives up after the timeout (the request goes anyway, and is retried on a 403)', async () => {
    vi.useFakeTimers();
    try {
      const access = createPartyAccess();
      const waiting = access.wait(500);
      vi.advanceTimersByTime(501);
      expect(await waiting).toBe(false);
      access.open(); // a late open does not trip over the waiter that gave up
      expect(access.ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetchInParty', () => {
  const answers = (...statuses: number[]) => {
    const calls: string[] = [];
    return { calls, fetchImpl: async (u: string) => { calls.push(u); return { status: statuses[Math.min(calls.length - 1, statuses.length - 1)] } as Response; } };
  };
  const sleep = async () => {};

  it('tries again while the server says the page is not in the party yet', async () => {
    const f = answers(403, 403, 200);
    const r = await fetchInParty('/api/songs/s1', { fetchImpl: f.fetchImpl, sleep });
    expect(r.status).toBe(200);
    expect(f.calls).toHaveLength(3);
  });

  it('stops after `tries`, and does not retry anything but a 403', async () => {
    const refused = answers(403);
    expect((await fetchInParty('/x', { tries: 4, fetchImpl: refused.fetchImpl, sleep })).status).toBe(403);
    expect(refused.calls).toHaveLength(4);
    const missing = answers(404);
    expect((await fetchInParty('/x', { fetchImpl: missing.fetchImpl, sleep })).status).toBe(404);
    expect(missing.calls).toHaveLength(1);
  });
});
