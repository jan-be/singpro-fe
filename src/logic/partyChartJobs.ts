import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { newerJob, type ChartJob } from './chartJobs';
import { sendQueueAddJob, type ObjSocket } from './WebsocketHandling';

/**
 * Songs still being charted in the party's queue (backend partyChartJobs.js),
 * as the party page's socket reports them. A store outside React state: the
 * progress comes every few seconds, and only the queue's entries, the queue
 * pill's ring and the "ready" notice follow it; the party page itself does
 * not re-render for it.
 *
 * - party:state / party:queue_updated: which entries are pending, and whether
 *   this server takes them at all (party:state chartJobs.maxPending)
 * - party:chart_job: a fresher copy of one job (place in line, stage, time left)
 * - party:queue_refused: why an add did not happen, shown in the queue panel
 *
 * One party page at a time, so one store.
 */
/** What this module reads of a party queue entry (party:state, party:queue_updated) */
export interface ChartQueueEntry {
  songId?: string | null;
  title: string;
  artist: string;
  videoId?: string;
  /** a song made from a chart job */
  generated?: boolean;
  /** a song still being charted, or failed */
  job?: ChartJob | null;
  addedBy?: string;
}

/** An entry still waiting for its chart, or failed (isPendingEntry) */
export type PendingEntry = ChartQueueEntry & { job: ChartJob };

/** The party messages handlePartyMessage reads */
export interface PartyChartMessage {
  type?: string;
  data?: {
    chartJobs?: { maxPending?: number } | null;
    queue?: ChartQueueEntry[] | null;
    job?: ChartJob | null;
    reason?: string;
    jobId?: number;
  } | null;
}

/** The store: the pending entries' jobs (with receivedAt) by id, and the notices */
export interface PartyChartState {
  jobs: Record<number, ChartJob>;
  pending: number[];
  maxPending: number;
  /** why an add did not happen (party:queue_refused) */
  notice: { reason: string; at: number } | null;
  /** a pending entry that turned into a song */
  ready: { title: string; artist: string; at: number } | null;
  canAdd: boolean;
}

/** Sends queue:add_job on the party's socket */
export type AddJobToParty = (jobId: number, videoTitle?: string | null) => void;

let state: PartyChartState = { jobs: {}, pending: [], maxPending: 0, notice: null, ready: null, canAdd: false };
const listeners = new Set<() => void>();
let adder: AddJobToParty | null = null;

function update(change: Partial<PartyChartState>) {
  state = { ...state, ...change };
  for (const l of listeners) l();
}

/** an entry still waiting for its chart, or failed (never played) */
export const isPendingEntry = (entry: ChartQueueEntry | null | undefined): entry is PendingEntry => Boolean(entry?.job) && !entry!.songId;
/** the entry the queue plays next: pending ones are passed over (they keep their place) */
export const firstPlayable = <E extends ChartQueueEntry>(queue: (E | null | undefined)[] | null | undefined): E | null => queue?.find(e => e?.songId) ?? null;

const stamp = <J extends ChartJob | null | undefined>(job: J): J => (job ? { ...job, receivedAt: Date.now() } : job);

function syncQueue(queue: ChartQueueEntry[] | null | undefined) {
  const list = queue ?? [];
  const jobs: Record<number, ChartJob> = {};
  for (const e of list) {
    if (!isPendingEntry(e)) continue;
    const mine = state.jobs[e.job.id];
    const theirs = { ...e.job, title: e.title, artist: e.artist, videoId: e.videoId };
    jobs[e.job.id] = mine && newerJob(e.job, mine) === mine ? { ...mine, title: e.title, artist: e.artist } : stamp(theirs);
  }
  // a pending entry that turned into a song: a word for everyone
  let ready = state.ready;
  for (const id of state.pending) {
    const was = state.jobs[id];
    if (jobs[id] || !was?.videoId) continue;
    const song = list.find(e => e.songId && e.generated && e.videoId === was.videoId);
    if (song) ready = { title: song.title, artist: song.artist, at: Date.now() };
  }
  update({ jobs, pending: Object.keys(jobs).map(Number), ready });
}

/**
 * The party page's socket handler hands every message here (one line in
 * PartyPage); the ones about songs being charted are taken in.
 */
export function handlePartyMessage(msg: PartyChartMessage | null | undefined) {
  switch (msg?.type) {
    case 'party:state':
      update({ maxPending: Number(msg.data?.chartJobs?.maxPending) || 0 });
      syncQueue(msg.data?.queue);
      break;
    case 'party:queue_updated':
      syncQueue(msg.data?.queue);
      break;
    case 'party:chart_job': {
      const job = msg.data?.job;
      if (!job?.id || !state.jobs[job.id]) return;
      const mine = state.jobs[job.id];
      if (newerJob(mine, job) === job) update({ jobs: { ...state.jobs, [job.id]: stamp({ ...mine, ...job }) } });
      break;
    }
    case 'party:queue_refused':
      update({ notice: { reason: msg.data?.reason ?? 'unknown', at: Date.now() } });
      break;
    default:
  }
}

export const clearPartyNotice = () => update({ notice: null });
export const clearReadyNotice = () => update({ ready: null });

/** Put a started job into this party's queue (the chart pill uses it); false when no party listens. */
export function addJobToParty(jobId: number, videoTitle?: string | null) {
  if (!adder) return false;
  adder(jobId, videoTitle);
  return true;
}

/**
 * The party page's hook: (jobId, videoTitle) => void that sends queue:add_job
 * on its socket, also handed to the chart pill while the page is open.
 */
export function usePartyChartJobs(wss: ObjSocket | null | undefined): AddJobToParty {
  const add = useCallback<AddJobToParty>((jobId, videoTitle) => {
    if (wss) sendQueueAddJob(wss, { jobId, videoTitle });
  }, [wss]);
  useEffect(() => {
    adder = wss ? add : null;
    update({ canAdd: Boolean(wss) });
    return () => { if (adder === add) adder = null; update({ canAdd: false }); };
  }, [wss, add]);
  // a new party page starts from nothing
  useEffect(() => () => { state = { jobs: {}, pending: [], maxPending: 0, notice: null, ready: null, canAdd: false }; }, []);
  return add;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller when `select(state)` changes (select must return stable values) */
export function usePartyChartState<T>(select: (s: PartyChartState) => T): T {
  const get = () => select(state);
  return useSyncExternalStore(subscribe, get, get);
}

/** The freshest copy of a queue entry's job (with receivedAt) */
export function usePartyJob(entryJob: ChartJob | null | undefined): ChartJob | null {
  const pushed = usePartyChartState(s => (entryJob ? s.jobs[entryJob.id] : undefined));
  return pushed ?? entryJob ?? null;
}

/** For tests */
export function _partyChartState() { return state; }
