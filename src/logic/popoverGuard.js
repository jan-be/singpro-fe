/**
 * The free middle of the sing page pauses / resumes on click, and the
 * popovers (microphone, volume, settings, QR) close on any click outside.
 * A click meant to dismiss a popover must not also toggle playback: the
 * popovers note when they closed that way, and the playback toggle ignores
 * the click that follows.
 */
let closedAt = -Infinity;

export const markPopoverClosed = () => { closedAt = performance.now(); };

/** True for a moment after a popover was closed by an outside click. */
export const popoverJustClosed = () => performance.now() - closedAt < 400;
