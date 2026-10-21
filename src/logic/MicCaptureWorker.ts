// MicCaptureWorker.ts — reads the microphone off the main thread where the
// browser lets a MediaStreamTrackProcessor's stream move to a worker (Chrome,
// Edge): MicrophoneInput transfers the stream here and gets back the chunks
// its own read loop would make (micChunker.ts), ~33 a second.
//
// Chrome then delivers the track's frames straight to this thread. Read on
// the main thread, each of the ~100 frames a second cost a stream read and its
// promise there: measured on a desktop, ~6 ms of main thread a second for the
// read loop, ~1.5 ms for receiving the chunks from here instead.
//
// Messages in:
//   { type: 'start', readable, options }     the track processor's stream; options for createChunker
//                                            (nativeRate, targetRate, windowSamples, hopSamples)
//   { type: 'active', active, gen }          the song paused / runs again: `gen` tags everything sent after
// Out:
//   { audio, volume, fric, pos, gen }        a chunk (audio transferred)
//   { volume, gen }                          an input level while idle
//   { type: 'failed', error }                the stream could not be read (nothing else was sent)

import { createMicCapture } from './micChunker';
import type { AudioFrame, MicCapture, MicCaptureMessage, MicCaptureScope, MicCaptureWorkerOptions } from './micChunker';

// This file's global scope: a dedicated worker's, as far as it uses it (the
// page's project checks this file too, for its test, where the lib's `self` is
// the window; the test stands this scope in)
declare const self: MicCaptureScope;

let capture: MicCapture | null = null;
let gen = 0;

async function read(readable: ReadableStream<AudioFrame>, options: MicCaptureWorkerOptions) {
  capture = createMicCapture({
    ...options,
    onChunk: chunk => self.postMessage(Object.assign(chunk, { gen }), [chunk.audio.buffer]),
    onLevel: volume => self.postMessage({ volume, gen } satisfies MicCaptureMessage),
  });
  const reader = readable.getReader();
  let frames = 0;
  try {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) { frame?.close(); break; }
      // Extract float32 samples from the AudioData frame
      const channelData = new Float32Array(frame.numberOfFrames);
      frame.copyTo(channelData, { planeIndex: 0 });
      frame.close();
      frames++;
      capture.push(channelData, channelData.length);
    }
  } catch (err) {
    // Only a stream that never gave a frame can be taken over by the main thread
    if (!frames) self.postMessage({ type: 'failed', error: (err as Error | undefined)?.message ?? String(err) } satisfies MicCaptureMessage);
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'start') read(data.readable, data.options);
  else if (data.type === 'active') {
    gen = data.gen;
    capture?.setActive(!!data.active);
  }
};
