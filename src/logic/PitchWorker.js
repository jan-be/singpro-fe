// PitchWorker.js — Web Worker that runs swift-f0 ONNX inference for pitch detection.
// Receives Float32Array audio chunks (16kHz mono), returns pitch_hz + confidence.
// (PitchWorkerGpu.js is the opt-in WebGPU twin with the same protocol.)

import * as ort from 'onnxruntime-web/wasm';
import { pickPitch } from './pitchModel';

// Configure ONNX Runtime WASM
ort.env.wasm.numThreads = 1; // single-threaded to avoid SharedArrayBuffer requirement
ort.env.wasm.simd = true;

let session = null;
let inferenceInFlight = false;

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
    // Drop frames if inference is already in flight (real-time: better to skip than queue)
    if (inferenceInFlight) return;
    inferenceInFlight = true;
    const t0 = performance.now();

    try {
      const { audio, volume } = data; // audio: Float32Array (16kHz), volume: number
      const inputTensor = new ort.Tensor('float32', audio, [1, audio.length]);
      const results = await session.run({ input_audio: inputTensor });
      const pitchHz = pickPitch(results.pitch_hz.data, results.confidence.data);
      self.postMessage({ type: 'detect', pitchHz, volume, ms: performance.now() - t0 });
    } catch (err) {
      // On error, send zero pitch — don't break the pipeline
      self.postMessage({ type: 'detect', pitchHz: 0, volume: data.volume ?? 0, ms: performance.now() - t0, error: err.message });
    } finally {
      inferenceInFlight = false;
    }
    return;
  }
};
