// Browser APIs the party page uses that lib.dom does not declare (or declares too narrowly)
export {};

declare global {
  interface Window {
    /** WebKit before Safari 14.1 */
    webkitAudioContext?: typeof AudioContext;
  }

  interface Navigator {
    /** Safari 16.4+: the page's audio session ('auto', 'playback', 'ambient', …) */
    audioSession?: { type: string };
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

  /** The HTML spec takes any id here (null clears nothing); lib.dom only number | undefined */
  function clearTimeout(id: number | null | undefined): void;
}
