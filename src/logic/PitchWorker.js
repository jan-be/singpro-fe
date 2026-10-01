// PitchWorker.js — Web Worker that runs swift-f0 ONNX inference for pitch
// detection on ONNX Runtime 1.29 (protocol: pitchWorkerCore.js).
// (PitchWorkerCompat.js is the same on 1.18, for the browsers where this one
// cannot start; PitchWorkerGpu.js the opt-in WebGPU twin.)

import * as ort from 'onnxruntime-web/wasm';
import { servePitchRequests } from './pitchWorkerCore';

// Configure ONNX Runtime WASM
ort.env.wasm.numThreads = 1; // single-threaded to avoid SharedArrayBuffer requirement
ort.env.wasm.simd = true;

servePitchRequests(ort, 'wasm');
