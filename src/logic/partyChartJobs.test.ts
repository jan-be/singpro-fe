import { describe, expect, it } from 'vitest';
import { firstPlayable, handlePartyMessage, isPendingEntry, _partyChartState } from './partyChartJobs';

const pendingEntry = (id, extra = {}) => ({ songId: null, title: `Video ${id}`, artist: '', videoId: `vid${id}`, addedBy: 'Ann',
  job: { id, status: 'generating', progress: { stage: 'separate', fraction: 0.3, eta: 90 }, at: 10 }, ...extra });
const song = (id) => ({ songId: id, title: id, artist: 'A', videoId: `v${id}`, addedBy: 'Bo' });

describe('the queue with songs being charted', () => {
  it('plays the first entry that can play; pending ones are passed over', () => {
    expect(firstPlayable([pendingEntry(1), song('a'), song('b')]).songId).toBe('a');
    expect(firstPlayable([pendingEntry(1)])).toBe(null);
    expect(firstPlayable([])).toBe(null);
    expect(isPendingEntry(pendingEntry(1))).toBe(true);
    expect(isPendingEntry(song('a'))).toBe(false);
  });

  it('follows the party: entries, fresher pushes, refusals, and a word when one is ready', () => {
    handlePartyMessage({ type: 'party:state', data: { chartJobs: { maxPending: 3 }, queue: [pendingEntry(1), song('a')] } });
    let s = _partyChartState();
    expect(s.maxPending).toBe(3);
    expect(s.pending).toEqual([1]);
    expect(s.jobs[1].progress.stage).toBe('separate');
    expect(s.jobs[1].receivedAt).toBeGreaterThan(0);

    // a push newer than the entry's copy wins; an older one is ignored; unknown jobs too
    handlePartyMessage({ type: 'party:chart_job', data: { job: { id: 1, status: 'generating', progress: { stage: 'notes', eta: 20 }, at: 20 } } });
    handlePartyMessage({ type: 'party:chart_job', data: { job: { id: 1, status: 'generating', progress: { stage: 'lyrics', eta: 80 }, at: 15 } } });
    handlePartyMessage({ type: 'party:chart_job', data: { job: { id: 9, status: 'generating', progress: { stage: 'notes' }, at: 30 } } });
    s = _partyChartState();
    expect(s.jobs[1].progress.stage).toBe('notes');
    expect(s.jobs[9]).toBe(undefined);
    // the queue sent again with the same (older) entry copy keeps the fresher one
    handlePartyMessage({ type: 'party:queue_updated', data: { queue: [pendingEntry(1), song('a')] } });
    expect(_partyChartState().jobs[1].progress.stage).toBe('notes');

    handlePartyMessage({ type: 'party:queue_refused', data: { reason: 'pending_limit', jobId: 4 } });
    expect(_partyChartState().notice.reason).toBe('pending_limit');

    // done: the entry is a song now
    handlePartyMessage({ type: 'party:queue_updated', data: { queue: [{ songId: 'gen1', title: 'Glue Song', artist: 'beabadoobee', videoId: 'vid1', generated: true }, song('a')] } });
    s = _partyChartState();
    expect(s.pending).toEqual([]);
    expect(s.ready.title).toBe('Glue Song');
  });
});
