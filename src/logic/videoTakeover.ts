/**
 * Whether this browser covers large videos in web pages with a player of its own.
 *
 * The TCL web browser on Fire TV ("com.tcl.browser") lays a placeholder over
 * a big <video> (the YouTube player's inside its iframe too) and offers its
 * fullscreen player instead ("Videos erkannt, drücken Sie OK, um sie
 * anzuzeigen"), so the stage showed no video at all. A small one it leaves
 * alone: the reduced player (videoScale.js, 320x180 CSS px there, scaled up
 * by CSS) plays inline. Its user agent is a plain Android WebView's; what
 * gives it away are the objects it adds to every page — `videoDetect`
 * (reports each video to the app) and `PlayerControlsInterface` (its
 * fullscreen button's tracking).
 */
export function browserCoversVideos(win = globalThis.window) {
  try {
    return typeof win?.videoDetect?.sendVideoInfo === 'function' || typeof win?.PlayerControlsInterface?.fullscreenClick === 'function';
  } catch { return false; }
}
