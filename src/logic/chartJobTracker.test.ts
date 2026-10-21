import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetTracker, forget, setFocusedChartJob, trackChartJob, type TrackedChartJob } from './chartJobTracker';
import type { ChartJob } from './chartJobs';

class MemoryStorage {
  declare m: Map<string, string>;
  constructor() { this.m = new Map(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: unknown) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

/** What the tracker saved (null: nothing) */
const stored = (): TrackedChartJob[] | null => JSON.parse(localStorage.getItem('singspree_chart_jobs') ?? 'null');

describe('chartJobTracker', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    _resetTracker();
  });
  afterEach(() => _resetTracker());

  it('follows a job until it is finished, keeps it across a reload, and forgets it on request', async () => {
    const copies: ChartJob[] = [
      { id: 3, status: 'generating', progress: { stage: 'separate', eta: 90 }, at: 2 },
      { id: 3, status: 'generating', progress: { stage: 'notes', eta: 20 }, at: 3 },
      { id: 3, status: 'done', songId: 'gen3', progress: { stage: 'done' }, at: 4 },
    ];
    let resolveDone: (value?: unknown) => void;
    const finished = new Promise(r => { resolveDone = r; });
    trackChartJob({ id: 3, status: 'queued', videoId: 'vid3', progress: { stage: 'queued', position: 1 }, at: 1 }, { videoTitle: 'Video 3' }, {
      getJob: async () => {
        const j = copies.shift();
        if (!j) throw new Error('no more copies');
        if (!copies.length) setTimeout(resolveDone, 0);
        return j;
      },
      sleep: async () => {},
    });
    await finished;
    const saved = stored();
    expect(saved).toHaveLength(1);
    expect(saved?.[0]).toMatchObject({ id: 3, videoId: 'vid3', videoTitle: 'Video 3', job: { status: 'done', songId: 'gen3' } });

    // a reload: read back from storage
    _resetTracker();
    globalThis.localStorage.setItem('singspree_chart_jobs', JSON.stringify(saved));
    trackChartJob(undefined); // loads without adding anything
    setFocusedChartJob(3);
    forget(3);
    expect(stored()).toEqual([]);
  });

  it('forgets jobs older than a day', () => {
    localStorage.setItem('singspree_chart_jobs', JSON.stringify([
      { id: 1, startedAt: Date.now() - 25 * 3600 * 1000, job: { id: 1, status: 'done' } },
      { id: 2, startedAt: Date.now() - 3600 * 1000, job: { id: 2, status: 'done' } },
    ]));
    trackChartJob(undefined);
    forget(99);
    trackChartJob({ id: 5, status: 'done', songId: 's' });
    const ids = stored()?.map(e => e.id);
    expect(ids).toEqual([5, 2]);
  });
});
