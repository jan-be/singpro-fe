// PitchWorker.js — Web Worker that runs swift-f0 ONNX inference for pitch detection.
// Receives Float32Array audio chunks (16kHz mono), returns pitch_hz + confidence.

import * as ort from 'onnxruntime-web/wasm';

// Configure ONNX Runtime WASM
ort.env.wasm.numThreads = 1; // single-threaded to avoid SharedArrayBuffer requirement
ort.env.wasm.simd = true;

let session = null;
let inferenceInFlight = false;

// swift-f0 constants (from core.py)
const CONFIDENCE_THRESHOLD = 0.85;
const MIN_PITCH_HZ = 46.875;
const MAX_PITCH_HZ = 2093.75;

self.onmessage = async ({ data }) => {
  const { type } = data;

  if (type === 'init') {
    try {
      const { modelUrl } = data;
      session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      });
      self.postMessage({ type: 'init', status: 'ok' });
    } catch (err) {
      self.postMessage({ type: 'init', status: 'error', error: err.message });
    }
    return;
  }

  if (type === 'detect' && session) {
    // Drop frames if inference is already in flight (real-time: better to skip than queue)
    if (inferenceInFlight) return;
    inferenceInFlight = true;

    try {
      const { audio, volume } = data; // audio: Float32Array (16kHz), volume: number
      const inputTensor = new ort.Tensor('float32', audio, [1, audio.length]);
      const results = await session.run({ input_audio: inputTensor });

      const pitchHz = results.pitch_hz.data;   // Float32Array
      const confidence = results.confidence.data; // Float32Array

      // Use the last frame as "current" pitch — it's the most recent audio
      // swift-f0 returns one pitch per STFT frame (hop_size=256 at 16kHz ≈ 16ms)
      let bestPitch = 0;

      if (pitchHz.length > 0) {
        const lastIdx = pitchHz.length - 1;
        if (confidence[lastIdx] >= CONFIDENCE_THRESHOLD &&
            pitchHz[lastIdx] >= MIN_PITCH_HZ &&
            pitchHz[lastIdx] <= MAX_PITCH_HZ) {
          bestPitch = pitchHz[lastIdx];
        }
      }

      self.postMessage({ type: 'detect', pitchHz: bestPitch, volume });
    } catch (err) {
      // On error, send zero pitch — don't break the pipeline
      self.postMessage({ type: 'detect', pitchHz: 0, volume: data.volume ?? 0 });
    } finally {
      inferenceInFlight = false;
    }
    return;
  }
};
