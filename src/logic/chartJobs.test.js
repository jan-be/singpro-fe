import { describe, expect, it } from 'vitest';
import { chartJobMessageKey, waitForChartJob } from './chartJobs';

describe('waitForChartJob', () => {
  it('reports each status once and resolves with the finished job', async () => {
    const states = ['queued', 'queued', 'downloading', 'generating', 'generating', 'done'];
    const seen = [];
    const job = await waitForChartJob(7, {
      getJob: async () => ({ id: 7, status: states.shift(), songId: states.length ? null : 'abc' }),
      onUpdate: (j) => seen.push(j.status), sleep: async () => {},
    });
    expect(seen).toEqual(['queued', 'downloading', 'generating', 'done']);
    expect(job.songId).toBe('abc');
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

describe('chartJobMessageKey', () => {
  it('maps statuses and the refusals users can act on', () => {
    expect(chartJobMessageKey(null)).toBe('starting');
    expect(chartJobMessageKey({ status: 'generating' })).toBe('generating');
    expect(chartJobMessageKey({ status: 'failed', error: 'too_long' })).toBe('too_long');
    expect(chartJobMessageKey({ status: 'failed', error: 'generator' })).toBe('failed');
    expect(chartJobMessageKey({ status: 'rejected', error: 'qa_hold' })).toBe('rejected');
  });
});
