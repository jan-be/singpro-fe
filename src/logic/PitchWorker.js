// PitchWorker.js — Web Worker that runs swift-f0 ONNX inference for pitch detection.
// Receives Float32Array audio chunks (16kHz mono) with their time on the chunk
// clock, returns the pitch the voicing tracker accepts (0 = none).
// (PitchWorkerGpu.js is the opt-in WebGPU twin with the same protocol.)
// MicrophoneInput sends one chunk at a time (inferenceScheduler.js), so there
// is never a queue here.

import * as ort from 'onnxruntime-web/wasm';
import { createVoicingTracker } from './pitchModel';

// Configure ONNX Runtime WASM
ort.env.wasm.numThreads = 1; // single-threaded to avoid SharedArrayBuffer requirement
ort.env.wasm.simd = true;

let session = null;
const voicing = createVoicingTracker();

self.onmessage = async ({ data }) => {
  const { type } = data;

  if (type === 'init') {
    try {
      const { modelUrl } = data;
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      });
      self.postMessage({ type: 'init', status: 'ok', provider: 'wasm' });
    } catch (err) {
      self.postMessage({ type: 'init', status: 'error', error: err.message });
    }
    return;
  }

  if (type === 'detect' && session) {
    const t0 = performance.now();

    try {
      const { audio, volume, t } = data; // audio: Float32Array (16kHz), volume: number, t: chunk clock (s)
      const inputTensor = new ort.Tensor('float32', audio, [1, audio.length]);
      const results = await session.run({ input_audio: inputTensor });
      const hz = results.pitch_hz.data, conf = results.confidence.data;
      const pitchHz = voicing.pick(hz, conf, t ?? t0 / 1000);
      // raw*: the model's own last frame, for the level calibration (levelCalibration.js)
      self.postMessage({ type: 'detect', pitchHz, rawHz: hz[hz.length - 1] ?? 0, rawConf: conf[conf.length - 1] ?? 0, volume, fric: data.fric, pos: data.pos, ms: performance.now() - t0 });
    } catch (err) {
      // On error, send zero pitch — don't break the pipeline
      self.postMessage({ type: 'detect', pitchHz: 0, volume: data.volume ?? 0, fric: data.fric, pos: data.pos, ms: performance.now() - t0, error: err.message });
    }
    return;
  }
};
