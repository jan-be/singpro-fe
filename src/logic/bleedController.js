// bleedController.js — the main thread's side of the singing delay: feeds the
// microphone, the pitch stamps and the song's instrumental stem to
// BleedWorker.js and hands out the delay to take off each sung note
// (createDelayPolicy: a fixed delay until the speaker sound in the mic says
// otherwise, see bleedDelay.js).

import BleedWorker from './BleedWorker.js?worker';
import { createDelayPolicy } from './bleedDelay';

export const FALLBACK_DELAY = 0.14; // s, until (or unless) the bleed gives one
const FLUSH_HOPS = 16;              // mic hops per message to the worker (~0.5 s)

/**
 * The stem as mono audio at a low rate, rendered off the main thread (an
 * offline context resamples and mixes down). 8 kHz where the browser allows
 * an offline context that slow, else 16 or 22.05 kHz for the worker to bring down.
 */
export async function stemForBleed(buffer) {
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline || !buffer) return null;
  for (const rate of [8000, 16000, 22050]) {
    let ctx;
    try { ctx = new Offline(1, Math.max(1, Math.ceil(buffer.duration * rate)), rate); } catch { continue; }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    return { samples: out.getChannelData(0), rate };
  }
  return null;
}

/**
 * The same from the stem's file, where nothing decoded it (the stems stream,
 * streamStemPlayer.js): decoded straight into an offline context at 8 kHz
 * (else 16 or 22.05), so it never exists at the song's full rate — about
 * 15 MB for four minutes instead of ~100 — and mixed down to mono.
 */
export async function decodeStemForBleed(bytes) {
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline || !bytes) return null;
  for (const rate of [8000, 16000, 22050]) {
    let ctx;
    try { ctx = new Offline(1, 1, rate); } catch { continue; }
    const buffer = await ctx.decodeAudioData(bytes.slice(0)); // decoding detaches what it is given
    const n = buffer.length, channels = buffer.numberOfChannels;
    const samples = new Float32Array(n);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) samples[i] += data[i] / channels;
    }
    return { samples, rate: buffer.sampleRate };
  }
  return null;
}

// The decoded instrumental of the song being sung, kept for the page (one
// song): the microphone off and on again, or another microphone of this
// device (extraSingers.js), takes it from here instead of downloading and
// decoding the stem again. `key` is the stem's URL or its AudioBuffer.
let kept = null; // { key, stem: Promise<{ samples, rate } | null> }

export function keptReference(key, make) {
  if (kept?.key !== key) {
    const stem = Promise.resolve().then(make).catch(() => null);
    kept = { key, stem };
    // a failure is not kept: the next try makes it again
    stem.then((s) => { if (!s && kept?.stem === stem) kept = null; });
  }
  return kept.stem;
}

export function forgetKeptReference() { kept = null; }

/**
 * The stem's file, asked for in byte ranges as the <audio> elements that
 * stream it do (streamStemPlayer.js): the browser's cache answers a ranged
 * request from what they already fetched, a plain one goes to the network.
 */
export const fetchStem = (url) => fetch(url, { headers: { Range: 'bytes=0-' } });

export function createBleedController({ fallback = FALLBACK_DELAY, options, onEstimate } = {}) {
  let worker = null;
  try { worker = new BleedWorker(); } catch { worker = null; } // no workers: the fixed delay only
  let epoch = 0;
  let policy = createDelayPolicy({ fallback });
  let hops = [], posEnds = [], pos = [], stamps = [];
  let reference = 'none'; // 'none' | 'loading' | 'ready' | 'unavailable'

  const flush = () => {
    if (!worker) { hops = []; posEnds = []; pos = []; stamps = []; return; }
    if (hops.length) {
      const hop = hops[0].length;
      const samples = new Float32Array(hops.length * hop);
      hops.forEach((h, i) => samples.set(h, i * hop));
      const ends = Float64Array.from(posEnds);
      worker.postMessage({ type: 'audio', epoch, samples, posEnds: ends }, [samples.buffer, ends.buffer]);
      hops = []; posEnds = [];
    }
    if (pos.length) {
      const p = Float64Array.from(pos), s = Float64Array.from(stamps);
      worker.postMessage({ type: 'stamps', epoch, pos: p, stamp: s }, [p.buffer, s.buffer]);
      pos = []; stamps = [];
    }
  };

  if (worker) {
    worker.onmessage = ({ data }) => {
      if (data.type !== 'estimate' || data.epoch !== epoch) return;
      policy.update(data);
      onEstimate?.(data);
    };
    worker.onerror = () => { worker?.terminate(); worker = null; };
  }

  // The reference for this song, made by `make` (null: there is none)
  const takeReference = async (make) => {
    if (!worker || !make) { reference = 'unavailable'; return; }
    const at = epoch;
    reference = 'loading';
    let stem = null;
    try { stem = await make(); } catch { stem = null; }
    if (at !== epoch || !worker) return;
    if (!stem) { reference = 'unavailable'; return; }
    // a copy goes to the worker: the kept one stays for the next microphone
    const samples = stem.samples.slice();
    worker.postMessage({ type: 'reference', epoch, samples, rate: stem.rate }, [samples.buffer]);
    reference = 'ready';
  };

  return {
    /** A new song: nothing measured for the last one carries over. */
    startSong() {
      flush();
      epoch++;
      policy = createDelayPolicy({ fallback });
      reference = 'none';
      worker?.postMessage({ type: 'reset', epoch, options });
    },
    /** The current song's instrumental stem (an AudioBuffer), once it has loaded. */
    setReference(buffer) {
      return buffer ? takeReference(() => keptReference(buffer, () => stemForBleed(buffer))) : takeReference(null);
    },
    /** The same from the stem's URL, where the stems stream and nothing decoded it. */
    setReferenceUrl(url, fetchImpl = fetchStem) {
      return url ? takeReference(() => keptReference(url, async () => {
        const response = await fetchImpl(url);
        if (!response.ok) return null;
        return decodeStemForBleed(await response.arrayBuffer());
      })) : takeReference(null);
    },
    /** The mic's newest 16 kHz samples (a copy) and the capture clock at their end. */
    pushAudio(samples, posEnd) {
      hops.push(samples); posEnds.push(posEnd);
      if (hops.length >= FLUSH_HOPS) flush();
    },
    /** A pitch window: where it ended on the capture clock, and the song time it was stamped with. */
    pushStamp(capturePos, songTime) {
      pos.push(capturePos); stamps.push(songTime);
    },
    /** The delay (s) to take off the next sung note. */
    nextDelay() { return policy.next(); },
    state() { return { ...policy.state(), reference, worker: !!worker }; },
    dispose() { worker?.terminate(); worker = null; },
  };
}
