// BleedWorker.js — measures how late the music reaches this device's
// microphone (bleedDelay.js), off the main thread: the correlations take tens
// of milliseconds on a phone and must not make the highway stutter.
//
// Messages in (each tagged with the song's `epoch`; anything from an older
// song is dropped):
//   { type: 'reset', epoch, options }                  a new song (estimator options, see createBleedEstimator)
//   { type: 'reference', epoch, samples, rate }        the instrumental stem, mono, at `rate`
//   { type: 'audio', epoch, samples, posEnds }         mic hops at 16 kHz, HOP samples each, and the capture clock
//                                                      at the end of each
//   { type: 'stamps', epoch, pos, stamp }              capture clock of each pitch window's end, and its song time
// Out: { type: 'estimate', epoch, delay, measured, z, chunks, confident } after every correlated chunk.

import { createBleedEstimator, createDecimator, resampleTo8k, RATE } from './bleedDelay';

let epoch = -1;
let est = null;
let lastChunks = -1;

self.onmessage = ({ data }) => {
  if (data.type === 'reset') {
    epoch = data.epoch;
    est = createBleedEstimator(data.options);
    lastChunks = -1;
    return;
  }
  if (data.epoch !== epoch || !est) return;
  if (data.type === 'reference') {
    // 16 kHz comes in from browsers without an 8 kHz offline context: halve it with the proper filter
    const samples = data.rate === 2 * RATE ? createDecimator()(data.samples) : resampleTo8k(data.samples, data.rate);
    est.setReference(samples);
  } else if (data.type === 'audio') {
    const { samples, posEnds } = data;
    const hop = samples.length / posEnds.length;
    for (let i = 0; i < posEnds.length; i++) est.pushAudio(samples.subarray(i * hop, (i + 1) * hop), posEnds[i]);
  } else if (data.type === 'stamps') {
    est.pushStamps(data.pos, data.stamp);
  }
};

// A chunk is ready every few seconds; looking once a second is plenty
setInterval(() => {
  if (!est) return;
  const e = est.step();
  if (e && e.chunks !== lastChunks) {
    lastChunks = e.chunks;
    self.postMessage({ type: 'estimate', epoch, ...e });
  }
}, 1000);
