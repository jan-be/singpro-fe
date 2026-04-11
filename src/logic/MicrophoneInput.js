import { sampleSize, pitchHzToNote, createNoiseGate } from "./MicSharedFuns";
import pitchFinderWorkletUrl from "./PitchFinderWorklet.js?worker&url";
import PitchWorkerUrl from "./PitchWorker.js?worker";

const TARGET_SAMPLE_RATE = 16000; // swift-f0 model's native rate

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
  const SAMPLE_SIZE = 1280;
  const HOP_SIZE = SAMPLE_SIZE >> 2;
  const buffer = new Float32Array(SAMPLE_SIZE);
  let samplesUntilNext = SAMPLE_SIZE;
  let resamplePos = 0;
  let prevSample = 0;

  let onChunk = null; // callback: ({audio, volume}) => void

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

      // Downsample to 16kHz using linear interpolation (same algorithm as worklet)
      const inputLen = channelData.length;
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
    stop: () => {
      workletNode.port.onmessage = null;
      stream.getTracks().forEach(t => t.stop());
      source.disconnect();
      workletNode.disconnect();
      if (context.state !== 'closed') context.close();
    },
  };
}

export const initMicInput = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
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
    totalChunks: 0,
    chunksPerSec: 0,
    totalNotes: 0,     // non-zero notes detected
    notesPerSec: 0,
    gatedChunks: 0,
    lastNote: 0,
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
      const note = pitchHzToNote(data.pitchHz, data.volume);
      stats.lastNote = note;
      if (note !== 0) {
        stats.totalNotes++;
        stats._secNotes++;
      }
      if (processingCallback) {
        processingCallback({ data: { note, volume: data.volume } });
      }
    }
  };

  // --- Audio capture ---
  // Use MediaStreamTrackProcessor on mobile to avoid AudioContext call-mode.
  // Fall back to AudioWorklet on desktop / older browsers.
  const capture = hasTrackProcessor
    ? await initViaTrackProcessor(stream)
    : await initViaAudioWorklet(stream);

  const noiseGate = createNoiseGate();
  capture.setOnChunk(({ audio, volume }) => {
    stats.totalChunks++;
    stats._secChunks++;
    stats.lastVolume = volume;
    stats.noiseFloor = noiseGate.getNoiseFloor();

    if (noiseGate.shouldGate(volume)) {
      stats.gatedChunks++;
      if (processingCallback) {
        processingCallback({ data: { note: 0, volume } });
      }
      return;
    }

    onnxWorker.postMessage(
      { type: 'detect', audio, volume },
      [audio.buffer]
    );
  });

  return {
    setOnProcessing: fn => { processingCallback = fn; },
    stats,
    stopMicInput: () => {
      processingCallback = null;
      clearInterval(statsInterval);
      capture.stop();
      onnxWorker.terminate();
    },
  };
};
