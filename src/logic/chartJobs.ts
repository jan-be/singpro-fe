import { apiUrl } from '../GlobalConsts';
import { ApiError } from './authApi';

/**
 * Charts for YouTube videos nobody has charted yet (backend routes/chartJobs.ts):
 * the home page's search and the party queue's offer one when a pasted link
 * matches no song, the backend downloads the audio and has the chart
 * generated (about three minutes), and the finished song plays like any
 * other. While it is made, a job reports its progress: its place in line,
 * then the stage and the time left (job.progress, see progressAt).
 *
 * Who is offered it follows the backend's one switch (chartAccess() in
 * singspree-be chartJobs.ts: off, admins or everyone, flipped on /admin), read
 * from GET /chart-jobs/access once per page load: chartOffer().
 */

/** A chart job's status (backend: chart_jobs.status) */
export type ChartJobStatus = 'queued' | 'downloading' | 'generating' | 'done' | 'rejected' | 'failed';

/** Where a job stands (job.progress): its place in line while queued, then the stage and the time left */
export interface ChartJobProgress {
  stage?: string;
  step?: number;
  steps?: number;
  /** place in line while queued, 1 = next */
  position?: number;
  /** 0..1 */
  fraction?: number;
  /** seconds left */
  eta?: number | null;
}

/** A chart job as the backend reports it (singspree-be chartJobs.ts publicJob) */
export interface ChartJob {
  id: number;
  status: ChartJobStatus;
  /** the song, once it is made */
  songId?: string | null;
  error?: string | null;
  title?: string | null;
  artist?: string | null;
  decision?: string | null;
  videoId?: string | null;
  progress?: ChartJobProgress | null;
  /** when the server made this copy (ms), for newerJob */
  at?: number | null;
  /** Date.now() when this copy came (added here) */
  receivedAt?: number;
}

/** What the functions that put a job into words read of it: any copy, also a partial one */
export interface ChartJobLike {
  status?: string;
  progress?: ChartJobProgress | null;
  error?: string | null;
}

/** What POST /chart-jobs answers: the song when the video is one already, else the job */
export interface StartChartJobResult {
  songId?: string;
  song?: unknown;
  job?: ChartJob;
}

/** A video YouTube's search found (searchYouTube) */
export interface YouTubeResult {
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  views: number;
  /** a song here already */
  songId?: string;
}

/** Who is offered charts (GET /chart-jobs/access) */
export type ChartAccessLevel = 'off' | 'admins' | 'everyone';
export interface ChartAccess {
  enabled: boolean;
  access: ChartAccessLevel;
  maxPending: number;
}

/** What a viewer is offered for a link no song has (chartOffer) */
export type ChartOffer = 'offer' | 'signIn';

/** The answer's envelope: `success: false` with a code and an error on a refusal */
interface ApiAnswer {
  success?: boolean;
  code?: string;
  error?: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server', 0);
  }
  let json: ApiAnswer | null = null;
  try { json = await r.json(); } catch { /* no body */ }
  if (!r.ok || json?.success === false) {
    // the answer rides along: a refused karaoke version names the original song (`query`)
    throw Object.assign(new ApiError(json?.code ?? 'network', json?.error ?? `Request failed (${r.status})`, r.status), { data: json });
  }
  return json as T;
}

/** -> { songId, song? } when the video is a song already, else { job } */
export const startChartJob = (videoId: string) => call<StartChartJobResult>('POST', '/chart-jobs', { videoId });

/**
 * Why POST /chart-jobs said no, as its i18n key under search.generate: limits, the switch, and what the backend
 * refuses before any job starts (a video tried and held before, live, too long or short, not a song, gone)
 */
export const START_ERROR_KEYS: Partial<Record<string, string>> = {
  limit_user: 'limitUser', limit_daily: 'limitDaily', unavailable: 'unavailable', unauthorized: 'signIn',
  held: 'held', not_music: 'notMusic', too_long: 'too_long', too_short: 'tooShort', live: 'live', unavailable_video: 'videoGone',
  karaoke: 'karaoke',
};
export const startErrorKey = (e: unknown): string => START_ERROR_KEYS[(e as { code?: string } | null | undefined)?.code as string] ?? 'failed';
export const getChartJob = (id: number) => call<{ job: ChartJob }>('GET', `/chart-jobs/${id}`).then(j => j.job);

/**
 * YouTube's search, run by the backend, for a song that is not here (the entry page's hint): videos that could become
 * charts -> [{ videoId, title, channel, duration, views, songId? }] (songId: a song here already)
 */
export const searchYouTube = (q: string) => call<{ results?: YouTubeResult[] }>('GET', `/chart-jobs/youtube?q=${encodeURIComponent(q)}`).then(j => j.results ?? []);

export const FINISHED: ReadonlySet<string | undefined> = new Set(['done', 'rejected', 'failed']);

// A server from before the switch (no /chart-jobs/access) offered it to admins only
const LEGACY_ACCESS: ChartAccess = { enabled: true, access: 'admins', maxPending: 0 };
let accessPromise: Promise<ChartAccess> | null = null;

/** { enabled, access: 'off' | 'admins' | 'everyone', maxPending }, asked once per page load */
export function getChartAccess(): Promise<ChartAccess> {
  accessPromise ??= fetch(`${apiUrl}/chart-jobs/access`)
    .then(r => (r.ok ? r.json() as Promise<{ success?: boolean; enabled?: unknown; access?: string; maxPending?: unknown }> : null))
    .then((j): ChartAccess => (j?.success
      ? { enabled: Boolean(j.enabled), access: ['off', 'everyone'].includes(j.access as string) ? j.access as ChartAccessLevel : 'admins', maxPending: Number(j.maxPending) || 0 }
      : LEGACY_ACCESS))
    .catch(() => { accessPromise = null; return LEGACY_ACCESS; });
  return accessPromise;
}

/** Ask again on the next getChartAccess(): an admin just flipped the switch (admin page) */
export function forgetChartAccess() {
  accessPromise = null;
}

/**
 * What a viewer is offered for a link no song has: 'offer' (a button that
 * starts a chart), 'signIn' (a link to sign in first) or null (nothing).
 */
export function chartOffer(access: { enabled?: boolean; access?: string } | null | undefined, user: { isAdmin?: boolean } | null | undefined): ChartOffer | null {
  if (!access?.enabled || access.access === 'off') return null;
  if (access.access === 'everyone') return user ? 'offer' : 'signIn';
  return user?.isAdmin ? 'offer' : null;
}

/** waitForChartJob's callbacks, and what tests replace */
export interface WaitForChartJobOptions {
  onUpdate?: (job: ChartJob) => void;
  signal?: AbortSignal;
  intervalMs?: number;
  getJob?: (id: number) => Promise<ChartJob | null | undefined>;
  sleep?: (ms: number) => Promise<unknown>;
}

/**
 * Polls a job until it is finished; onUpdate(job) whenever its status, place
 * in line, stage, time left or name changed. Resolves with the finished job;
 * rejects with an AbortError when `signal` aborts.
 */
export async function waitForChartJob(id: number, { onUpdate = () => {}, signal, intervalMs = 3000, getJob = getChartJob,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)) }: WaitForChartJobOptions = {}): Promise<ChartJob> {
  let last: string | null = null;
  for (;;) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    let job: ChartJob | null | undefined;
    try {
      job = await getJob(id);
    } catch (e) {
      if ((e as { code?: string }).code !== 'network') throw e;   // a hiccup: try again on the next tick
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
export function chartJobMessageKey(job: ChartJobLike | null | undefined): string {
  if (!job) return 'starting';
  switch (job.status) {
    case 'done': return 'done';
    case 'rejected': return 'rejected';
    case 'failed': return ['too_long', 'live'].includes(job.error as string) ? job.error as string : 'failed';
    default: return 'starting';
  }
}

const STAGES: ReadonlySet<string | undefined> = new Set(['queued', 'download', 'starting', 'separate', 'lyrics', 'transcribe', 'align', 'pitch', 'notes', 'check',
  'saving', 'generating', 'done']);

/** The i18n key (under chartJob.stage) of what a job is doing now; null once it failed */
export function stageKey(job: ChartJobLike | null | undefined): string | null {
  if (!job) return 'queued';
  if (job.status === 'done') return 'done';
  if (job.status === 'failed' || job.status === 'rejected') return null;
  if (job.status === 'queued') return 'queued';
  const s = job.progress?.stage;
  if (STAGES.has(s)) return s!;
  return job.status === 'downloading' ? 'download' : 'generating';
}

/** The i18n key (under chartJob.reason) of why a job ended without a song */
export function reasonKey(job: ChartJobLike | null | undefined): string {
  if (job?.status === 'rejected') return 'rejected';
  return ['too_long', 'live'].includes(job?.error as string) ? job!.error as string : 'failed';
}

/**
 * Where the bar stands and the seconds left, `elapsedMs` after this copy of
 * the job arrived: between two reports it moves on at the pace the estimate
 * predicts (fraction + (1 - fraction) * elapsed / eta), stopping short of the
 * end. -> { fraction 0..1, eta seconds or null }
 */
export function progressAt(job: ChartJobLike | null | undefined, elapsedMs = 0): { fraction: number; eta: number | null } {
  if (job?.status === 'done') return { fraction: 1, eta: 0 };
  const p = job?.progress;
  if (!p) return { fraction: 0, eta: null };
  const f0 = Math.min(1, Math.max(0, Number(p.fraction) || 0));
  const eta0 = Number(p.eta);
  if (!Number.isFinite(eta0)) return { fraction: f0, eta: null };
  const dt = Math.max(0, elapsedMs / 1000);
  const eta = Math.max(0, eta0 - dt);
  if (job!.status === 'queued' || eta0 <= 0) return { fraction: f0, eta };
  return { fraction: Math.min(0.99, Math.max(f0, f0 + (1 - f0) * Math.min(1, dt / eta0))), eta };
}

/** Seconds left as words: { key (under chartJob.eta), count } or null when unknown */
export function etaWords(seconds: number | null | undefined): { key: 'almost' | 'seconds' | 'minutes'; count: number } | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 10) return { key: 'almost', count: 0 };
  if (seconds < 50) return { key: 'seconds', count: Math.ceil(seconds / 10) * 10 };
  return { key: 'minutes', count: Math.max(1, Math.round(seconds / 60)) };
}

/** Of two copies of a job (a queue entry's and a fresher one pushed since), the newer */
export const newerJob = <J extends { at?: number | null }>(a: J | null | undefined, b: J | null | undefined) => (!a ? b : !b ? a : ((b.at ?? 0) >= (a.at ?? 0) ? b : a));
