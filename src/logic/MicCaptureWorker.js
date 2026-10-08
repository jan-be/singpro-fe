// MicCaptureWorker.js — reads the microphone off the main thread where the
// browser lets a MediaStreamTrackProcessor's stream move to a worker (Chrome,
// Edge): MicrophoneInput transfers the stream here and gets back the chunks
// its own read loop would make (micChunker.js), ~33 a second.
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

import { createMicCapture, frameChannel } from './micChunker.js';

let capture = null;
let gen = 0;

async function read(readable, options) {
  capture = createMicCapture({
    ...options,
    onChunk: chunk => {
      chunk.gen = gen;
      self.postMessage(chunk, [chunk.audio.buffer]);
    },
    onLevel: volume => self.postMessage({ volume, gen }),
  });
  const reader = readable.getReader();
  let frames = 0;
  try {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) { frame?.close(); break; }
      // Extract float32 samples from the AudioData frame (the chosen channel of a stereo input)
      const channelData = frameChannel(frame, options.channel);
      frame.close();
      frames++;
      capture.push(channelData, channelData.length);
    }
  } catch (err) {
    // Only a stream that never gave a frame can be taken over by the main thread
    if (!frames) self.postMessage({ type: 'failed', error: err?.message ?? String(err) });
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'start') read(data.readable, data.options);
  else if (data.type === 'active') {
    gen = data.gen;
    capture?.setActive(!!data.active);
  }
};
