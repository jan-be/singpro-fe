import { apiUrl } from '../GlobalConsts';
import { ApiError } from './authApi';

/**
 * Charts for YouTube videos nobody has charted yet (backend routes/chartJobs.js):
 * the search bar offers one when a pasted link matches no song, the backend
 * downloads the audio and has the chart generated (about two minutes), and
 * the finished song opens like any other.
 */

async function call(method, path, body) {
  let r;
  try {
    r = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server', 0);
  }
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  if (!r.ok || json?.success === false) throw new ApiError(json?.code ?? 'network', json?.error ?? `Request failed (${r.status})`, r.status);
  return json;
}

/** -> { songId } when the video is a song already, else { job } */
export const startChartJob = (videoId) => call('POST', '/chart-jobs', { videoId });
export const getChartJob = (id) => call('GET', `/chart-jobs/${id}`).then(j => j.job);

export const FINISHED = new Set(['done', 'rejected', 'failed']);

/**
 * Polls a job until it is finished; onUpdate(job) on every status change.
 * Resolves with the finished job; rejects with an AbortError when `signal` aborts.
 */
export async function waitForChartJob(id, { onUpdate = () => {}, signal, intervalMs = 3000, getJob = getChartJob,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  let last = null;
  for (;;) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    let job;
    try {
      job = await getJob(id);
    } catch (e) {
      if (e.code !== 'network') throw e;   // a hiccup: try again on the next tick
    }
    if (job && job.status !== last) { last = job.status; onUpdate(job); }
    if (job && FINISHED.has(job.status)) return job;
    await sleep(intervalMs);
  }
}

/** The i18n key (under search.generate) that describes a job's state to the user */
export function chartJobMessageKey(job) {
  if (!job) return 'starting';
  switch (job.status) {
    case 'queued': return 'queued';
    case 'downloading': return 'downloading';
    case 'generating': return 'generating';
    case 'done': return 'done';
    case 'rejected': return 'rejected';
    default: return ['too_long', 'live'].includes(job.error) ? job.error : 'failed';
  }
}
