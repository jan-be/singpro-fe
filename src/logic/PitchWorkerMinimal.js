// PitchWorkerMinimal.js — the default WASM pitch worker: swift-f0 on our own
// minimal ONNX Runtime build (ortMinimal.js, tools/ort-minimal), single-
// threaded with ordinary memory, so it also starts on Safari before iOS 18,
// where the stock 1.29 runtime's shared memory does not (PitchWorkerCompat.js).
// It loads the ORT-format model (public/model.ort), the only format a
// minimal build reads. MicrophoneInput falls back to PitchWorker.js and
// PitchWorkerCompat.js when this one cannot start (pitchWorkerChoice.js).

import * as ort from './ortMinimal';
import { servePitchRequests } from './pitchWorkerCore';

servePitchRequests(ort, 'wasm-min');
