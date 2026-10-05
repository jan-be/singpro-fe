/**
 * How the stems play on this browser:
 *
 *   'memory' – both files decoded whole and played as AudioBuffers
 *              (stemPlayer.js). Apple's WebKit (Safari, and every browser on
 *              iOS) needs it: a seek on a stem <audio> element there never
 *              completed, and a song still needs seeks (joining mid-song,
 *              the timeline, skipped intros). Apple devices have the memory
 *              and decode a song in about a second.
 *   'stream' – two <audio> elements streamed and mixed through Web Audio
 *              (streamStemPlayer.js): everywhere else. Starts as soon as a
 *              little has arrived and holds seconds, not the whole song —
 *              decoding it whole took 9–21 s and ~200 MB on a Fire TV stick.
 *
 * `?stems=memory` or `?stems=stream` overrides it for this browser (stored;
 * `?stems=auto` hands it back), to compare on a device.
 */
const FLAG_KEY = 'singpro_stems';

export function stemPlayback({ vendor = globalThis.navigator?.vendor, search = globalThis.location?.search ?? '', storage = globalThis.localStorage } = {}) {
  try {
    const v = new URLSearchParams(search).get('stems');
    if (v === 'memory' || v === 'stream') storage?.setItem(FLAG_KEY, v);
    else if (v !== null) storage?.removeItem(FLAG_KEY);
    const stored = storage?.getItem(FLAG_KEY);
    if (stored === 'memory' || stored === 'stream') return stored;
  } catch { /* no storage: the default */ }
  // Safari and every iOS browser report Apple as the vendor; Chrome, its
  // WebViews and Edge report Google, Firefox nothing
  return vendor === 'Apple Computer, Inc.' ? 'memory' : 'stream';
}
