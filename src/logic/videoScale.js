// videoScale.js — a smaller YouTube player, scaled back up, where the video
// would cost a device more than it can spare.
//
// YouTube streams by the player's size in device pixels, and never asks
// whether the device decodes the stream in hardware. On a Fire TV stick in
// Silk the page reports 4 device px per CSS px, so a full-stage player got
// 1080p in AV1 — which Silk decodes in software: four dav1d threads on ~1.5
// of the stick's 4 cores, the highway at 8 paints a second, the stems
// corrected 10 times in 75 s. The same player at a quarter of the size,
// scaled back up by CSS, gets 720p: the decoder on ~1 core, the highway at
// 26 paints a second, no corrections. We cannot pick the codec (the choice
// is YouTube's, inside its iframe), only the resolution.
//
// So the reduced player is sized for about 540 device px of height, which
// YouTube answers with 720p (reducedVideoScale), and a device gets it at once
// when AV1 there is software while VP9/H.264 are hardware (the stick reports
// exactly that through MediaCapabilities) and it has little memory; any other
// device only once its frames show it struggling while the video plays
// (createStruggleWatch), for the rest of the visit (sessionStorage). The
// picture is softer, behind lyrics and a highway on a TV. The iframe is only
// resized: the video plays on. `?videoscale=N` (1 = full size) on any URL
// fixes the scale for this browser, to try it on a device; `?videoscale=0`
// hands it back to the watch.

import { TARGET_FPS } from './frameGovernor';

const KEY = 'singpro_video_scale';         // localStorage: a scale chosen by hand
const SESSION_KEY = 'singpro_video_scale'; // sessionStorage: this visit was found to need the reduced player
const TARGET_HEIGHT = 540;                 // device px of player height: YouTube streams 720p for it
const MAX_SCALE = 8;

/** Call once at startup: a ?videoscale= parameter updates the stored choice. */
export function syncVideoScaleFromUrl(search = globalThis.location?.search ?? '', storage = globalThis.localStorage) {
  try {
    const v = new URLSearchParams(search).get('videoscale');
    if (v === null) return;
    const n = Number(v);
    if (n >= 1 && n <= MAX_SCALE) storage.setItem(KEY, String(n));
    else storage.removeItem(KEY);
  } catch { /* */ }
}

/** The scale chosen by hand, if any, else null. */
export function forcedVideoScale(storage = globalThis.localStorage) {
  try {
    const v = storage.getItem(KEY);
    const n = Number(v);
    return v !== null && n >= 1 && n <= MAX_SCALE ? n : null;
  } catch { return null; }
}

/**
 * The scale that leaves about TARGET_HEIGHT device px of video in a stage
 * `cssWidth` x `cssHeight` at `dpr`: the height the 16:9 picture takes there
 * (a phone in portrait letterboxes it to its width), not the stage's.
 */
export function reducedVideoScale(cssWidth = globalThis.innerWidth, cssHeight = globalThis.innerHeight, dpr = globalThis.devicePixelRatio || 1) {
  const videoHeight = Math.min(cssHeight, (cssWidth * 9) / 16);
  if (!(videoHeight > 0)) return 1;
  return Math.min(MAX_SCALE, Math.max(1, (videoHeight * dpr) / TARGET_HEIGHT));
}

/** The scale to start a player at: the hand-picked one, else the reduced one if this visit needed it, else full size. */
export function initialVideoScale(local = globalThis.localStorage, session = globalThis.sessionStorage, reduced = reducedVideoScale) {
  const forced = forcedVideoScale(local);
  if (forced !== null) return forced;
  try { return session.getItem(SESSION_KEY) === '1' ? reduced() : 1; } catch { return 1; }
}

export function rememberReducedScale(session = globalThis.sessionStorage) {
  try { session.setItem(SESSION_KEY, '1'); } catch { /* this page only */ }
}

/**
 * Whether this device decodes AV1 in software while it has VP9 in hardware
 * (MediaCapabilities' powerEfficient), with little memory: a TV stick, where
 * YouTube's AV1 at full resolution takes the cores the page needs.
 */
export async function softwareAv1OnWeakDevice(nav = globalThis.navigator) {
  if (!(nav?.deviceMemory <= 2) || !nav.mediaCapabilities?.decodingInfo) return false;
  const info = (contentType) => nav.mediaCapabilities.decodingInfo({
    type: 'media-source', video: { contentType, width: 1920, height: 1080, bitrate: 3_000_000, framerate: 30 },
  });
  try {
    const [av1, vp9] = await Promise.all([info('video/mp4; codecs="av01.0.08M.08"'), info('video/webm; codecs="vp09.00.40.08"')]);
    return av1.supported && !av1.powerEfficient && vp9.supported && vp9.powerEfficient;
  } catch { return false; }
}

/**
 * Watches the page's frames while the video plays, counted per second as the
 * highway's frame governor counts them (frameGovernor.js: a starved page
 * shows bursts of quick frames between long stalls, so the count tells where
 * the median interval does not), against 60 a second or the display's own
 * rate when that is lower. `frame(now, playing)` returns true once `windows`
 * seconds of playback in a row ran at under `share` of that — by then the
 * highway paints only every 2nd or 3rd frame, so this is a device that cannot
 * keep up even so, not a moment of load (a song starting, a stall). Time not
 * playing, and a gap of a hidden tab, does not count.
 */
export function createStruggleWatch({ share = 0.5, windows = 8, windowMs = 1000, stallMs = 2500 } = {}) {
  let last = null;
  let minInterval = Infinity; // the shortest frame interval seen: the display's refresh, or close to it
  let windowStart = null;
  let windowFrames = 0;
  let slowRuns = 0;
  let decided = false;
  return {
    frame(now, playing) {
      if (decided) return true;
      const dt = last === null ? null : now - last;
      last = now;
      if (dt !== null && dt >= 4 && dt < minInterval) minInterval = dt;
      if (!playing || (dt !== null && dt > stallMs)) { windowStart = null; return false; }
      if (windowStart === null) { windowStart = now; windowFrames = 0; return false; }
      windowFrames++;
      const elapsed = now - windowStart;
      if (elapsed >= windowMs) {
        const target = Math.min(TARGET_FPS, minInterval < Infinity ? 1000 / minInterval : TARGET_FPS);
        slowRuns = (windowFrames * 1000) / elapsed < share * target ? slowRuns + 1 : 0;
        windowStart = now;
        windowFrames = 0;
        if (slowRuns >= windows) decided = true;
      }
      return decided;
    },
  };
}
