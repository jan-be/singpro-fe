/**
 * Where a visitor came from.
 *
 * `document.referrer` holds the external source only on the very first page
 * load: a client-side route change clears it, and every fetch() the app makes
 * carries our own page as its Referer, so the HTTP header the server sees on
 * API calls is always a self-referral. Capture it once per tab instead, and
 * keep it for the rest of the session so a play recorded twenty minutes in
 * still knows which link started it.
 */
const KEY = 'singpro_referrer';
const MAX_LENGTH = 500;

const isExternal = (url) => {
  if (!url) return false;
  try {
    return new URL(url).origin !== window.location.origin;
  } catch {
    return false; // not a URL we can reason about
  }
};

/**
 * Call once at start-up, before the router does anything. Storing '' for a
 * direct visit matters: it marks the tab as already captured, so a later
 * in-app navigation cannot overwrite a real referrer with an empty one.
 */
export const captureReferrer = () => {
  try {
    if (sessionStorage.getItem(KEY) !== null) return;
    const ref = isExternal(document.referrer) ? document.referrer.slice(0, MAX_LENGTH) : '';
    sessionStorage.setItem(KEY, ref);
  } catch { /* private mode: this visit goes unattributed */ }
};

/** The external page that sent this visitor, or null for a direct visit. */
export const getReferrer = () => {
  try {
    return sessionStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
};
