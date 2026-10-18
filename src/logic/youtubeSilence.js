/**
 * Keeping the YouTube player silent while something else carries the sound:
 * the stems, or nothing at all for a joiner whose sound is off.
 *
 * Muted, the video stopped as soon as its tab went to the background: Chrome
 * pauses a muted video in a hidden tab (and plays it on when the tab is shown
 * again), and the stems, which follow the video, stopped with it. A party left
 * playing in a background tab fell silent. At volume 0 and not muted the video
 * plays on. Unmuting needs the page to have been used first, though: before a
 * click, tap or key press on it, Chrome pauses a muted video that is unmuted,
 * at volume 0 or not (its autoplay policy). Until then the player is muted,
 * and the volume poll moves it to volume 0 once the page has been used.
 * Where a page cannot set a media element's volume at all (iOS and iPadOS:
 * it always reads 1), unmuted would be heard at full level: muted there.
 * That test alone let iOS 27 through: YouTube played at full level over the
 * stems (its player there does not take setVolume). An iPhone, iPad or iPod
 * is muted whatever the test says; in the background Safari suspends the
 * page anyway.
 */

/** An iPhone, iPad or iPod: iPadOS asks for desktop pages as a Mac, its touch screen gives it away */
export function isAppleMobile(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent ?? '');
  if (/iPhone|iPad|iPod/.test(ua) || /^(iPhone|iPad|iPod)/.test(String(nav?.platform ?? ''))) return true;
  return /Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1;
}

const probeVolume = (doc) => {
  try {
    const probe = doc.createElement('audio');
    probe.volume = 0.5;
    return Math.abs(probe.volume - 0.5) < 0.01;
  } catch { return false; }
};
let settableHere;
/** Whether this browser lets a page set a media element's volume (not on iOS/iPadOS). */
export function mediaVolumeSettable(doc) {
  if (doc) return probeVolume(doc);
  if (settableHere === undefined) settableHere = probeVolume(globalThis.document);
  return settableHere;
}

/**
 * Whether the player may be kept silent by its volume: the page has been used
 * (the user activation unmuting asks for), volumes can be set, and it is not
 * an iPhone or iPad (where YouTube's player does not take them).
 */
export function canSilenceByVolume(nav = globalThis.navigator, doc) {
  return nav?.userActivation?.hasBeenActive === true && !isAppleMobile(nav) && mediaVolumeSettable(doc);
}

/**
 * Silence the player: at volume 0 where it may be unmuted, else muted.
 * Turned down while still muted, so it is never unmuted at the user's level;
 * to 1 rather than 0, since YouTube unmutes a player at 0 to 5 (and the poll,
 * taking 5 for someone's doing, silenced it again every half second, every
 * command a jolt to the song clock: the stems restarted every 2.5 s).
 * @returns {'volume' | 'muted'}
 */
export function silencePlayer(player, nav, doc) {
  if (canSilenceByVolume(nav, doc)) {
    player.setVolume(1);
    player.unMute();
    player.setVolume(0);
    return 'volume';
  }
  player.mute();
  return 'muted';
}

/**
 * The volume poll's verdict on a player the page keeps silent, from its last
 * report (isMuted(), getVolume()):
 *   'silent'  – muted or at volume 0, as it should be
 *   'upgrade' – muted where volume 0 would do now (the page has been used since)
 *   'audible' – neither: turned up by someone else, or a report that has not
 *               caught up with our last command yet
 *   null      – the player knows nothing yet (a video just loaded)
 */
export function silenceCheck({ muted, volume, canUseVolume }) {
  if (muted === true) return canUseVolume ? 'upgrade' : 'silent';
  if (volume === 0) return 'silent';
  if (muted === false && typeof volume === 'number') return 'audible';
  return null;
}
