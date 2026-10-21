// Browser APIs the app uses that lib.dom does not declare (or declares too narrowly)
export {};

declare global {
  interface Window {
    /** WebKit before Safari 14.1 */
    webkitAudioContext?: typeof AudioContext;
    /** What the TCL browser on Fire TV adds to every page (videoTakeover.ts) */
    videoDetect?: { sendVideoInfo?: unknown };
    PlayerControlsInterface?: { fullscreenClick?: unknown };
  }

  interface Navigator {
    /** Safari 16.4+: the page's audio session ('auto', 'playback', 'ambient', …) */
    audioSession?: { type: string };
    /** Chromium's User-Agent Client Hints (platformHints.ts); not Safari, not Firefox */
    userAgentData?: NavigatorUAData;
  }

  interface NavigatorUAData {
    getHighEntropyValues(hints: string[]): Promise<{ platform?: string; platformVersion?: string; [hint: string]: unknown }>;
  }

  interface Document {
    /** WebKit's prefixed fullscreen (old WebKit-derived browsers, a TV stick's WebView): fullscreen.ts */
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void;
  }

  interface HTMLElement {
    webkitRequestFullscreen?: () => void;
  }

  /** Chrome's AudioContext.playbackStats (older builds: the fallbackFrames names) */
  interface AudioPlaybackStats {
    underrunEvents?: number;
    underrunDuration?: number;
    fallbackFramesEvents?: number;
    fallbackFramesDuration?: number;
    averageLatency?: number;
  }

  interface AudioContext {
    playbackStats?: AudioPlaybackStats;
  }

  /** Chrome 94+ (Media Capture Transform): a track's frames as a stream (MicrophoneInput.ts) */
  interface MediaStreamTrackProcessor {
    readonly readable: ReadableStream<AudioData>;
  }

  var MediaStreamTrackProcessor: {
    prototype: MediaStreamTrackProcessor;
    new (init: { track: MediaStreamTrack, maxBufferSize?: number }): MediaStreamTrackProcessor;
  };

  interface MediaTrackSettings {
    /** the browser's estimate of the input latency (s), where it gives one */
    latency?: number;
  }

  // The HTML spec takes any id here (null clears nothing); lib.dom only number | undefined
  function clearTimeout(id: number | null | undefined): void;
  function clearInterval(id: number | null | undefined): void;
}
