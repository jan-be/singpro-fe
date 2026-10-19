/**
 * The parties this browser was in, kept in localStorage for "Sing again" and
 * "For you" on the entry page: when, which songs played, who sang (their
 * display names), and what was still in the queue. Only here: the server
 * sees the song ids when the entry page asks for its "For you" row
 * (backend routes/recommendations.js), nothing else.
 *
 * Every read and write is wrapped: without storage (private mode, blocked
 * site data) nothing is kept and the entry page simply shows neither card.
 */

const KEY = 'singpro_parties';
const PENDING_KEY = 'singpro_pending_queue';
const MAX_PARTIES = 10;
const MAX_SONGS = 100;
const MAX_SINGERS = 30;
/** A party code quiet this long is a new party (codes are reused, the server's recommendations.js) */
const SAME_PARTY_MS = 6 * 3600 * 1000;
/** Songs for a new party's queue wait this long for the party to open (Start again) */
const PENDING_MS = 10 * 60 * 1000;
/** A party of at least this many songs, or this long, is a long one (home screen, plan the next one) */
export const LONG_PARTY_SONGS = 5;
export const LONG_PARTY_MS = 45 * 60 * 1000;

const songOf = (s) => (s?.songId ? { songId: String(s.songId), artist: String(s.artist ?? ''), title: String(s.title ?? ''), videoId: String(s.videoId ?? '') } : null);

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.parties) ? parsed.parties.filter(p => p && p.partyId && Array.isArray(p.songs)) : [];
  } catch { return []; }
}

function write(parties) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, parties: parties.slice(0, MAX_PARTIES) })); } catch { /* full or blocked: not kept */ }
}

/** Is there a record of this party still going (the same code long after is another party)? */
const known = (partyId, now) => read().some(p => p.partyId === partyId && now - (p.lastAt ?? 0) < SAME_PARTY_MS);

/** The record of this party (made if new), first in the list; `fn` changes it */
function update(partyId, fn, now = Date.now()) {
  if (!partyId) return;
  const parties = read();
  let i = parties.findIndex(p => p.partyId === partyId && now - (p.lastAt ?? 0) < SAME_PARTY_MS);
  let party;
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
export function notePartySong(partyId, song, { host = false, me = null, now = Date.now() } = {}) {
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
export function notePartySingers(partyId, names, { now = Date.now() } = {}) {
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
export function notePartyQueue(partyId, queue, { now = Date.now() } = {}) {
  const songs = (queue ?? []).filter(e => e?.songId).map(songOf).filter(Boolean).slice(0, MAX_SONGS);
  if (!songs.length && !known(partyId, now)) return;
  update(partyId, (p) => { p.host = true; p.queue = songs; }, now);
}

/** The parties, most recent first */
export const loadParties = () => read();

/** The last party this browser hosted that played something, or null */
export function lastHostedParty(parties = read()) {
  return parties.find(p => p.host && p.songs.length > 0) ?? null;
}

/** Songs queued in it that never played */
export const missedSongs = (party) => (party?.queue ?? []).filter(q => !party.songs.some(s => s.songId === q.songId));

/** The other singers (not this browser's own name) */
export const otherSingers = (party) => (party?.singers ?? []).filter(n => n !== party.me);

export const isLongParty = (party) => Boolean(party) && (party.songs.length >= LONG_PARTY_SONGS || (party.lastAt - party.startedAt) >= LONG_PARTY_MS);

/** Forget a party (the card's ✕) */
export function forgetParty(partyId, startedAt) {
  write(read().filter(p => !(p.partyId === partyId && p.startedAt === startedAt)));
}

/** Every song this browser's parties played, most recent first, each once ("For you") */
export function historySongIds(parties = read(), limit = 100) {
  const out = [];
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
export function savePendingQueue(songs, now = Date.now()) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: now, songs: songs.map(songOf).filter(Boolean).slice(0, MAX_SONGS) })); } catch { /* */ }
}

/** The songs waiting for this party's queue (once: they are gone after), minus what it has already */
export function takePendingQueue(party = {}, now = Date.now()) {
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    sessionStorage.removeItem(PENDING_KEY);
  } catch { return []; }
  if (!pending || !Array.isArray(pending.songs) || now - pending.at > PENDING_MS) return [];
  const has = new Set([party.currentSong?.songId, ...(party.queue ?? []).map(e => e.songId)].filter(Boolean));
  return pending.songs.filter(s => s?.songId && !has.has(s.songId));
}
