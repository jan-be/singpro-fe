// PitchWorkerCompat.js — PitchWorker.js on ONNX Runtime 1.18, for the browsers
// where 1.29 cannot start. Since 1.19 ORT ships only its threaded WebAssembly
// build, which always asks for a shared memory of up to 4 GB, even with one
// thread; Safari before iOS/iPadOS 18 refuses it ("no available backend found.
// ERR: [wasm] RangeError: Out of memory", WebKit bugs 255103 and 256023,
// onnxruntime#22086), and a smaller maximum only postpones the error, since
// that Safari does not give shared memory back. 1.18's single-threaded build
// uses ordinary memory. MicrophoneInput starts this worker only when
// PitchWorker.js fails (see pitchWorkerChoice.js); its two ~10 MB WebAssembly
// files are fetched only then.

import * as ort from 'onnxruntime-web-118/wasm-core';
import wasmSimdUrl from '../../node_modules/onnxruntime-web-118/dist/ort-wasm-simd.wasm?url';
import wasmUrl from '../../node_modules/onnxruntime-web-118/dist/ort-wasm.wasm?url';
import { servePitchRequests } from './pitchWorkerCore';

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true; // the SIMD file where the browser has SIMD, the plain one otherwise
ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': wasmSimdUrl, 'ort-wasm.wasm': wasmUrl };

servePitchRequests(ort, 'wasm-1.18');
