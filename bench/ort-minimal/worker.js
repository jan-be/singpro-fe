// One runtime in a dedicated worker, where the pitch worker runs: `stock` is
// what PitchWorker.js loads (onnxruntime-web/wasm: the threaded 1.29 build
// with its glue embedded, /model.onnx); a variant name is a custom build under
// /v/<name>/ driven by the app's own wrapper, src/logic/ortMinimal.js
// (/model.ort), as PitchWorkerMinimal.js runs it.
const rt = new URL(self.location.href).searchParams.get('rt') || 'stock';
const t0 = performance.now();

const ready = (async () => {
  let ort, model;
  if (rt === 'stock') {
    ort = await import('/ort/ort.wasm.bundle.min.mjs');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    model = '/model.onnx';
  } else {
    ort = await import(`/v/${rt}/ortMinimal.js`);
    model = '/model.ort';
  }
  const tImport = performance.now();
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  const tSession = performance.now();
  return { ort, session, importMs: tImport - t0, sessionMs: tSession - tImport };
})();

ready.then(
  ({ importMs, sessionMs }) => self.postMessage({ type: 'ready', importMs, sessionMs }),
  (e) => self.postMessage({ type: 'error', error: String(e?.message ?? e) }),
);

self.onmessage = async ({ data }) => {
  const { ort, session } = await ready;
  const { audio, win, hop, n } = data;
  let pitch = null, conf = null, frames = 0;
  const ms = new Float64Array(n);
  const tAll = performance.now();
  for (let i = 0; i < n; i++) {
    const x = audio.slice(i * hop, i * hop + win);
    const t = performance.now();
    const out = await session.run({ input_audio: new ort.Tensor('float32', x, [1, win]) });
    ms[i] = performance.now() - t;
    const p = out.pitch_hz.data, c = out.confidence.data;
    if (!pitch) { frames = p.length; pitch = new Float32Array(n * frames); conf = new Float32Array(n * frames); }
    pitch.set(p, i * frames);
    conf.set(c, i * frames);
  }
  const totalMs = performance.now() - tAll;
  self.postMessage({ type: 'done', frames, pitch, conf, ms, totalMs }, [pitch.buffer, conf.buffer, ms.buffer]);
};
