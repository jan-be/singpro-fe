/**
 * Browser fullscreen, in one place: the bar's button, the sing page's
 * double-click and every way of leaving the party all go through here.
 *
 * Only fullscreen the page itself asked for can be exited again, and old
 * WebKit-derived browsers (a TV stick's WebView, say) still spell it with a
 * prefix — so both spellings are tried and every call is best-effort.
 */
const root = () => document.documentElement;

export const fullscreenSupported = () =>
  typeof document !== 'undefined' &&
  (typeof root().requestFullscreen === 'function' || typeof root().webkitRequestFullscreen === 'function');

export const isFullscreen = () => {
  try { return !!(document.fullscreenElement || document.webkitFullscreenElement); } catch { return false; }
};

/**
 * Leave fullscreen, if we are in it. The party page is the only thing worth a
 * full screen; going back to the menu still fullscreen leaves it looking like
 * a kiosk, which is particularly awkward on a TV.
 */
export const exitFullscreen = () => {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen()?.catch?.(() => {});
    } else if (document.webkitFullscreenElement && typeof document.webkitExitFullscreen === 'function') {
      document.webkitExitFullscreen();
    }
  } catch { /* denied or already out: nothing to do */ }
};

/** Enter fullscreen. Browsers only allow this from a user gesture. */
export const enterFullscreen = () => {
  try {
    const el = root();
    if (typeof el.requestFullscreen === 'function') el.requestFullscreen()?.catch?.(() => {});
    else if (typeof el.webkitRequestFullscreen === 'function') el.webkitRequestFullscreen();
  } catch { /* denied: stay windowed */ }
};

export const toggleFullscreen = () => (isFullscreen() ? exitFullscreen() : enterFullscreen());
