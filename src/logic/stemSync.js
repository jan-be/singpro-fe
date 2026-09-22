// stemSync.js — keeping the two stems on the video's clock without the
// stutter a seek loop makes.
//
// The karaoke track follows the video, the vocals follow the karaoke track
// (syncing each to the video on its own let them sit far enough apart to
// be heard as an echo). A seek is the only cure for a large drift, but on
// iOS a seek in an Ogg stream takes a few hundred milliseconds — there is
// no index, WebKit bisects with range requests — during which the sought
// element stands still while the other runs on. Seeking the vocals at every
// 40 ms of drift, as the first version did, therefore seeks forever: each
// seek creates the drift that triggers the next, and each one is heard as
// a stutter. So a seek is never issued while one is in progress nor within
// SEEK_COOLDOWN of the previous one, and a drift below the seek threshold
// is chased with the playback rate instead: a few per cent, converging in
// seconds and time-stretched by the browser, so no pitch change.

export const SEEK_COOLDOWN = 2;         // s between seeks
export const KARAOKE_SEEK_DRIFT = 0.3;  // s off the video: the karaoke seeks
export const VOCALS_SEEK_DRIFT = 0.5;   // s off the karaoke: the vocals seek
export const START_SEEK_DRIFT = 0.1;    // s: a start seeks anything further off
export const DEADBAND = 0.02;           // s: closer than this is aligned
export const RATE_GAIN = 0.3;           // rate delta per second of drift
export const MAX_RATE_DELTA = 0.05;

// drift > 0: the follower is behind, so it runs faster
function chase(drift, base) {
  if (Math.abs(drift) < DEADBAND) return base;
  return base + Math.max(-MAX_RATE_DELTA, Math.min(MAX_RATE_DELTA, drift * RATE_GAIN));
}

/**
 * One sync step. Times in seconds; `now` is any monotonic clock in seconds
 * and `lastSeekAt` its value at the previous seek (-Infinity for none).
 * Returns the seeks to issue (absolute times; absent for none) and the
 * playback rates to set. `immediate` is a start: whatever is off seeks,
 * cooldown or not, and the rates are 1.
 */
export function planStemSync({
  videoTime, karaokeTime, vocalsTime,
  karaokeSeeking = false, vocalsSeeking = false,
  now = 0, lastSeekAt = -Infinity, immediate = false,
}) {
  const plan = { karaokeRate: 1, vocalsRate: 1 };
  const hasVocals = typeof vocalsTime === 'number';
  if (immediate) {
    if (Math.abs(videoTime - karaokeTime) > START_SEEK_DRIFT) plan.seekKaraoke = videoTime;
    if (hasVocals && Math.abs(videoTime - vocalsTime) > START_SEEK_DRIFT) plan.seekVocals = videoTime;
    return plan;
  }
  if (karaokeSeeking) return plan; // the vocals wait for it, at rate 1
  const canSeek = now - lastSeekAt >= SEEK_COOLDOWN;
  const karaokeDrift = videoTime - karaokeTime;
  if (Math.abs(karaokeDrift) > KARAOKE_SEEK_DRIFT && canSeek) {
    plan.seekKaraoke = videoTime;
    if (hasVocals) plan.seekVocals = videoTime; // along with it, whatever they were doing
    return plan;
  }
  plan.karaokeRate = chase(karaokeDrift, 1);
  if (!hasVocals || vocalsSeeking) return plan;
  const vocalsDrift = karaokeTime - vocalsTime;
  if (Math.abs(vocalsDrift) > VOCALS_SEEK_DRIFT && canSeek) plan.seekVocals = karaokeTime;
  else plan.vocalsRate = chase(vocalsDrift, plan.karaokeRate); // on top of the karaoke's rate, or it never catches up
  return plan;
}
