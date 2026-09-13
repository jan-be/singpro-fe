// Shared benchmark logic for the page and the worker: swift-f0 on 960-sample
// (60 ms @ 16 kHz) windows, exactly what PitchWorker.js runs per chunk.

const N = 960;

/** Synthetic "voice": fundamental + 2nd harmonic + a little noise, varying pitch. */
export function makeInputs(count) {
  const inputs = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 0; i < count; i++) {
    const f = 110 * Math.pow(2, (i % 36) / 12);
    const a = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const t = k / 16000;
      a[k] = 0.3 * Math.sin(2 * Math.PI * f * t) + 0.1 * Math.sin(2 * Math.PI * 2 * f * t) + 0.02 * rnd();
    }
    inputs.push(a);
  }
  return inputs;
}

export async function createSession(ort, ep, warmupInput, options = {}) {
  const t0 = performance.now();
  const session = await ort.InferenceSession.create('/model.onnx', { executionProviders: [ep], ...options });
  const createMs = performance.now() - t0;
  const t1 = performance.now();
  const out = await session.run({ input_audio: new ort.Tensor('float32', warmupInput, [1, N]) });
  const warmupMs = performance.now() - t1;
  return { session, createMs, warmupMs, first: { pitch: Array.from(out.pitch_hz.data), conf: Array.from(out.confidence.data) } };
}

function summarize(times) {
  const sorted = Array.from(times).sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { n: sorted.length, mean, median: q(0.5), p90: q(0.9), p99: q(0.99), min: sorted[0], max: sorted[sorted.length - 1] };
}

/** Back-to-back inferences (latency per run). */
export async function runLoop(session, ort, inputs, runs) {
  const times = new Float64Array(runs);
  const sample = [];
  for (let i = 0; i < runs; i++) {
    const x = inputs[i % inputs.length];
    const tensor = new ort.Tensor('float32', x, [1, N]);
    const t0 = performance.now();
    const out = await session.run({ input_audio: tensor });
    times[i] = performance.now() - t0;
    if (i < inputs.length) sample.push({ pitch: Array.from(out.pitch_hz.data), conf: Array.from(out.confidence.data) });
  }
  return { ...summarize(times), sample };
}

/**
 * The real-time pattern of PitchWorker: a chunk every 15 ms (~67/s), and a
 * chunk is dropped when the previous inference is still in flight.
 */
export function runRealtime(session, ort, inputs, seconds, intervalMs = 15) {
  return new Promise((resolve) => {
    let inFlight = false, completed = 0, dropped = 0, ticks = 0, i = 0;
    const times = [];
    const timer = setInterval(async () => {
      ticks++;
      if (inFlight) { dropped++; return; }
      inFlight = true;
      const x = inputs[i++ % inputs.length];
      const t0 = performance.now();
      await session.run({ input_audio: new ort.Tensor('float32', x, [1, N]) });
      times.push(performance.now() - t0);
      completed++;
      inFlight = false;
    }, intervalMs);
    setTimeout(() => {
      clearInterval(timer);
      // let a last in-flight run finish
      setTimeout(() => resolve({ seconds, intervalMs, ticks, completed, dropped, ...summarize(times) }), 200);
    }, seconds * 1000);
  });
}
