import { useSyncExternalStore } from 'react';
import { FINISHED, getChartJob, waitForChartJob, type ChartJob, type WaitForChartJobOptions } from './chartJobs';

/**
 * The charts this browser asked for from the home page, followed wherever
 * the user goes next (ChartJobPill shows them on every page; the search bar
 * shows the one it just started). Kept in localStorage, so a reload or a
 * new tab still finds them; each unfinished one is polled until it is done.
 * A day after it was started, or once dismissed or handed to a party queue,
 * a job is forgotten here (it carries on on the server either way).
 *
 * Entries: { id, videoId, videoTitle, startedAt, job (the latest copy from
 * the server), receivedAt (Date.now() when it came, for the bar between polls) }
 */
/** A chart this browser asked for */
export interface TrackedChartJob {
  id: number;
  videoId: string | null;
  videoTitle: string | null;
  startedAt: number;
  /** the latest copy from the server */
  job: ChartJob;
  /** Date.now() when it came, for the bar between polls */
  receivedAt: number;
}

/** What useTrackedChartJobs gives: the charts followed, and the one the search bar shows (the pill leaves it out) */
export interface TrackedChartJobs {
  entries: TrackedChartJob[];
  focused: number | null;
}

/** What tests replace in following a job */
type FollowDeps = Pick<WaitForChartJobOptions, 'getJob' | 'sleep'>;

const KEY = 'singspree_chart_jobs';
const MAX_AGE_MS = 24 * 3600 * 1000;
const MAX_JOBS = 5;

let entries: TrackedChartJob[] = [];
let focused: number | null = null;          // the job the search bar is showing (the pill leaves it out)
let snapshot: TrackedChartJobs = { entries, focused };
const listeners = new Set<() => void>();
const polls = new Map<number, AbortController>();     // id -> AbortController
let loaded = false;

function emit() {
  snapshot = { entries, focused };
  for (const l of listeners) l();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.map(({ id, videoId, videoTitle, startedAt, job }) => ({ id, videoId, videoTitle, startedAt, job }))));
  } catch { /* private mode: kept for this page only */ }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const now = Date.now();
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    entries = (Array.isArray(raw) ? raw as TrackedChartJob[] : [])
      .filter(e => e && Number.isSafeInteger(e.id) && now - (e.startedAt ?? 0) < MAX_AGE_MS)
      .map(e => ({ ...e, receivedAt: now }));
  } catch {
    entries = [];
  }
  snapshot = { entries, focused };
  for (const e of entries) if (!FINISHED.has(e.job?.status)) follow(e.id);
}

function set(id: number, change: Partial<TrackedChartJob>) {
  entries = entries.map(e => (e.id === id ? { ...e, ...change } : e));
  save();
  emit();
}

function follow(id: number, deps: FollowDeps = {}) {
  if (polls.has(id)) return;
  const controller = new AbortController();
  polls.set(id, controller);
  waitForChartJob(id, {
    signal: controller.signal,
    getJob: deps.getJob ?? getChartJob,
    sleep: deps.sleep,
    onUpdate: (job) => set(id, { job, receivedAt: Date.now() }),
  }).catch(e => {
    // signed out, or the job is gone: nothing more to follow
    if (e.name !== 'AbortError') forget(id);
  }).finally(() => polls.delete(id));
}

/** Start following a job the user just started (a copy of it from POST /chart-jobs). */
export function trackChartJob(job: ChartJob | null | undefined, { videoTitle = null }: { videoTitle?: string | null } = {}, deps: FollowDeps = {}) {
  load();
  if (!job?.id) return;
  if (!entries.some(e => e.id === job.id)) {
    entries = [{ id: job.id, videoId: job.videoId ?? null, videoTitle, startedAt: Date.now(), job, receivedAt: Date.now() }, ...entries]
      .slice(0, MAX_JOBS);
    save();
    emit();
  }
  if (!FINISHED.has(job.status)) follow(job.id, deps);
}

/** Stop following a job here (dismissed, or a party queue shows it now). */
export function forget(id: number) {
  polls.get(id)?.abort();
  polls.delete(id);
  if (!entries.some(e => e.id === id)) return;
  entries = entries.filter(e => e.id !== id);
  if (focused === id) focused = null;
  save();
  emit();
}

/** The search bar shows this job itself (null: it shows none); the pill leaves it out meanwhile. */
export function setFocusedChartJob(id: number | null) {
  if (focused === id) return;
  focused = id;
  emit();
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => snapshot;

/** { entries, focused }, re-rendering the caller on every change */
export function useTrackedChartJobs(): TrackedChartJobs {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** For tests: start over */
export function _resetTracker() {
  for (const c of polls.values()) c.abort();
  polls.clear();
  entries = [];
  focused = null;
  loaded = false;
  snapshot = { entries, focused };
}
