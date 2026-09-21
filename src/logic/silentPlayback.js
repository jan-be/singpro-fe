/**
 * Why the song is playing but nothing can be heard — or null when sound is
 * fine (or when there is nothing to hear yet).
 *
 * Two ways a running video is silent:
 *
 *   'stems'  – the stem <audio> elements and the AudioContext need a user
 *              gesture on phones (iOS refuses play() and resume() without
 *              one), and the song page is reached without a tap on it: the
 *              tap was on the song list, or there was none after a reload.
 *              YouTube, muted on purpose while stems play, keeps going.
 *   'iframe' – without stems, YouTube itself starts muted when the browser
 *              blocks autoplay with sound, and its own "unmute" pill sits
 *              under the page's overlays.
 *
 * Either way a tap on the page is the gesture that fixes it.
 *
 * @param {object} s
 * @param {boolean} s.playing      the song is running (host: own player;
 *                                 joiner: the host's clock)
 * @param {boolean} s.hasStems     the stems carry the sound
 * @param {{ paused: boolean, failed: boolean, ended: boolean } | null} s.stem
 *                                 the instrumental element, null before it exists;
 *                                 failed: a media error; ended: it ran out before
 *                                 the video did — no tap helps either
 * @param {string} [s.ctxState]    AudioContext state ('running' when audible)
 * @param {boolean} s.iframeMuted  YouTube reports itself muted
 * @param {boolean} s.mutedByUs    the page muted the iframe itself (joiner start)
 *                                 and is already offering the tap
 * @param {number} s.volume        the master volume; 0 is silence on purpose
 * @returns {null | 'stems' | 'iframe'}
 */
export function silentReason({ playing, hasStems, stem, ctxState, iframeMuted, mutedByUs, volume }) {
  if (!playing) return null;
  if (hasStems) {
    if (!stem || stem.failed || stem.ended) return null;
    return stem.paused || ctxState !== 'running' ? 'stems' : null;
  }
  if (mutedByUs || !(volume > 0)) return null;
  return iframeMuted ? 'iframe' : null;
}
