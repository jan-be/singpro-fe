import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetTracker, forget, setFocusedChartJob, trackChartJob } from './chartJobTracker';

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

describe('chartJobTracker', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
    _resetTracker();
  });
  afterEach(() => _resetTracker());

  it('follows a job until it is finished, keeps it across a reload, and forgets it on request', async () => {
    const copies = [
      { id: 3, status: 'generating', progress: { stage: 'separate', eta: 90 }, at: 2 },
      { id: 3, status: 'generating', progress: { stage: 'notes', eta: 20 }, at: 3 },
      { id: 3, status: 'done', songId: 'gen3', progress: { stage: 'done' }, at: 4 },
    ];
    let resolveDone;
    const finished = new Promise(r => { resolveDone = r; });
    trackChartJob({ id: 3, status: 'queued', videoId: 'vid3', progress: { stage: 'queued', position: 1 }, at: 1 }, { videoTitle: 'Video 3' }, {
      getJob: async () => { const j = copies.shift(); if (!copies.length) setTimeout(resolveDone, 0); return j; },
      sleep: async () => {},
    });
    await finished;
    const saved = JSON.parse(localStorage.getItem('singpro_chart_jobs'));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 3, videoId: 'vid3', videoTitle: 'Video 3', job: { status: 'done', songId: 'gen3' } });

    // a reload: read back from storage
    _resetTracker();
    globalThis.localStorage.setItem('singpro_chart_jobs', JSON.stringify(saved));
    trackChartJob(null); // loads without adding anything
    setFocusedChartJob(3);
    forget(3);
    expect(JSON.parse(localStorage.getItem('singpro_chart_jobs'))).toEqual([]);
  });

  it('forgets jobs older than a day', () => {
    localStorage.setItem('singpro_chart_jobs', JSON.stringify([
      { id: 1, startedAt: Date.now() - 25 * 3600 * 1000, job: { id: 1, status: 'done' } },
      { id: 2, startedAt: Date.now() - 3600 * 1000, job: { id: 2, status: 'done' } },
    ]));
    trackChartJob(null);
    forget(99);
    trackChartJob({ id: 5, status: 'done', songId: 's' });
    const ids = JSON.parse(localStorage.getItem('singpro_chart_jobs')).map(e => e.id);
    expect(ids).toEqual([5, 2]);
  });
});
