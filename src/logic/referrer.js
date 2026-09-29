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
 *   /join/ABCD?qr    the party's QR code                        → 'qr'
 *   /join/ABCD?l     the party link from the "Copy link" button → 'link'
 *   /join/ABCD       a join URL without a tag: typed off the big
 *                    screen, passed on from the address bar, or
 *                    an old link (and legacy /mic/ABCD/name)     → 'join'
 *   /u/name?add=1    a friend invite link (already unmistakable) → 'invite'
 *
 * A short tag without a value, because the QR code has to stay easy to scan
 * across a room: https://singpro.app/join/ABCD?qr is 32 bytes, exactly what
 * a version 2 code holds (25×25 modules at level L), like the untagged URL;
 * `?via=qr` would need version 3.
 *
 * The tag is taken out of the address bar before the router starts, so it
 * is not passed on with a link copied from there, a reload does not count
 * the arrival again, and history keeps the plain URL.
 */
const KEY = 'singpro_referrer';
const ARRIVAL_KEY = 'singpro_arrival';
const MAX_LENGTH = 500;

/** URL tag → arrival. Only ever on join URLs: the home page uses ?q= for its search. */
const TAGS = { qr: 'qr', l: 'link' };
const TAG_FOR = { qr: 'qr', link: 'l' };

// An optional language prefix: nginx sends /de/join/… on to /join/… with its
// query, but the dev server and the router's own legacy redirect see it first.
const JOIN_PATH = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:join|mic)\/[^/]+/;
const PROFILE_PATH = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?u\/[^/]+\/?$/;

/** Every arrival the backend accepts (routes/listens.js). */
export const ARRIVALS = ['qr', 'link', 'join', 'invite'];

// Where sessionStorage is refused, the capture still lasts for this page
// load, which is the whole join flow (join page → party is client-side)
let memory = null;

const isExternal = (url) => {
  if (!url) return false;
  try {
    return new URL(url).origin !== window.location.origin;
  } catch {
    return false; // not a URL we can reason about
  }
};

/**
 * What a page's own address says about how the visitor got there:
 * { arrival, tag }, `tag` being the URL tag to take out again (or null).
 */
export const arrivalFrom = (pathname = '', search = '') => {
  const params = new URLSearchParams(search);
  if (JOIN_PATH.test(pathname)) {
    const tag = Object.keys(TAGS).find(k => params.has(k)) ?? null;
    return { arrival: tag ? TAGS[tag] : 'join', tag };
  }
  if (PROFILE_PATH.test(pathname) && params.get('add') === '1') return { arrival: 'invite', tag: null };
  return { arrival: null, tag: null };
};

/** The join URL for a party, tagged with how it is handed out ('qr', 'link', or nothing). */
export const partyJoinUrl = (partyId, via, host = window.location.hostname) =>
  `https://${host}/join/${partyId}${TAG_FOR[via] ? `?${TAG_FOR[via]}` : ''}`;

/** Take the tags out of the address bar, keeping anything else in it. */
const stripTags = () => {
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  for (const k of Object.keys(TAGS)) params.delete(k);
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
  let found = { arrival: null, tag: null };
  try { found = arrivalFrom(window.location.pathname, window.location.search); } catch { /* no location to read */ }
  const ref = isExternal(document.referrer) ? document.referrer.slice(0, MAX_LENGTH) : '';
  try {
    if (found.tag || sessionStorage.getItem(KEY) === null) {
      sessionStorage.setItem(KEY, ref);
      sessionStorage.setItem(ARRIVAL_KEY, found.arrival ?? '');
    }
  } catch {
    memory = { referrer: ref, arrival: found.arrival };
  }
  if (found.tag) {
    try { stripTags(); } catch { /* the tag stays in the address bar; the arrival is kept all the same */ }
  }
};

const read = (key, field) => {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored !== null) return stored || null;
  } catch { /* fall back to this page load's capture */ }
  return memory?.[field] || null;
};

/** The external page that sent this visitor, or null for a direct visit. */
export const getReferrer = () => read(KEY, 'referrer');

/** How this visitor arrived by one of our own links ('qr', 'link', 'join', 'invite'), or null. */
export const getArrival = () => {
  const arrival = read(ARRIVAL_KEY, 'arrival');
  return ARRIVALS.includes(arrival) ? arrival : null;
};
