import { describe, expect, it } from 'vitest';
import { chartJobMessageKey, chartOffer, etaWords, newerJob, progressAt, reasonKey, stageKey, waitForChartJob } from './chartJobs';

describe('waitForChartJob', () => {
  it('reports each change once and resolves with the finished job', async () => {
    const states = ['queued', 'queued', 'downloading', 'generating', 'generating', 'done'];
    const seen = [];
    const job = await waitForChartJob(7, {
      getJob: async () => ({ id: 7, status: states.shift(), songId: states.length ? null : 'abc' }),
      onUpdate: (j) => seen.push(j.status), sleep: async () => {},
    });
    expect(seen).toEqual(['queued', 'downloading', 'generating', 'done']);
    expect(job.songId).toBe('abc');
  });

  it('reports a new stage, place in line or time left within a status', async () => {
    const copies = [
      { status: 'queued', progress: { stage: 'queued', position: 2, eta: 300 } },
      { status: 'queued', progress: { stage: 'queued', position: 1, eta: 200 } },
      { status: 'generating', progress: { stage: 'separate', eta: 120 } },
      { status: 'generating', progress: { stage: 'separate', eta: 120 } },
      { status: 'generating', progress: { stage: 'separate', eta: 100 } },
      { status: 'generating', progress: { stage: 'notes', eta: 30 } },
      { status: 'done', songId: 'x', progress: { stage: 'done' } },
    ];
    const seen = [];
    await waitForChartJob(7, { getJob: async () => copies.shift(), onUpdate: j => seen.push(`${j.progress.stage}:${j.progress.position ?? j.progress.eta ?? ''}`), sleep: async () => {} });
    expect(seen).toEqual(['queued:2', 'queued:1', 'separate:120', 'separate:100', 'notes:30', 'done:']);
  });

  it('rides out network hiccups but not real errors', async () => {
    let n = 0;
    const job = await waitForChartJob(7, {
      getJob: async () => { if (n++ < 2) throw Object.assign(new Error('x'), { code: 'network' }); return { status: 'failed', error: 'download' }; },
      sleep: async () => {},
    });
    expect(job.status).toBe('failed');
    await expect(waitForChartJob(7, { getJob: async () => { throw Object.assign(new Error('x'), { code: 'not_found' }); }, sleep: async () => {} }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('stops when aborted', async () => {
    const c = new AbortController();
    const p = waitForChartJob(7, { getJob: async () => ({ status: 'generating' }), signal: c.signal, sleep: async () => { c.abort(); } });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('words for a job', () => {
  it('the search bar: outcomes and the refusals users can act on', () => {
    expect(chartJobMessageKey(null)).toBe('starting');
    expect(chartJobMessageKey({ status: 'generating' })).toBe('starting');
    expect(chartJobMessageKey({ status: 'done' })).toBe('done');
    expect(chartJobMessageKey({ status: 'failed', error: 'too_long' })).toBe('too_long');
    expect(chartJobMessageKey({ status: 'failed', error: 'generator' })).toBe('failed');
    expect(chartJobMessageKey({ status: 'rejected', error: 'qa_hold' })).toBe('rejected');
  });

  it('the stage now running, also from a backend or generator that reports none', () => {
    expect(stageKey({ status: 'queued', progress: { stage: 'queued', position: 2 } })).toBe('queued');
    expect(stageKey({ status: 'generating', progress: { stage: 'transcribe' } })).toBe('transcribe');
    expect(stageKey({ status: 'generating', progress: { stage: 'pitch' } })).toBe('pitch');
    expect(stageKey({ status: 'generating', progress: { stage: 'generating' } })).toBe('generating');
    expect(stageKey({ status: 'generating' })).toBe('generating');
    expect(stageKey({ status: 'downloading' })).toBe('download');
    expect(stageKey({ status: 'generating', progress: { stage: 'something new' } })).toBe('generating');
    expect(stageKey({ status: 'done' })).toBe('done');
    expect(stageKey({ status: 'failed' })).toBe(null);
    expect(reasonKey({ status: 'rejected' })).toBe('rejected');
    expect(reasonKey({ status: 'failed', error: 'live' })).toBe('live');
    expect(reasonKey({ status: 'failed', error: 'download' })).toBe('failed');
  });

  it('the time left in round numbers', () => {
    expect(etaWords(null)).toBe(null);
    expect(etaWords(4)).toEqual({ key: 'almost', count: 0 });
    expect(etaWords(31)).toEqual({ key: 'seconds', count: 40 });
    expect(etaWords(55)).toEqual({ key: 'minutes', count: 1 });
    expect(etaWords(100)).toEqual({ key: 'minutes', count: 2 });
    expect(etaWords(185)).toEqual({ key: 'minutes', count: 3 });
  });
});

describe('progressAt', () => {
  const job = { status: 'generating', progress: { stage: 'separate', fraction: 0.4, eta: 60 } };

  it('moves on between reports at the pace the estimate predicts, and stops short of the end', () => {
    expect(progressAt(job, 0)).toEqual({ fraction: 0.4, eta: 60 });
    const half = progressAt(job, 30_000);
    expect(half.eta).toBe(30);
    expect(half.fraction).toBeCloseTo(0.7, 5);
    expect(progressAt(job, 600_000)).toEqual({ fraction: 0.99, eta: 0 });
  });

  it('a queued job only counts down; done is full; no report is no bar', () => {
    expect(progressAt({ status: 'queued', progress: { stage: 'queued', fraction: 0, eta: 100 } }, 10_000)).toEqual({ fraction: 0, eta: 90 });
    expect(progressAt({ status: 'done' }, 0)).toEqual({ fraction: 1, eta: 0 });
    expect(progressAt({ status: 'generating' }, 5000)).toEqual({ fraction: 0, eta: null });
  });

  it('of two copies the newer one wins', () => {
    const a = { id: 1, at: 5 }, b = { id: 1, at: 9 };
    expect(newerJob(a, b)).toBe(b);
    expect(newerJob(b, a)).toBe(b);
    expect(newerJob(null, a)).toBe(a);
  });
});

describe('chartOffer: the one switch, as the backend reports it', () => {
  const admin = { isAdmin: true }, user = { isAdmin: false };
  it('admins only: admins get the button, nobody else anything', () => {
    const access = { enabled: true, access: 'admins' };
    expect(chartOffer(access, admin)).toBe('offer');
    expect(chartOffer(access, user)).toBe(null);
    expect(chartOffer(access, null)).toBe(null);
  });
  it('everyone: signed-in users get the button, signed-out ones a sign-in link', () => {
    const access = { enabled: true, access: 'everyone' };
    expect(chartOffer(access, user)).toBe('offer');
    expect(chartOffer(access, null)).toBe('signIn');
  });
  it('switched off or not known yet: nothing', () => {
    expect(chartOffer({ enabled: false, access: 'everyone' }, admin)).toBe(null);
    expect(chartOffer({ enabled: true, access: 'off' }, admin)).toBe(null);
    expect(chartOffer(null, admin)).toBe(null);
  });
});
