import { createNoiseGate } from "./MicSharedFuns";
import pitchFinderWorkletUrl from "./PitchFinderWorklet.js?worker&url";
import PitchWorkerUrl from "./PitchWorker.js?worker";
import { UserAudioRecorder } from "./AudioRecorder";

const TARGET_SAMPLE_RATE = 16000; // swift-f0 model's native rate
const IDLE_LEVELS_PER_SEC = 10;   // input level updates while the song is paused

/**
 * On iOS/Android, opening a mic MediaStream and connecting it to an AudioContext
 * causes the OS to switch to the "communication" audio category (call mode).
 * This routes audio to the earpiece, reduces volume, and degrades all audio
 * output quality — including the YouTube player running in another element.
 *
 * Workaround: use MediaStreamTrackProcessor (where available) to read mic
 * samples WITHOUT an AudioContext. The raw PCM frames are sent to a Worker
 * for pitch detection. No AudioContext = no call mode switch.
 *
 * Fallback (desktop / older browsers): use AudioContext + AudioWorklet as before.
 *
 * Both capture paths have an idle mode for a paused song (setActive(false)):
 * no resampling, no chunks and therefore no pitch inference, only a coarse
 * input level a few times a second for the microphone panel's meter.
 */

// Feature-detect MediaStreamTrackProcessor (Chrome 94+, Edge 94+, not Safari yet)
const hasTrackProcessor = typeof globalThis.MediaStreamTrackProcessor === 'function';

async function initViaTrackProcessor(stream) {
  const track = stream.getAudioTracks()[0];
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();

  const nativeSampleRate = track.getSettings().sampleRate || 48000;

  // We'll accumulate and downsample in JS since we don't have a worklet
  const ratio = nativeSampleRate / TARGET_SAMPLE_RATE;
  const SAMPLE_SIZE = 960;
  const HOP_SIZE = SAMPLE_SIZE >> 2; // 240
  const buffer = new Float32Array(SAMPLE_SIZE);
  let samplesUntilNext = SAMPLE_SIZE;
  let resamplePos = 0;
  let prevSample = 0;

  let onChunk = null; // callback: ({audio, volume}) => void

  // Idle (song paused): frames are still drained from the track, but only an
  // input level is computed, accumulated over ~100ms
  let active = true;
  let idleSumSq = 0;
  let idleCount = 0;
  const idleSamplesPerLevel = Math.round(nativeSampleRate / IDLE_LEVELS_PER_SEC);
  const setActive = (value) => {
    if (value === active) return;
    active = value;
    idleSumSq = 0;
    idleCount = 0;
    if (value) {
      // Start from a clean window: nothing from before the pause leaks into the first chunk
      buffer.fill(0);
      samplesUntilNext = SAMPLE_SIZE;
      resamplePos = 0;
      prevSample = 0;
    }
  };

  // Read loop runs as a microtask chain — no AudioContext involved
  let running = true;
  (async () => {
    while (running) {
      const { value: frame, done } = await reader.read();
      if (done || !running) { frame?.close(); break; }

      // Extract float32 samples from the AudioData frame
      const channelData = new Float32Array(frame.numberOfFrames);
      frame.copyTo(channelData, { planeIndex: 0 });
      frame.close();

      const inputLen = channelData.length;

      if (!active) {
        let sumSq = 0;
        for (let i = 0; i < inputLen; i++) sumSq += channelData[i] * channelData[i];
        idleSumSq += sumSq;
        idleCount += inputLen;
        if (idleCount >= idleSamplesPerLevel) {
          const volume = Math.sqrt(idleSumSq / idleCount);
          idleSumSq = 0;
          idleCount = 0;
          if (onChunk) onChunk({ volume });
        }
        continue;
      }

      // Downsample to 16kHz using linear interpolation (same algorithm as worklet)
      for (let i = 0; i < inputLen; i++) {
        const cur = channelData[i];
        while (resamplePos <= i) {
          const frac = resamplePos - Math.floor(resamplePos);
          const lo = Math.floor(resamplePos);
          const sample = lo < i ? prevSample * (1 - frac) + cur * frac : cur;

          buffer.copyWithin(0, 1);
          buffer[SAMPLE_SIZE - 1] = sample;
          samplesUntilNext--;

          if (samplesUntilNext <= 0) {
            let sumSq = 0;
            for (let j = 0; j < SAMPLE_SIZE; j++) sumSq += buffer[j] * buffer[j];
            const volume = Math.sqrt(sumSq / SAMPLE_SIZE);
            const copy = new Float32Array(buffer);
            if (onChunk) onChunk({ audio: copy, volume });
            samplesUntilNext += HOP_SIZE;
          }

          resamplePos += ratio;
        }
        prevSample = cur;
      }
      resamplePos -= inputLen;
    }
  })();

  return {
    setOnChunk: fn => { onChunk = fn; },
    setActive,
    stop: () => {
      running = false;
      reader.cancel().catch(() => {});
      track.stop();
    },
  };
}

async function initViaAudioWorklet(stream) {
  // Desktop fallback — AudioContext won't cause call-mode issues on desktop
  const context = new AudioContext({ latencyHint: 'interactive' });
  if (context.state === 'suspended') await context.resume();
  const source = context.createMediaStreamSource(stream);

  await context.audioWorklet.addModule(pitchFinderWorkletUrl);
  const workletNode = new AudioWorkletNode(context, 'pitch-finder-worklet', {
    processorOptions: {
      nativeSampleRate: context.sampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
    },
  });

  source.connect(workletNode);
  // Do NOT connect to destination — worklet sends data via postMessage

  let onChunk = null;
  workletNode.port.onmessage = ({ data }) => {
    if (onChunk) onChunk(data);
  };

  return {
    setOnChunk: fn => { onChunk = fn; },
    setActive: active => workletNode.port.postMessage({ type: 'active', active }),
    stop: () => {
      workletNode.port.onmessage = null;
      stream.getTracks().forEach(t => t.stop());
      source.disconnect();
      workletNode.disconnect();
      if (context.state !== 'closed') context.close();
    },
  };
}

/** @param {{ deviceId?: string }} [options] a specific input device (from enumerateDevices), default otherwise */
export const initMicInput = async ({ deviceId } = {}) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });

  // --- ONNX Worker setup ---
  const onnxWorker = new PitchWorkerUrl();

  // Wait for model to load
  await new Promise((resolve, reject) => {
    onnxWorker.onmessage = ({ data }) => {
      if (data.type === 'init') {
        if (data.status === 'ok') resolve();
        else reject(new Error(data.error));
      }
    };
    const modelUrl = new URL('/model.onnx', window.location.origin).href;
    onnxWorker.postMessage({ type: 'init', modelUrl });
  });

  // Callback that the consumer sets via setOnProcessing
  let processingCallback = null;

  // --- Debug stats ---
  const stats = {
    active: true,      // false while the song is paused (pipeline idle)
    totalChunks: 0,
    chunksPerSec: 0,
    totalNotes: 0,     // non-zero frequencies detected
    notesPerSec: 0,
    gatedChunks: 0,
    lastFreq: 0,
    lastVolume: 0,
    _secChunks: 0,
    _secNotes: 0,
  };
  const statsInterval = setInterval(() => {
    stats.chunksPerSec = stats._secChunks;
    stats.notesPerSec = stats._secNotes;
    stats._secChunks = 0;
    stats._secNotes = 0;
  }, 1000);

  // Handle ONNX worker results
  onnxWorker.onmessage = ({ data }) => {
    if (data.type === 'detect') {
      const freq = data.pitchHz; // raw Hz (0 = no pitch detected)
      stats.lastFreq = freq;
      if (freq > 0) {
        stats.totalNotes++;
        stats._secNotes++;
      }
      if (processingCallback) {
        processingCallback({ data: { freq, volume: data.volume } });
      }
    }
  };

  // --- Audio capture ---
  // Use MediaStreamTrackProcessor on mobile to avoid AudioContext call-mode.
  // Fall back to AudioWorklet on desktop / older browsers.
  const capture = hasTrackProcessor
    ? await initViaTrackProcessor(stream)
    : await initViaAudioWorklet(stream);

  const recorder = new UserAudioRecorder(stream);

  const noiseGate = createNoiseGate();
  capture.setOnChunk(({ audio, volume }) => {
    stats.lastVolume = volume;
    if (!audio) return; // song paused: only the level for the mic panel's meter

    stats.totalChunks++;
    stats._secChunks++;
    stats.noiseFloor = noiseGate.getNoiseFloor();

    if (noiseGate.shouldGate(volume)) {
      stats.gatedChunks++;
      if (processingCallback) {
        processingCallback({ data: { freq: 0, volume } });
      }
      return;
    }

    onnxWorker.postMessage(
      { type: 'detect', audio, volume },
      [audio.buffer]
    );
  });

  // Song playing → full pipeline; song paused → capture idles (level only),
  // no inference, and the recording pauses with it.
  let active = true;
  const setActive = (value) => {
    const next = !!value;
    if (next === active) return;
    active = next;
    stats.active = next;
    capture.setActive(next);
    recorder.setPaused(!next);
  };

  return {
    setOnProcessing: fn => { processingCallback = fn; },
    setActive,
    stats,
    recorder,
    stopMicInput: () => {
      processingCallback = null;
      clearInterval(statsInterval);
      capture.stop();
      onnxWorker.terminate();
      recorder.stopAndUpload();
    },
  };
};
