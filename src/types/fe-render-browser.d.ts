// Browser APIs the drawing and playback modules use that lib.dom does not declare
export {};

declare global {
  interface Document {
    /** WebKit's prefixed fullscreen (old WebKit-derived browsers, a TV stick's WebView): fullscreen.js */
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void;
  }

  interface HTMLElement {
    webkitRequestFullscreen?: () => void;
  }

  interface Window {
    /** What the TCL browser on Fire TV adds to every page (videoTakeover.js) */
    videoDetect?: { sendVideoInfo?: unknown };
    PlayerControlsInterface?: { fullscreenClick?: unknown };
  }

  /** The HTML spec takes any id here (null clears nothing); lib.dom only number | undefined (popoutWindow.js) */
  function clearInterval(id: number | null | undefined): void;
}
