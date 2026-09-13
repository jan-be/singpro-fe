// Same benchmark inside a dedicated worker — where PitchWorker.js actually runs.
const build = new URL(self.location.href).searchParams.get('build') || 'webgpu';
const BUNDLES = { plain: '/ort/ort.wasm.bundle.min.mjs', webgpu: '/ort/ort.webgpu.bundle.min.mjs', jspi: '/ort/ort.jspi.bundle.min.mjs' };

const init = (async () => {
  const ort = await import(BUNDLES[build]);
  const { makeInputs, createSession, runLoop, releaseSession } = await import('/bench.js');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.wasmPaths = '/ort/';
  return { ort, createSession, runLoop, releaseSession, inputs: makeInputs(48) };
})();

self.onmessage = async ({ data }) => {
  const hasGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  try {
    const { ort, createSession, runLoop, releaseSession, inputs } = await init;
    const { ep, opts, runs } = data;
    const c = await createSession(ort, ep, inputs[0], opts || {});
    const r = await runLoop(c, inputs, runs);
    await releaseSession(c);
    const { sample, ...stats } = r;
    self.postMessage({ ep, hasGpu, createMs: c.createMs, warmupMs: c.warmupMs, ...stats });
  } catch (e) {
    self.postMessage({ error: String((e && e.message) || e), hasGpu });
  }
};
