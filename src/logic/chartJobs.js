import { apiUrl } from '../GlobalConsts';
import { ApiError } from './authApi';

/**
 * Charts for YouTube videos nobody has charted yet (backend routes/chartJobs.js):
 * the home page's search and the party queue's offer one when a pasted link
 * matches no song, the backend downloads the audio and has the chart
 * generated (about three minutes), and the finished song plays like any
 * other. While it is made, a job reports its progress: its place in line,
 * then the stage and the time left (job.progress, see progressAt).
 *
 * Who is offered it follows the backend's one switch (chartAccess() in
 * singpro-be chartJobs.js), read from GET /chart-jobs/access: chartOffer().
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

/** -> { songId, song? } when the video is a song already, else { job } */
export const startChartJob = (videoId) => call('POST', '/chart-jobs', { videoId });
export const getChartJob = (id) => call('GET', `/chart-jobs/${id}`).then(j => j.job);

export const FINISHED = new Set(['done', 'rejected', 'failed']);

// A server from before the switch (no /chart-jobs/access) offered it to admins only
const LEGACY_ACCESS = { enabled: true, access: 'admins', maxPending: 0 };
let accessPromise = null;

/** { enabled, access: 'admins' | 'everyone', maxPending }, asked once per page load */
export function getChartAccess() {
  accessPromise ??= fetch(`${apiUrl}/chart-jobs/access`)
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j?.success
      ? { enabled: Boolean(j.enabled), access: j.access === 'everyone' ? 'everyone' : 'admins', maxPending: Number(j.maxPending) || 0 }
      : LEGACY_ACCESS))
    .catch(() => { accessPromise = null; return LEGACY_ACCESS; });
  return accessPromise;
}

/**
 * What a viewer is offered for a link no song has: 'offer' (a button that
 * starts a chart), 'signIn' (a link to sign in first) or null (nothing).
 */
export function chartOffer(access, user) {
  if (!access?.enabled) return null;
  if (access.access === 'everyone') return user ? 'offer' : 'signIn';
  return user?.isAdmin ? 'offer' : null;
}

/**
 * Polls a job until it is finished; onUpdate(job) whenever its status, place
 * in line, stage, time left or name changed. Resolves with the finished job;
 * rejects with an AbortError when `signal` aborts.
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
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (job) {
      const key = JSON.stringify([job.status, job.progress?.stage, job.progress?.position, job.progress?.eta, job.title, job.songId]);
      if (key !== last) { last = key; onUpdate(job); }
      if (FINISHED.has(job.status)) return job;
    }
    await sleep(intervalMs);
  }
}

/** The i18n key (under search.generate) of a job's outcome or refusal, for the home page's search */
export function chartJobMessageKey(job) {
  if (!job) return 'starting';
  switch (job.status) {
    case 'done': return 'done';
    case 'rejected': return 'rejected';
    case 'failed': return ['too_long', 'live'].includes(job.error) ? job.error : 'failed';
    default: return 'starting';
  }
}

const STAGES = new Set(['queued', 'download', 'starting', 'separate', 'lyrics', 'transcribe', 'align', 'pitch', 'notes', 'check',
  'saving', 'generating', 'done']);

/** The i18n key (under chartJob.stage) of what a job is doing now; null once it failed */
export function stageKey(job) {
  if (!job) return 'queued';
  if (job.status === 'done') return 'done';
  if (job.status === 'failed' || job.status === 'rejected') return null;
  if (job.status === 'queued') return 'queued';
  const s = job.progress?.stage;
  if (STAGES.has(s)) return s;
  return job.status === 'downloading' ? 'download' : 'generating';
}

/** The i18n key (under chartJob.reason) of why a job ended without a song */
export function reasonKey(job) {
  if (job?.status === 'rejected') return 'rejected';
  return ['too_long', 'live'].includes(job?.error) ? job.error : 'failed';
}

/**
 * Where the bar stands and the seconds left, `elapsedMs` after this copy of
 * the job arrived: between two reports it moves on at the pace the estimate
 * predicts (fraction + (1 - fraction) * elapsed / eta), stopping short of the
 * end. -> { fraction 0..1, eta seconds or null }
 */
export function progressAt(job, elapsedMs = 0) {
  if (job?.status === 'done') return { fraction: 1, eta: 0 };
  const p = job?.progress;
  if (!p) return { fraction: 0, eta: null };
  const f0 = Math.min(1, Math.max(0, Number(p.fraction) || 0));
  const eta0 = Number(p.eta);
  if (!Number.isFinite(eta0)) return { fraction: f0, eta: null };
  const dt = Math.max(0, elapsedMs / 1000);
  const eta = Math.max(0, eta0 - dt);
  if (job.status === 'queued' || eta0 <= 0) return { fraction: f0, eta };
  return { fraction: Math.min(0.99, Math.max(f0, f0 + (1 - f0) * Math.min(1, dt / eta0))), eta };
}

/** Seconds left as words: { key (under chartJob.eta), count } or null when unknown */
export function etaWords(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 10) return { key: 'almost', count: 0 };
  if (seconds < 50) return { key: 'seconds', count: Math.ceil(seconds / 10) * 10 };
  return { key: 'minutes', count: Math.max(1, Math.round(seconds / 60)) };
}

/** Of two copies of a job (a queue entry's and a fresher one pushed since), the newer */
export const newerJob = (a, b) => (!a ? b : !b ? a : ((b.at ?? 0) >= (a.at ?? 0) ? b : a));
