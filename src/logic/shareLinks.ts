import { apiUrl, appDomain } from '../GlobalConsts';
import { getGuestId } from './sessionId';

/**
 * Share links that say who brought a visitor (backend referrals.ts).
 *
 * Every song link a singer shares (the score card's text and QR code, the
 * share video's, a recording's) carries a short random code:
 * https://singspree.com/sing/<song>?r=<code>. Nothing else about the sharer
 * is in it: the server keeps who shared what under the code. It is the song's
 * own page with one more tag, so a link whose code the server does not know
 * (or a server that cannot be reached) still opens the song, and search
 * engines see the one song URL its canonical tag names.
 *
 * The server hands out the code (POST /shares), the same one every time for
 * the same thing (a score's card, a take's video): the card it is drawn into
 * stays the same picture, and a video already made can be shared again as it
 * is. shareLinkFor answers within LINK_WAIT_MS, with the plain song link if
 * the server is slower, so a share never waits long for it; the code is still
 * asked for and kept for the next share.
 *
 * shareSent says the share sheet took the link, or its file was downloaded
 * (POST /shares/:code/sent, a beacon).
 *
 * A visitor who opens a code's link sees the song's landing (ShareLanding)
 * before a party starts: captureShareArrival notes the code at start-up
 * (logic/referrer.ts calls it with the address), the landing records the
 * visit and shows who shared it.
 */

export const SHARE_TAG = 'r';

/** A shareable thing (backend shares.kind) */
export type ShareKind = 'card' | 'video' | 'audio' | 'take';

/** What is shared, which the server hands out a code for (POST /shares) */
export interface ShareWhat {
  kind: ShareKind;
  songId: string;
  scoreId?: string | number | null;
  recordingId?: string | null;
  partyId?: string | null;
  playStartedAt?: number | null;
  nickname?: string | null;
}

/** What a share link's landing shows (POST /shares/:code/visit) */
export interface ShareVisit {
  songId: string;
  kind: ShareKind;
  title: string | null;
  artist: string | null;
  videoId: string | null;
  /** who shared it, null when they are not to be shown; score and stars null when the play is not one to beat */
  from: { name: string; score: number | null; stars: number | null } | null;
  /** the visitor's own share */
  own: boolean;
}

/**
 * A song worth showing off, for the score screen's louder share button: three
 * stars or more, or a best the singer had beaten (a first play is a "new best"
 * by itself). `entry`: the singer's line of party:song_ended.
 */
export const isGoodSong = (entry: { stars?: number | null; newBest?: boolean | null; previousBest?: number | null } | null): boolean => (entry?.stars ?? 0) >= 3 || (!!entry?.newBest && entry.previousBest != null);
export const LINK_WAIT_MS = 2500;
const LANDING_KEY = 'singspree_share_landing';

export const validShareCode = (code: unknown): string | null => (typeof code === 'string' && /^[A-Za-z0-9]{8}$/.test(code) ? code : null);

/** The link to a song, with the share's code when there is one */
export const songShareUrl = (songId: string | null, code: string | null = null, domain = appDomain): string =>
  songId ? `https://${domain}/sing/${songId}${validShareCode(code) ? `?${SHARE_TAG}=${code}` : ''}` : `https://${domain}`;

/** The code in a share link, or null */
export const codeOf = (url: string | undefined): string | null => {
  if (url === undefined) return null;
  try {
    return validShareCode(new URL(url).searchParams.get(SHARE_TAG));
  } catch {
    return null; // not a URL
  }
};

/** The `data` of the server's JSON answer (its shape is the server's word: backend referrals.ts) */
const dataOf = async <T>(resp: Response): Promise<T | undefined> => ((await resp.json()) as { data?: T } | null)?.data;

const codes = new Map<string, Promise<string | null>>(); // what was shared → Promise of its code (answered ones only stay)

const keyOf = ({ kind, songId, scoreId = null, recordingId = null, partyId = null, playStartedAt = null }: ShareWhat) =>
  JSON.stringify([kind, songId, scoreId, recordingId, partyId, playStartedAt]);

/** The code for sharing this ({ kind, songId, scoreId?, recordingId?, partyId?, playStartedAt?, nickname? }), or null */
function codeFor(what: ShareWhat): Promise<string | null> {
  const key = keyOf(what);
  let asked = codes.get(key);
  if (!asked) {
    asked = (async () => {
      const resp = await fetch(`${apiUrl}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...what, guestId: getGuestId() }),
      });
      if (!resp.ok) throw new Error(`POST /shares ${resp.status}`);
      return validShareCode((await dataOf<{ code?: unknown }>(resp))?.code);
    })();
    codes.set(key, asked);
    asked.catch(() => codes.delete(key)); // asked again next time
  }
  return asked;
}

/**
 * The link for sharing this: the song's link with its code, or without one
 * when the server cannot say within `wait` ms. Starts asking at once, so call
 * it as early as a share looks likely (the button hovered, pressed).
 */
export async function shareLinkFor(what: ShareWhat, { wait = LINK_WAIT_MS }: { wait?: number } = {}): Promise<string> {
  if (!what.songId || !what.kind) return songShareUrl(what.songId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), wait); });
  try {
    const code = await Promise.race([codeFor(what).catch(() => null), late]);
    return songShareUrl(what.songId, code);
  } finally {
    clearTimeout(timer);
  }
}

/** The share sheet took this link (or its file was downloaded): counted on the server. Never in the way. */
export function shareSent(url: string | undefined) {
  const code = codeOf(url);
  if (!code) return;
  try {
    const target = `${apiUrl}/shares/${code}/sent`;
    const body = JSON.stringify({ guestId: getGuestId() });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(target, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* never in the way of sharing */ }
}

// Where sessionStorage is refused, the landing still shows for this page load
let memory: { songId: string; code: string } | null = null;

/** A share link opened this tab: its song and code, for the landing (referrer.ts, at start-up) */
export function captureShareArrival(songId: string, code: string) {
  const valid = validShareCode(code);
  if (!songId || !valid) return;
  const value = { songId, code: valid };
  try { sessionStorage.setItem(LANDING_KEY, JSON.stringify(value)); } catch { memory = value; }
}

/** The landing still to show for this song: { code }, or null */
export function pendingLanding(songId: string | undefined): { code: string } | null {
  let value: { songId?: unknown; code?: unknown } | null = memory;
  try {
    const stored = sessionStorage.getItem(LANDING_KEY);
    if (stored) value = JSON.parse(stored);
  } catch { /* the page load's own */ }
  const code = value && value.songId === songId ? validShareCode(value.code) : null;
  return code ? { code } : null;
}

/** The landing was answered ("Sing this song", or the code was unknown): the song's page from here on */
export function landingDone() {
  memory = null;
  try { sessionStorage.removeItem(LANDING_KEY); } catch { /* nothing kept */ }
}

/**
 * The visit, once per tab and code (the server keeps one arrival per browser
 * and code anyway): what the landing shows, { songId, title, artist, videoId,
 * from: { name, score, stars } | null, own }, or null for a code it does not know.
 */
const visits = new Map<string, Promise<ShareVisit | null>>();
export function visitShare(code: string): Promise<ShareVisit | null> {
  if (!validShareCode(code)) return Promise.resolve(null);
  let visit = visits.get(code);
  if (!visit) {
    visit = (async () => {
      const resp = await fetch(`${apiUrl}/shares/${code}/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId: getGuestId() }),
      });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`visit ${resp.status}`);
      return (await dataOf<ShareVisit | null>(resp)) ?? null;
    })();
    visits.set(code, visit);
    visit.catch(() => visits.delete(code));
  }
  return visit;
}
