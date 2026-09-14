/**
 * Leave browser fullscreen, if we are in it.
 *
 * The party page is the only thing worth a full screen; once you head back to
 * the menu — from the song-complete overlay, the bar's logo or "End party" —
 * staying fullscreen leaves the home page looking like a kiosk, which is
 * particularly awkward on a TV where there is no obvious way back out.
 *
 * Only fullscreen the page itself asked for can be exited this way, and old
 * WebKit-derived browsers still spell it with a prefix.
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
