# Minimal ONNX Runtime for the pitch worker

The pitch worker (`src/logic/PitchWorkerMinimal.js`) runs swift-f0 on our own
build of ONNX Runtime 1.29.0 for WebAssembly instead of onnxruntime-web's:

- **single-threaded, ordinary memory.** Since 1.19 onnxruntime-web ships only
  its threaded build, whose memory is a shared `WebAssembly.Memory` of up to
  4 GB even with one thread. Safari before iOS/iPadOS 18 refuses that ("Out of
  memory"), which is why the app needed a 1.18 fallback until October 2026;
  this build replaced both (verified on iPadOS 16.7 and iOS 17.6.1).
- **only swift-f0's operators and types**, in a *minimal build* (reads only
  ORT-format models: no ONNX parser, op schemas or graph optimizers), without
  exceptions and RTTI.

The results are bit-identical to the stock runtime's (see Verifying).

| | stock 1.29 (the former `PitchWorker.js`) | minimal |
|---|---|---|
| `.wasm` | 13,961,845 B (gzip 3,570,014, brotli 2,296,916) | 1,149,264 B (gzip 429,665, brotli 327,328) |
| worker JS | 75,300 B (ORT JS + its 24 kB glue; gzip 24,718) | 16,513 B (`ortMinimal.js` + 10 kB glue; gzip 6,681) |
| model | `model.onnx` 397,987 B (gzip 363,028) | `model.ort` 414,960 B (gzip 368,957) |
| all of it, gzip | 3.96 MB | 0.81 MB |
| worker start, desktop Chrome (no cache) | 130–185 ms | 24 ms |
| one inference, desktop Chrome | 2.8 ms | 2.7 ms |

## Files

- `build.py`: the whole build (below). Pins ONNX Runtime (tag and commit)
  and Emscripten.
- `requirements.txt`: what `build.py` needs in its Python.
- `required_operators_and_types.config`: written by the build, the
  operators and types of `public/model.onnx` after conversion, which is what
  the runtime contains. A diff here after a model change means new kernels.
- Output: `src/vendor/ort-minimal/ort-wasm-simd.{mjs,wasm}` (Emscripten's JS
  module and the runtime) and `public/model.ort`.
- `src/logic/ortMinimal.js`: the JS around the runtime. onnxruntime-web's own
  JS can only load a runtime other than its threaded one through a dynamic
  `import()` of a URL, which the classic workers Vite builds cannot rely on;
  so the worker bundles the Emscripten module and calls the C functions of
  `onnxruntime/wasm/api.h` itself, with onnxruntime-web's default session
  options. It belongs to the pinned version: update both together.

## Building

```
python -m venv D:/ort-build/venv
D:/ort-build/venv/Scripts/pip install -r tools/ort-minimal/requirements.txt
D:/ort-build/venv/Scripts/python tools/ort-minimal/build.py --work D:/ort-build/work
```

`--work` gets the ONNX Runtime clone, Emscripten and the build tree (~3 GB;
keep it off a full C:). The first run takes ~10 minutes on a 12-thread PC
(downloads, CMake's configure checks, ~450 compiles); later runs ~1 minute.
Built natively on Windows (no WSL); nothing in it is Windows-only, but Linux
is untested. Steps:

1. clone ONNX Runtime v1.29.0 (shallow) and its Emscripten submodule,
2. remove ORT's `SharedArrayBuffer` stand-in from `onnxruntime/wasm/pre.js`
   (it creates a shared memory for code a single-threaded build does not
   have; `build.py` refuses output that still mentions shared memory),
3. convert `public/model.onnx` with `onnxruntime.tools.convert_onnx_models_to_ort
   --optimization_style Fixed --enable_type_reduction`: the optimizations the
   stock runtime applies at load time are saved into the model (e.g. the
   Conv+Relu pairs become `com.microsoft.FusedConv`),
4. ORT's `tools/ci_build/build.py --build_wasm --enable_wasm_simd
   --minimal_build --include_ops_by_config <config>
   --enable_reduced_operator_type_support --disable_exceptions --disable_rtti
   --disable_ml_ops --disable_generation_ops --disable_types string float4
   float8 optional sparsetensor --config MinSizeRel`, with Emscripten's
   `ENVIRONMENT=web,worker` and `-ffile-prefix-map` (ORT's error messages
   carry source paths),
5. copy the results into the app and print their sizes.

The runtime comes out byte-identical on every run (and from a fresh clone);
`model.ort` does not: the converter lays the same graph out differently each
time, so expect a binary diff there whenever the script runs.

Rebuild when `public/model.onnx` changes (a new operator is missing from the
runtime otherwise: session creation fails and the worker falls back to the
stock runtime), and to move to another ONNX Runtime version (update
`ORT_VERSION`, `ORT_COMMIT` and `EMSDK_VERSION` in `build.py`, `onnxruntime`
in `requirements.txt`, and check `api.h` against `ortMinimal.js`).

## Choices, measured

2026-10-04, ONNX Runtime 1.29.0, Emscripten 4.0.23; inference = mean over
2,000 windows in a worker, desktop Chrome 154:

| build (all single-threaded SIMD unless noted) | `.wasm` | gzip | brotli | inference |
|---|---|---|---|---|
| stock onnxruntime-web 1.29 (threaded, every operator) | 13,961,845 | 3,570,014 | 2,296,916 | 2.8 ms |
| full build, model's operators only (MinSizeRel; also reads `.onnx`) | 4,279,458 | 1,431,366 | 1,013,315 | 2.9 ms |
| minimal build, Release (`-O3`) | 1,744,631 | 588,856 | 416,729 | 2.9 ms |
| **minimal build, MinSizeRel (`-Os`)**, shipped | 1,149,264 | 429,665 | 327,328 | 2.8 ms |

- Minimal over full: a third of the size; the price is the `.ort` model,
  which the build produces anyway.
- `-Os` costs nothing measurable: the time goes into MLAS's SIMD kernels and
  the STFT either way.
- What is left is ONNX Runtime's session machinery, not operators: of the
  ~1 MB of code, the 26 kernels are ~170 kB, libc++ ~170 kB, the session,
  graph and framework ~320 kB, the full C API table (it keeps all ~400 functions alive)
  ~70 kB, protobuf for `TensorProto` ~90 kB. Going further means patching
  ORT itself.
- Kept from ORT's defaults: contrib ops (the converter fuses Conv+Relu into
  `com.microsoft.FusedConv`, as the stock runtime does at load time),
  dlmalloc, a 5 MB stack, memory growth up to 4 GB. That memory is ordinary
  (not shared), as in the 1.18 build that works on iPadOS 16.
- No SIMD-less variant: every browser with SIMD (Safari 16.4+) also gets
  this runtime; older ones fall back to 1.18's plain build.

## Verifying

- `bun bench/ort-minimal/serve.mjs` and `bun bench/ort-minimal/run.mjs`
  (`PLAYWRIGHT_BROWSERS_PATH` for Firefox/WebKit): every 960-sample window
  of `../iris.mp3` through the stock runtime and the minimal one in Chrome,
  Firefox and WebKit, in a worker each; prints worker init time, inference
  times and the differences of the raw outputs. `VARIANTS=name=dir,...`
  compares other builds (each dir holding `ort-wasm-simd.{mjs,wasm}`).
- In the app, `?debug=1` shows the pitch provider in the mic line:
  `wasm-min` is this runtime (`webgpu` the opt-in GPU worker; older
  recordings also show `wasm` / `wasm-1.18`, the stock runtimes it replaced).
  Recordings carry the same value in `capture.pitch`.
