// Same benchmark inside a dedicated worker — where PitchWorker.js actually runs.
const build = new URL(self.location.href).searchParams.get('build') || 'webgpu';

const init = (async () => {
  const ort = await import(build === 'plain' ? '/ort/ort.wasm.bundle.min.mjs' : '/ort/ort.webgpu.bundle.min.mjs');
  const { makeInputs, createSession, runLoop } = await import('/bench.js');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.wasmPaths = '/ort/';
  return { ort, makeInputs, createSession, runLoop, inputs: makeInputs(48) };
})();

self.onmessage = async ({ data }) => {
  const hasGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  try {
    const { ort, createSession, runLoop, inputs } = await init;
    const { ep, runs } = data;
    const c = await createSession(ort, ep, inputs[0], {});
    const r = await runLoop(c.session, ort, inputs, runs);
    await c.session.release();
    const { sample, ...stats } = r;
    self.postMessage({ ep, hasGpu, createMs: c.createMs, warmupMs: c.warmupMs, ...stats });
  } catch (e) {
    self.postMessage({ error: String((e && e.message) || e), hasGpu });
  }
};
