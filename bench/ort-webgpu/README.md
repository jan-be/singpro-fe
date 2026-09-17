# ONNX Runtime: WASM vs WebGPU for swift-f0

Measures one inference of the pitch model on a 960-sample window (what
`src/logic/PitchWorker.js` runs about 67 times a second) with onnxruntime-web's
`wasm` and `webgpu` execution providers (the JSEP one from `onnxruntime-web/webgpu`
and the native one from `onnxruntime-web/jspi`): back-to-back latency split into
`session.run()` and output readback, main-thread CPU time per run (CDP
Performance metrics), the same in a worker, and a real-time feed at 67 chunks/s
with the worker's drop-when-busy rule.

```
bun bench/ort-webgpu/serve.mjs       # static server on :3005 (page, /ort/, the models)
bun bench/ort-webgpu/run.mjs         # headed Chrome via Playwright, prints the table + results.json
bun bench/ort-webgpu/placement.mjs webgpu /model-gpu.onnx   # which nodes end up on the CPU
python bench/ort-webgpu/make_gpu_model.py                    # rebuild the GPU model from public/model.onnx
```

To try a phone's GPU, open `http://<this machine>:3005/?build=webgpu` on it
(WebGPU needs a secure context, so use an HTTPS tunnel or localhost) and run
`await __api.create('g', 'webgpu', { model: '/model-gpu.onnx', gpuIO: 'raw' })`,
then `await __api.run('g', 300)` in the console (`'wasm'` with `/model.onnx`
for the baseline). Or simply open the app with `?gpu=1` and `?debug`: the mic
debug overlay shows the provider and the inference time.

## Why the export is slow on WebGPU, and the GPU model

The PyTorch export (`public/model.onnx`) has an `STFT` op and an int64 chain
after the `ArgMax` (`Unsqueeze/Sub/Abs/LessOrEqual`), neither of which the
WebGPU provider runs, plus dynamic `Shape` chains. ORT keeps those on the CPU
and inserts two uploads and two readbacks per run around a graph that only
takes ~1 ms. `make_gpu_model.py` rewrites the graph so all 38 nodes run on the
GPU: the STFT becomes a Conv1d with windowed cos/sin kernels (only the 132 bins
the CNN uses; the kernel is computed in-graph from constants and folded at
session creation, so the file stays 388 KB), the ±9-bin window around the
argmax becomes a one-hot of the max convolved with a 19-wide box, and the
input is fixed at 960 samples. It matches the original within 0.002 Hz and
3e-5 confidence on 450 test frames, and costs the same as the original on
WASM. The shipped copy is `public/model-gpu.onnx`; `PitchWorkerGpu.js` uses it
behind the `?gpu=1` flag (see `src/logic/pitchGpuFlag.js`).

## Result, 2026-09-13 (desktop, NVIDIA Lovelace, Chrome 152, 400 runs)

| provider / model / IO                          | per inference (median) | of which readback | CPU per run | real-time 67/s (6 s)   |
|-----------------------------------------------|------------------------|-------------------|-------------|------------------------|
| wasm, original model                          | 2.8 ms                 | –                 | 2.9 ms      | 0 dropped              |
| wasm, gpu model                               | 3.0 ms                 | –                 | 3.1 ms      | –                      |
| webgpu (jsep), original model                 | 13.0–13.8 ms           | –                 | 1.6 ms      | 201 of 392 dropped     |
| webgpu (jsep), gpu model                      | 7.0 ms                 | –                 | 1.1 ms      | 94 of 387 dropped      |
| webgpu (jsep), gpu model, GPU-buffer IO       | 4.0 ms                 | 3.0 ms            | 0.8–0.9 ms  | 35–58 of ~390 dropped  |
| webgpu (native/jspi), gpu model, GPU-buffer IO| 3.7–3.9 ms             | 2.9 ms            | 0.6–0.7 ms  | 27–66 of ~390 dropped  |
| webgpu (native/jspi), two sessions alternating| 4.0 ms                 | 3.0 ms            | 0.7 ms      | 0 of 378–389 dropped   |
| readback floor: 24 bytes, no inference        | 3.0 ms                 | 3.0 ms            |             |                        |

**Pixel 8, in the app (`?gpu=1&debug`, 2026-09-13):** WASM ~7 ms, WebGPU ~15 ms
per inference. The phone loses by the same margin as the desktop.

The GPU compute is ~1 ms; everything else is Chrome's GPU→CPU readback, which
costs 3 ms on the desktop even for an empty copy and evidently more on the
phone. So WebGPU cannot beat WASM's latency on either device; on the desktop
it needs 3–4× less CPU, which is not worth the doubled latency. Verdict: stay
on WASM; revisit when WebNN (ORT's `webnn` provider, GPU or NPU) ships without
flags in Chrome and Safari, since the readback path is the part to re-measure. The occasional multi-ms
GPU stalls make a single session drop ~10% of chunks at 67/s; two alternating
sessions absorb them, which only the native provider supports (the JSEP one
crashes with "memory access out of bounds" on concurrent runs). Graph capture
(`enableGraphCapture`) fails in both providers with this model and ORT 1.29
(JSEP: createBindGroup with an undefined buffer; native: a wasm trap). The
WebGPU runtime downloads are 6.5 MB (jsep) / ~4.5 MB (jspi) gzipped instead of
3.6 MB. Outputs agree with WASM within 0.001 Hz.
