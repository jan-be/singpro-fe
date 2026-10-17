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
 *
 * The same goes for the press that answers "Tap for sound" / "Tap to play":
 * any press on the page is that tap, and it starts the sound and the video.
 * Its click on the stage then paused the video again a moment later, and the
 * stems with it. That click still counts towards a double click.
 */
let dismissed = false; // the latest press closed a popover
let answered = false; // the latest press answered the page's prompt for a tap

// Every press starts out as neither. Capture on the window runs before the
// popovers' and the prompt's own handlers on the document, which then set them.
if (typeof window !== 'undefined') {
  const reset = () => { dismissed = false; answered = false; };
  window.addEventListener('pointerdown', reset, true);
  window.addEventListener('keydown', reset, true);
}

export const markPopoverClosed = () => { dismissed = true; };

/** Whether the press behind this click closed a popover (ask from the click itself). */
export const popoverJustClosed = () => dismissed;

export const markPromptAnswered = () => { answered = true; };

/** Whether the press behind this click answered the prompt for a tap (ask from the click itself). */
export const promptJustAnswered = () => answered;

/**
 * What a click on the free stage does: 'none' when its press closed a
 * popover, 'fullscreen' as the second click of a double click, else it starts
 * the double-click wait — 'toggle' pauses / resumes once that is over, 'wait'
 * does not, for the press that answered the prompt (the pause would stop what
 * that tap just started).
 */
export function stageClickAction({ popoverClosed = false, promptAnswered = false, secondClick = false } = {}) {
  if (popoverClosed) return 'none';
  if (secondClick) return 'fullscreen';
  return promptAnswered ? 'wait' : 'toggle';
}
