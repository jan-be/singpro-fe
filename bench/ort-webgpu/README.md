# ONNX Runtime: WASM vs WebGPU for swift-f0

Measures one inference of `public/model.onnx` on a 960-sample window (what
`src/logic/PitchWorker.js` runs about 67 times a second) with onnxruntime-web's
`wasm` and `webgpu` execution providers: back-to-back latency on the main thread
and in a worker, main-thread CPU time per run (CDP Performance metrics), and a
real-time feed at 67 chunks/s with the worker's drop-when-busy rule.

```
node bench/ort-webgpu/serve.mjs       # static server on :3005 (page, /ort/, /model.onnx)
node bench/ort-webgpu/run.mjs         # headed Chrome via Playwright, prints the table + results.json
node bench/ort-webgpu/placement.mjs   # which nodes the WebGPU provider leaves on the CPU
```

To try a phone's GPU, open `http://<this machine>:3005/?build=webgpu` on it and
run `await __api.create('webgpu')`, then `await __api.run('webgpu', 300)` in the
console (`'wasm'` for the baseline).

## Result, 2026-09-13 (desktop, NVIDIA Lovelace, Chrome 152, 600 runs)

| provider              | median | p90     | CPU/run | real-time 67/s       | first run |
|-----------------------|--------|---------|---------|----------------------|-----------|
| wasm (SIMD, 1 thread) | 2.8 ms | 3.1 ms  | 2.9 ms  | 400 done, 0 dropped  | 38 ms     |
| webgpu                | 13.8 ms| 16.1 ms | 1.7 ms  | 191 done, 201 dropped| 495 ms    |

Outputs are identical. WebGPU keeps the `STFT` and nine shape/gather ops on the
CPU, so every inference does two host-to-GPU and two GPU-to-host copies around
a graph that is far too small to amortise them. The WebGPU runtime is also
6.5 MB gzipped instead of 3.6 MB. Not worth it for this model.
