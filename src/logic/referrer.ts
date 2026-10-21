/**
 * Where a visitor came from.
 *
 * `document.referrer` holds the external source only on the very first page
 * load: a client-side route change clears it, and every fetch() the app makes
 * carries our own page as its Referer, so the HTTP header the server sees on
 * API calls is always a self-referral. Capture it once per tab instead, and
 * keep it for the rest of the session so a play recorded twenty minutes in
 * still knows which link started it.
 *
 * The links we hand out ourselves arrive with no referrer at all: a phone
 * camera scanning a QR code, or WhatsApp, Signal or an SMS opening a link,
 * sends none, so an invitee looked exactly like someone who typed the
 * address. Those links therefore say what they are (the "arrival"):
 *
 *   /j/ABCD?qr       the party's QR code                        → 'qr'
 *   /j/ABCD?l        the party link from the "Copy link" button → 'link'
 *   /j/ABCD          a join URL without a tag: typed off the big
 *                    screen, passed on from the address bar, or
 *                    an old link (/join/ABCD, legacy /mic/ABCD/name) → 'join'
 *   /u/name?add=1    a friend invite link (already unmistakable) → 'invite'
 *   /sing/ID?r=CODE  a singer's shared score, video or recording
 *                    (logic/shareLinks.ts; the code says whose)   → 'share'
 *
 * A short path and a tag without a value, because the QR code has to stay
 * easy to scan across a room: https://singspree.com/j/ABCD?qr is 31 bytes, and
 * a version 2 code holds 32 (25×25 modules at level L), like the untagged URL;
 * /join/ (34 bytes since the rename) or `?via=qr` would need version 3.
 *
 * The tag is taken out of the address bar before the router starts, so it
 * is not passed on with a link copied from there, a reload does not count
 * the arrival again, and history keeps the plain URL.
 */
import { SHARE_TAG, captureShareArrival, validShareCode } from './shareLinks';
import { OLD_ORIGIN, movedReferrer } from './moveIn';

const KEY = 'singspree_referrer';
const ARRIVAL_KEY = 'singspree_arrival';
const MAX_LENGTH = 500;

/** How a visitor arrived by one of our own links */
export type Arrival = 'qr' | 'link' | 'join' | 'invite' | 'share';

/** What a page's own address says about how the visitor got there (arrivalFrom) */
export interface ArrivalInfo {
  arrival: Arrival | null;
  /** the URL tag to take out again */
  tag: string | null;
  /** a share link's code and song */
  code?: string;
  songId?: string;
}

/** URL tag → arrival. Only ever on join URLs: the home page uses ?q= for its search. */
const TAGS: Record<string, Arrival> = { qr: 'qr', l: 'link' };
const TAG_FOR: Partial<Record<string, string>> = { qr: 'qr', link: 'l' };

// An optional language prefix: nginx sends /de/join/… on to /join/… with its
// query, but the dev server and the router's own legacy redirect see it first.
const JOIN_PATH = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:j|join|mic)\/[^/]+/;
const PROFILE_PATH = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?u\/[^/]+\/?$/;
const SONG_PATH = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?sing\/([^/]+)\/?$/;

/** Every arrival the backend accepts (routes/listens.ts). */
export const ARRIVALS: Arrival[] = ['qr', 'link', 'join', 'invite', 'share'];

// Where sessionStorage is refused, the capture still lasts for this page
// load, which is the whole join flow (join page → party is client-side)
let memory: { referrer: string; arrival: Arrival | null } | null = null;

const isExternal = (url: string | null | undefined) => {
  if (!url) return false;
  try {
    const { origin } = new URL(url);
    // singpro.app, the name until 2026-10-19, hands its visitors over (moveIn.ts)
    return origin !== window.location.origin && origin !== OLD_ORIGIN;
  } catch {
    return false; // not a URL we can reason about
  }
};

/**
 * What a page's own address says about how the visitor got there:
 * { arrival, tag }, `tag` being the URL tag to take out again (or null);
 * for a share link also the song and the share's `code`.
 */
export const arrivalFrom = (pathname = '', search = ''): ArrivalInfo => {
  const params = new URLSearchParams(search);
  const song = SONG_PATH.exec(pathname);
  if (song && params.has(SHARE_TAG)) {
    const code = validShareCode(params.get(SHARE_TAG));
    return code ? { arrival: 'share', tag: SHARE_TAG, code, songId: song[1] } : { arrival: null, tag: SHARE_TAG };
  }
  if (JOIN_PATH.test(pathname)) {
    const tag = Object.keys(TAGS).find(k => params.has(k)) ?? null;
    return { arrival: tag ? TAGS[tag] : 'join', tag };
  }
  if (PROFILE_PATH.test(pathname) && params.get('add') === '1') return { arrival: 'invite', tag: null };
  return { arrival: null, tag: null };
};

/** The join URL for a party, tagged with how it is handed out ('qr', 'link', or nothing). */
export const partyJoinUrl = (partyId: string, via?: string | null, host = window.location.hostname): string =>
  `https://${host}/j/${partyId}${TAG_FOR[via as string] ? `?${TAG_FOR[via as string]}` : ''}`;

/** Take the tags out of the address bar, keeping anything else in it. */
const stripTags = () => {
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  for (const k of [...Object.keys(TAGS), SHARE_TAG]) params.delete(k);
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', `${pathname}${rest ? `?${rest}` : ''}${hash}`);
};

/**
 * Call once at start-up, before the router does anything. Storing '' for a
 * direct visit matters: it marks the tab as already captured, so a later
 * in-app navigation cannot overwrite a real referrer with an empty one.
 *
 * A tagged link is the exception: it is a new arrival even in a tab that
 * already has one (a party link pasted into it), and since the tag is gone
 * after this, a reload cannot repeat it. An untagged join URL is not, or
 * reloading the join page would turn a QR code arrival into 'join'.
 */
export const captureReferrer = () => {
  let found: ArrivalInfo = { arrival: null, tag: null };
  try { found = arrivalFrom(window.location.pathname, window.location.search); } catch { /* no location to read */ }
  // A visitor moved over from singpro.app: the page that sent them there, not singpro.app
  const sender = movedReferrer ?? document.referrer;
  const ref = isExternal(sender) ? sender.slice(0, MAX_LENGTH) : '';
  try {
    if (found.tag || sessionStorage.getItem(KEY) === null) {
      sessionStorage.setItem(KEY, ref);
      sessionStorage.setItem(ARRIVAL_KEY, found.arrival ?? '');
    }
  } catch {
    memory = { referrer: ref, arrival: found.arrival };
  }
  // A share link: the song's landing says who sent it (ShareLanding), before any party starts
  if (found.code) captureShareArrival(found.songId, found.code);
  if (found.tag) {
    try { stripTags(); } catch { /* the tag stays in the address bar; the arrival is kept all the same */ }
  }
};

const read = (key: string, field: 'referrer' | 'arrival'): string | null => {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored !== null) return stored || null;
  } catch { /* fall back to this page load's capture */ }
  return memory?.[field] || null;
};

/** The external page that sent this visitor, or null for a direct visit. */
export const getReferrer = (): string | null => read(KEY, 'referrer');

/** How this visitor arrived by one of our own links ('qr', 'link', 'join', 'invite'), or null. */
export const getArrival = (): Arrival | null => {
  const arrival = read(ARRIVAL_KEY, 'arrival');
  return ARRIVALS.includes(arrival as Arrival) ? arrival as Arrival : null;
};
