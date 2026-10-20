// PitchWorkerMinimal.js — the WASM pitch worker: swift-f0 on our own minimal
// ONNX Runtime build (ortMinimal.js, tools/ort-minimal), single-threaded with
// ordinary memory, so it also starts on Safari before iOS 18, which refused
// the stock 1.29 runtime's shared memory (that needed a 1.18 fallback until
// October 2026). It loads the ORT-format model (public/model.ort), the only
// format a minimal build reads.

import * as ort from './ortMinimal';
import { servePitchRequests } from './pitchWorkerCore';

servePitchRequests(ort, 'wasm-min');
