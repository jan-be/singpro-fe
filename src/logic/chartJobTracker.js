import { useSyncExternalStore } from 'react';
import { FINISHED, getChartJob, waitForChartJob } from './chartJobs';

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
const KEY = 'singpro_chart_jobs';
const MAX_AGE_MS = 24 * 3600 * 1000;
const MAX_JOBS = 5;

let entries = [];
let focused = null;          // the job the search bar is showing (the pill leaves it out)
let snapshot = { entries, focused };
const listeners = new Set();
const polls = new Map();     // id -> AbortController
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
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    entries = (Array.isArray(raw) ? raw : [])
      .filter(e => e && Number.isSafeInteger(e.id) && now - (e.startedAt ?? 0) < MAX_AGE_MS)
      .map(e => ({ ...e, receivedAt: now }));
  } catch {
    entries = [];
  }
  snapshot = { entries, focused };
  for (const e of entries) if (!FINISHED.has(e.job?.status)) follow(e.id);
}

function set(id, change) {
  entries = entries.map(e => (e.id === id ? { ...e, ...change } : e));
  save();
  emit();
}

function follow(id, deps = {}) {
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
export function trackChartJob(job, { videoTitle = null } = {}, deps = {}) {
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
export function forget(id) {
  polls.get(id)?.abort();
  polls.delete(id);
  if (!entries.some(e => e.id === id)) return;
  entries = entries.filter(e => e.id !== id);
  if (focused === id) focused = null;
  save();
  emit();
}

/** The search bar shows this job itself (null: it shows none); the pill leaves it out meanwhile. */
export function setFocusedChartJob(id) {
  if (focused === id) return;
  focused = id;
  emit();
}

function subscribe(listener) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => snapshot;

/** { entries, focused }, re-rendering the caller on every change */
export function useTrackedChartJobs() {
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
