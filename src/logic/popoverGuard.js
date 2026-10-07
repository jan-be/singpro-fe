/**
 * The free middle of the sing page pauses / resumes on click, and the
 * popovers (microphone, volume, settings, QR, the queue) close on any press
 * outside. A click meant to dismiss a popover must not also toggle playback:
 * the popovers note when a press closed one, and the playback toggle ignores
 * the click that press ends in.
 *
 * Per press rather than for a while after: a 400 ms window, checked once the
 * stage had waited out its double-click time, let a press held longer than
 * ~150 ms pause the song.
 */
let dismissed = false; // the latest press closed a popover

// Every press starts out as no dismissal. Capture on the window runs before
// the popovers' own handlers on the document, which then set it.
if (typeof window !== 'undefined') {
  const reset = () => { dismissed = false; };
  window.addEventListener('pointerdown', reset, true);
  window.addEventListener('keydown', reset, true);
}

export const markPopoverClosed = () => { dismissed = true; };

/** Whether the press behind this click closed a popover (ask from the click itself). */
export const popoverJustClosed = () => dismissed;
