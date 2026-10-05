// outputLead.js — how far ahead of the song's clock the stems play, so that
// what is heard lines up with the picture and the lyrics.
//
// From the AudioContext to the ear there is the context's own buffer
// (baseLatency) and the device after it (outputLatency): ~50 ms on a desktop,
// 250–530 ms on a Fire TV stick that sends its sound to a Bluetooth speaker
// (A2DP), more while its audio runs late under load. Without a lead the music
// came half a second after the picture there. The browser's estimate wobbles,
// so it is followed slowly; when it really moves, the page's sync moves the
// stems with it.

const MAX_LEAD = 1;   // s: beyond this the estimate is not believed
const FOLLOW = 0.2;   // share of the difference taken per update (every 0.5 s: a few seconds to follow)

/** The context's own estimate of its latency to the ear, in seconds (0 where the browser gives none). */
export function contextLatency(ctx) {
  if (!ctx) return 0;
  const v = (Number(ctx.baseLatency) || 0) + (Number(ctx.outputLatency) || 0);
  return Math.min(MAX_LEAD, Math.max(0, v));
}

/** The next lead from the last one and a fresh estimate: the first one at once, later ones slowly. */
export function nextLead(prev, estimate) {
  if (!(estimate > 0)) return prev;
  if (!(prev > 0)) return estimate;
  return prev + FOLLOW * (estimate - prev);
}
