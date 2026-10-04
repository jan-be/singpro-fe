// ortMinimal.js — the slice of onnxruntime-web's API that pitchWorkerCore.js
// uses (InferenceSession.create(url), session.run({ name: Tensor }), float32
// only), on our own ONNX Runtime build in src/vendor/ort-minimal (see
// tools/ort-minimal/README.md): single-threaded, ordinary memory, only
// swift-f0's operators, a fraction of the stock runtime's download.
//
// Why not onnxruntime-web's JS on top of that build: since 1.19 it loads any
// runtime but its own threaded one through a dynamic import() of a URL, which
// Vite's classic workers cannot count on in every browser we serve, and that
// file would bypass the build target. Here the Emscripten module is bundled
// into the worker like any other import. The calls are the C functions
// onnxruntime/wasm/api.h exports, which belong to the ONNX Runtime version
// the build pins (tools/ort-minimal/build.py): update the two together.

import createRuntime from '../vendor/ort-minimal/ort-wasm-simd.mjs';
import wasmUrl from '../vendor/ort-minimal/ort-wasm-simd.wasm?url';

const FLOAT = 1;       // ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT
const DATA_ON_CPU = 1; // DATA_LOCATION_CPU in api.h
const LOG_WARNING = 2;
// The session options onnxruntime-web passes by default, so both runtimes
// behave the same: all graph optimizations (a minimal build runs the graph
// as the converter saved it anyway), no memory arena, no memory pattern,
// sequential execution.
const OPT_ALL = 99;

// The build needs WebAssembly SIMD (Safari 16.4+, Chrome 91+, Firefox 89+).
// Without it say so, instead of the compile error deep in the module.
// (onnxruntime-web's own test: a function that uses one SIMD instruction.)
const hasSimd = () => {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0,
      253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11]));
  } catch {
    return false;
  }
};

let runtime = null;
const getRuntime = () => runtime ??= (async () => {
  if (!hasSimd()) throw new Error('WebAssembly SIMD is not supported');
  const m = await createRuntime({ locateFile: () => wasmUrl });
  if (m._OrtInit(1, LOG_WARNING) !== 0) throw lastError(m, 'cannot initialize ONNX Runtime');
  return m;
})();

function lastError(m, what) {
  const sp = m.stackSave();
  try {
    const p = m.stackAlloc(8);
    m._OrtGetLastError(p, p + 4);
    const code = m.HEAP32[p >> 2], msg = m.HEAPU32[(p + 4) >> 2];
    return new Error(`${what}: ${msg ? m.UTF8ToString(msg) : `error ${code}`}`);
  } finally {
    m.stackRestore(sp);
  }
}

function allocString(m, s, allocs) {
  const n = m.lengthBytesUTF8(s) + 1;
  const p = m._malloc(n);
  allocs.push(p);
  m.stringToUTF8(s, p, n);
  return p;
}

export class Tensor {
  constructor(type, data, dims) {
    if (type !== 'float32') throw new Error(`ortMinimal: only float32 tensors, not ${type}`);
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

class Session {
  constructor(m, handle, inputs, outputs) {
    this.m = m;
    this.handle = handle;
    this.inputs = inputs;   // [{ name, ptr }]: the names live as long as the session
    this.outputs = outputs;
  }

  async run(feeds) {
    const { m } = this;
    const allocs = [], tensors = [];
    const sp = m.stackSave();
    try {
      const nIn = this.inputs.length, nOut = this.outputs.length;
      const inNames = m.stackAlloc(4 * nIn), inValues = m.stackAlloc(4 * nIn);
      const outNames = m.stackAlloc(4 * nOut), outValues = m.stackAlloc(4 * nOut);
      this.inputs.forEach(({ name, ptr }, i) => {
        const t = feeds[name];
        if (!t) throw new Error(`ortMinimal: input ${name} missing`);
        const bytes = new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength);
        const data = m._malloc(bytes.length);
        allocs.push(data);
        m.HEAPU8.set(bytes, data);
        const dims = m.stackAlloc(4 * t.dims.length);
        t.dims.forEach((d, k) => { m.HEAPU32[(dims >> 2) + k] = d; });
        const tensor = m._OrtCreateTensor(FLOAT, data, bytes.length, dims, t.dims.length, DATA_ON_CPU);
        if (!tensor) throw lastError(m, `cannot create the tensor for ${name}`);
        tensors.push(tensor);
        m.HEAPU32[(inNames >> 2) + i] = ptr;
        m.HEAPU32[(inValues >> 2) + i] = tensor;
      });
      this.outputs.forEach(({ ptr }, i) => {
        m.HEAPU32[(outNames >> 2) + i] = ptr;
        m.HEAPU32[(outValues >> 2) + i] = 0; // ORT allocates the outputs
      });
      if (m._OrtRun(this.handle, inNames, inValues, nIn, outNames, nOut, outValues, 0) !== 0) {
        // collect whatever outputs were made before the error, then report it
        this.outputs.forEach((_, i) => { const t = m.HEAPU32[(outValues >> 2) + i]; if (t) tensors.push(t); });
        throw lastError(m, 'run failed');
      }
      const results = {};
      const info = m.stackAlloc(16); // type, data, dims, dims length
      this.outputs.forEach(({ name }, i) => {
        const tensor = m.HEAPU32[(outValues >> 2) + i];
        tensors.push(tensor);
        if (m._OrtGetTensorData(tensor, info, info + 4, info + 8, info + 12) !== 0) throw lastError(m, `cannot read ${name}`);
        const [type, data, dimsPtr, nDims] = m.HEAPU32.subarray(info >> 2, (info >> 2) + 4);
        const dims = Array.from(m.HEAPU32.subarray(dimsPtr >> 2, (dimsPtr >> 2) + nDims));
        m._OrtFree(dimsPtr);
        if (type !== FLOAT) throw new Error(`ortMinimal: output ${name} is not float32`);
        const size = dims.reduce((a, b) => a * b, 1);
        results[name] = new Tensor('float32', new Float32Array(m.HEAPU8.buffer, data, size).slice(), dims);
      });
      return results;
    } finally {
      tensors.forEach((t) => m._OrtReleaseTensor(t));
      allocs.forEach((p) => m._free(p));
      m.stackRestore(sp);
    }
  }
}

export const InferenceSession = {
  /** @param {string | Uint8Array} model  URL of an ORT-format model, or its bytes */
  async create(model) {
    const m = await getRuntime();
    let bytes = model;
    if (typeof model === 'string') {
      const res = await fetch(model);
      if (!res.ok) throw new Error(`ortMinimal: ${model}: HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    const allocs = [];
    const opts = m._OrtCreateSessionOptions(OPT_ALL, false, false, 0, false, 0, 0, LOG_WARNING, 0, 0);
    if (!opts) throw lastError(m, 'cannot create session options');
    let handle = 0;
    const names = [];
    try {
      // As onnxruntime-web does: ORT reads the model from our copy while it
      // builds the session instead of copying it again.
      if (m._OrtAddSessionConfigEntry(opts, allocString(m, 'session.use_ort_model_bytes_directly', allocs), allocString(m, '1', allocs)) !== 0) {
        throw lastError(m, 'cannot set session options');
      }
      const data = m._malloc(bytes.length);
      allocs.push(data);
      m.HEAPU8.set(bytes, data);
      handle = m._OrtCreateSession(data, bytes.length, opts);
      if (!handle) throw lastError(m, 'cannot create the session');

      const sp = m.stackSave();
      try {
        const counts = m.stackAlloc(8);
        if (m._OrtGetInputOutputCount(handle, counts, counts + 4) !== 0) throw lastError(m, 'cannot count inputs and outputs');
        const [nIn, nOut] = m.HEAPU32.subarray(counts >> 2, (counts >> 2) + 2);
        const meta = m.stackAlloc(8); // name, type info
        for (let i = 0; i < nIn + nOut; i++) {
          if (m._OrtGetInputOutputMetadata(handle, i, meta, meta + 4) !== 0) throw lastError(m, 'cannot read the model\'s inputs and outputs');
          const [ptr, typeInfo] = m.HEAPU32.subarray(meta >> 2, (meta >> 2) + 2);
          if (typeInfo) m._OrtFree(typeInfo);
          names.push({ name: m.UTF8ToString(ptr), ptr });
        }
        return new Session(m, handle, names.slice(0, nIn), names.slice(nIn));
      } finally {
        m.stackRestore(sp);
      }
    } catch (e) {
      names.forEach(({ ptr }) => m._OrtFree(ptr));
      if (handle) m._OrtReleaseSession(handle);
      throw e;
    } finally {
      m._OrtReleaseSessionOptions(opts);
      allocs.forEach((p) => m._free(p));
    }
  },
};
