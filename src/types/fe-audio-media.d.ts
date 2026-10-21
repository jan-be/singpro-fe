// Media capture APIs the microphone pipeline uses that lib.dom does not declare (MicrophoneInput.js)
export {};

declare global {
  /** Chrome 94+ (Media Capture Transform): a track's frames as a stream */
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
}
