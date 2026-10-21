/**
 * The parties this browser was in, kept in localStorage for "Sing again" and
 * "For you" on the entry page: when, which songs played, who sang (their
 * display names), and what was still in the queue. Only here: the server
 * sees the song ids when the entry page asks for its "For you" row
 * (backend routes/recommendations.ts), nothing else.
 *
 * Every read and write is wrapped: without storage (private mode, blocked
 * site data) nothing is kept and the entry page simply shows neither card.
 */

const KEY = 'singspree_parties';
const PENDING_KEY = 'singspree_pending_queue';
const MAX_PARTIES = 10;
const MAX_SONGS = 100;
const MAX_SINGERS = 30;
/** A party code quiet this long is a new party (codes are reused, the server's recommendations.ts) */
const SAME_PARTY_MS = 6 * 3600 * 1000;
/** Songs for a new party's queue wait this long for the party to open (Start again) */
const PENDING_MS = 10 * 60 * 1000;
/** A party of at least this many songs, or this long, is a long one (home screen, plan the next one) */
export const LONG_PARTY_SONGS = 5;
export const LONG_PARTY_MS = 45 * 60 * 1000;

/** A song as the history keeps it */
export interface HistorySong {
  songId: string;
  artist: string;
  title: string;
  videoId: string;
}

/** What the history takes a song from (an API song, a queue entry): its fields as strings */
export interface HistorySongInput {
  songId?: unknown;
  artist?: unknown;
  title?: unknown;
  videoId?: unknown;
}

/** A party this browser was in */
export interface PartyRecord {
  partyId: string;
  startedAt: number;
  lastAt: number;
  /** the songs that played, once each */
  songs: HistorySong[];
  /** who sang, display names */
  singers: string[];
  /** what was in the queue last (the host's page) */
  queue: HistorySong[];
  /** this browser ran the party */
  host?: boolean;
  /** the name it sang under there */
  me?: string;
  /** its ✕ on the entry page */
  dismissed?: boolean;
}

/** What takePendingQueue reads of the party it opens in (party:state) */
export interface PartyQueueState {
  currentSong?: { songId?: string | null } | null;
  queue?: { songId?: string | null }[] | null;
}

const songOf = (s: HistorySongInput | null | undefined): HistorySong | null => (s?.songId ? { songId: String(s.songId), artist: String(s.artist ?? ''), title: String(s.title ?? ''), videoId: String(s.videoId ?? '') } : null);

function read(): PartyRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) as { parties?: PartyRecord[] } | null : null;
    return Array.isArray(parsed?.parties) ? parsed.parties.filter(p => p && p.partyId && Array.isArray(p.songs)) : [];
  } catch { return []; }
}

function write(parties: PartyRecord[]) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, parties: parties.slice(0, MAX_PARTIES) })); } catch { /* full or blocked: not kept */ }
}

/** Is there a record of this party still going (the same code long after is another party)? */
const known = (partyId: string, now: number) => read().some(p => p.partyId === partyId && now - (p.lastAt ?? 0) < SAME_PARTY_MS);

/** The record of this party (made if new), first in the list; `fn` changes it */
function update(partyId: string, fn: (p: PartyRecord) => void, now = Date.now()) {
  if (!partyId) return;
  const parties = read();
  let i = parties.findIndex(p => p.partyId === partyId && now - (p.lastAt ?? 0) < SAME_PARTY_MS);
  let party: PartyRecord;
  if (i >= 0) [party] = parties.splice(i, 1);
  else party = { partyId, startedAt: now, lastAt: now, songs: [], singers: [], queue: [] };
  fn(party);
  party.lastAt = now;
  parties.unshift(party);
  write(parties);
}

/**
 * A song started in the party (the party page, as its chart loads).
 * `host`: this browser runs the party; `me`: the name it sings under here.
 */
export function notePartySong(partyId: string, song: HistorySongInput | null | undefined, { host = false, me = null, now = Date.now() }: { host?: boolean; me?: string | null; now?: number } = {}) {
  const s = songOf(song);
  if (!s) return;
  update(partyId, (p) => {
    if (host) p.host = true;
    if (me) p.me = me;
    if (!p.songs.some(x => x.songId === s.songId)) p.songs.push(s);
    if (p.songs.length > MAX_SONGS) p.songs = p.songs.slice(-MAX_SONGS);
  }, now);
}

/** Who sang the song that just ended (party:song_ended) */
export function notePartySingers(partyId: string, names: readonly string[] | null | undefined, { now = Date.now() }: { now?: number } = {}) {
  const sung = (names ?? []).filter(n => typeof n === 'string' && n.trim());
  const party = read().find(p => p.partyId === partyId && now - (p.lastAt ?? 0) < SAME_PARTY_MS);
  if (!party || sung.every(n => party.singers.includes(n))) return; // nobody new: nothing to write
  update(partyId, (p) => {
    for (const n of sung) if (!p.singers.includes(n)) p.singers.push(n);
    p.singers = p.singers.slice(0, MAX_SINGERS);
  }, now);
}

/**
 * The party's queue as it is now, from the host's page (songs being charted
 * are left out: they have no song yet). It may come before the first song
 * has started (Start again fills the queue as the party opens).
 */
export function notePartyQueue(partyId: string, queue: readonly ((HistorySongInput & { job?: unknown }) | null | undefined)[] | null | undefined, { now = Date.now() }: { now?: number } = {}) {
  const songs = ((queue ?? []).filter(e => e?.songId).map(songOf).filter(Boolean) as HistorySong[]).slice(0, MAX_SONGS);
  if (!songs.length && !known(partyId, now)) return;
  update(partyId, (p) => { p.host = true; p.queue = songs; }, now);
}

/** The parties, most recent first */
export const loadParties = () => read();

/** The last party this browser hosted that played something, or null */
export function lastHostedParty(parties = read()): PartyRecord | null {
  return parties.find(p => p.host && p.songs.length > 0) ?? null;
}

/** Songs queued in it that never played */
export const missedSongs = (party: PartyRecord | null | undefined): HistorySong[] => (party?.queue ?? []).filter(q => !party!.songs.some(s => s.songId === q.songId));

export const isLongParty = (party: PartyRecord | null | undefined): boolean => Boolean(party) && (party!.songs.length >= LONG_PARTY_SONGS || (party!.lastAt - party!.startedAt) >= LONG_PARTY_MS);

/**
 * The entry page mentions the last hosted party only when it left several
 * songs in the queue that never played, for a while after, and until its ✕:
 * a nudge to sing those, not an ad for the party (the user's call, 19 Oct).
 */
export const LEFTOVER_MIN = 3;
export const LEFTOVER_FOR_MS = 14 * 24 * 3600 * 1000;

/** That party, or null (an older party with leftovers does not count once a newer one was hosted) */
export function leftoverParty(parties = read(), now = Date.now()): PartyRecord | null {
  const party = lastHostedParty(parties);
  if (!party || party.dismissed || now - party.lastAt > LEFTOVER_FOR_MS) return null;
  return missedSongs(party).length >= LEFTOVER_MIN ? party : null;
}

/** Its ✕: not mentioned again (the songs stay in the history "For you" reads) */
export function dismissParty(partyId: string, startedAt: number) {
  write(read().map(p => (p.partyId === partyId && p.startedAt === startedAt ? { ...p, dismissed: true } : p)));
}

/** Every song this browser's parties played, most recent first, each once ("For you") */
export function historySongIds(parties = read(), limit = 100): string[] {
  const out: string[] = [];
  for (const p of parties) {
    for (let i = p.songs.length - 1; i >= 0; i--) {
      const id = p.songs[i].songId;
      if (!out.includes(id)) out.push(id);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Start again: the songs after the first wait in sessionStorage until the
 * new party's page is in its party (takePendingQueue), the first is the song
 * the page opens with.
 */
export function savePendingQueue(songs: readonly (HistorySongInput | null | undefined)[], now = Date.now()) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: now, songs: songs.map(songOf).filter(Boolean).slice(0, MAX_SONGS) })); } catch { /* */ }
}

/** The songs waiting for this party's queue (once: they are gone after), minus what it has already */
export function takePendingQueue(party: PartyQueueState = {}, now = Date.now()): HistorySong[] {
  let pending: { at: number; songs: HistorySong[] } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    sessionStorage.removeItem(PENDING_KEY);
  } catch { return []; }
  if (!pending || !Array.isArray(pending.songs) || now - pending.at > PENDING_MS) return [];
  const has = new Set([party.currentSong?.songId, ...(party.queue ?? []).map(e => e.songId)].filter(Boolean));
  return pending.songs.filter(s => s?.songId && !has.has(s.songId));
}
