// Shared benchmark logic for the page and the worker: swift-f0 on 960-sample
// (60 ms @ 16 kHz) windows, exactly what PitchWorker.js runs per chunk.
//
// Options per session: { model, graphCapture, gpuIO, sessionOptions }
//   gpuIO: true   input written into a persistent GPUBuffer, outputs left on the
//                 GPU and downloaded with ORT's own getData()
//   gpuIO: 'raw'  same input path; outputs copied into one persistent staging
//                 buffer and read with a single mapAsync (both outputs at once)

import type { InferenceSession } from 'onnxruntime-web';

/** The onnxruntime-web build the page or worker imported (/ort/…bundle.min.mjs) */
export type Ort = typeof import('onnxruntime-web');

/** Options per session */
export interface BenchOptions {
  model?: string;
  graphCapture?: boolean;
  gpuIO?: boolean | 'raw';
  sessionOptions?: InferenceSession.SessionOptions;
}

/** One window's outputs */
export interface BenchOutputs {
  pitch: Float32Array;
  conf: Float32Array;
}

/** How the inputs go in and the outputs come out (makeFeeder) */
export interface Feeder {
  feed(x: Float32Array): InferenceSession.FeedsType;
  read(out: InferenceSession.ReturnType): Promise<BenchOutputs>;
  dispose(): void;
}

/** A session ready to run (createSession) */
export interface BenchSession {
  session: InferenceSession;
  feeder: Feeder;
  createMs: number;
  warmupMs: number;
  first: { pitch: number[]; conf: number[] };
}

/** Times in ms (summarize) */
export interface Summary {
  n: number;
  mean: number;
  median: number;
  p90: number;
  p99: number;
  min: number;
  max: number;
}

/** runLoop's result: the whole run, session.run() alone, the readback, and the first windows' outputs */
export interface LoopResult extends Summary {
  run: Summary;
  read: Summary;
  sample: { pitch: number[]; conf: number[] }[];
}

/** runRealtime's result */
export interface RealtimeResult extends Summary {
  seconds: number;
  intervalMs: number;
  slots: number;
  ticks: number;
  completed: number;
  dropped: number;
}

const N = 960;

/** Synthetic "voice": fundamental + 2nd harmonic + a little noise, varying pitch. */
export function makeInputs(count: number): Float32Array[] {
  const inputs: Float32Array[] = [];
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

async function makeFeeder(ort: Ort, opts: BenchOptions): Promise<Feeder> {
  if (!opts.gpuIO) {
    return {
      feed: (x) => ({ input_audio: new ort.Tensor('float32', x, [1, N]) }),
      read: async (out) => ({ pitch: out.pitch_hz.data as Float32Array, conf: out.confidence.data as Float32Array }),
      dispose: () => {},
    };
  }
  // (once a webgpu session made it the property holds the device, by ORT's types a Promise of it: awaited, either is the device)
  const device: GPUDevice | undefined = await ort.env.webgpu.device;
  if (!device) throw new Error('ort.env.webgpu.device not set (create a webgpu session first)');
  const buf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const feed = (x: Float32Array) => {
    device.queue.writeBuffer(buf, 0, x);
    return { input_audio: ort.Tensor.fromGpuBuffer(buf, { dataType: 'float32', dims: [1, N] }) };
  };
  if (opts.gpuIO === 'raw') {
    const staging = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    return {
      feed,
      read: async (out) => {
        const enc = device.createCommandEncoder();
        enc.copyBufferToBuffer(out.pitch_hz.gpuBuffer, 0, staging, 0, 12);
        enc.copyBufferToBuffer(out.confidence.gpuBuffer, 0, staging, 16, 12);
        device.queue.submit([enc.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const m = new Float32Array(staging.getMappedRange());
        const pitch = m.slice(0, 3), conf = m.slice(4, 7);
        staging.unmap();
        out.pitch_hz.dispose();
        out.confidence.dispose();
        return { pitch, conf };
      },
      dispose: () => { buf.destroy(); staging.destroy(); },
    };
  }
  return {
    feed,
    read: async (out) => {
      const [pitch, conf] = await Promise.all([out.pitch_hz.getData(), out.confidence.getData()]) as Float32Array[];
      return { pitch, conf };
    },
    dispose: () => buf.destroy(),
  };
}

export async function createSession(ort: Ort, ep: string, warmupInput: Float32Array, opts: BenchOptions = {}): Promise<BenchSession> {
  const so: InferenceSession.SessionOptions = { executionProviders: [ep], ...(opts.sessionOptions || {}) };
  if (opts.graphCapture) so.enableGraphCapture = true;
  if (opts.gpuIO) so.preferredOutputLocation = 'gpu-buffer';
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(opts.model || '/model.onnx', so);
  const createMs = performance.now() - t0;
  const feeder = await makeFeeder(ort, opts);
  const t1 = performance.now();
  const out = await session.run(feeder.feed(warmupInput));
  const first = await feeder.read(out);
  const warmupMs = performance.now() - t1;
  // graph capture captures on the first run and replays from the second: warm that too
  if (opts.graphCapture) { const o2 = await session.run(feeder.feed(warmupInput)); await feeder.read(o2); }
  return { session, feeder, createMs, warmupMs, first: { pitch: Array.from(first.pitch), conf: Array.from(first.conf) } };
}

function summarize(times: ArrayLike<number>): Summary {
  const sorted = Array.from(times).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { n: sorted.length, mean, median: q(0.5), p90: q(0.9), p99: q(0.99), min: sorted[0], max: sorted[sorted.length - 1] };
}

/** Back-to-back inferences (latency per run, including input upload and output download). */
export async function runLoop({ session, feeder }: Pick<BenchSession, 'session' | 'feeder'>, inputs: Float32Array[], runs: number): Promise<LoopResult> {
  const times = new Float64Array(runs);
  const runTimes = new Float64Array(runs);   // session.run() alone (dispatch, until the output tensors exist)
  const readTimes = new Float64Array(runs);  // output download
  const sample: LoopResult['sample'] = [];
  for (let i = 0; i < runs; i++) {
    const x = inputs[i % inputs.length];
    const t0 = performance.now();
    const out = await session.run(feeder.feed(x));
    const t1 = performance.now();
    const r = await feeder.read(out);
    const t2 = performance.now();
    times[i] = t2 - t0; runTimes[i] = t1 - t0; readTimes[i] = t2 - t1;
    if (i < inputs.length) sample.push({ pitch: Array.from(r.pitch), conf: Array.from(r.conf) });
  }
  return { ...summarize(times), run: summarize(runTimes), read: summarize(readTimes), sample };
}

/**
 * The real-time pattern of PitchWorker: a chunk every 15 ms (~67/s). With one
 * session a chunk is dropped when the previous inference is still in flight;
 * with several sessions (slots) they alternate, so up to `slots.length`
 * inferences overlap and a chunk is dropped only when every slot is busy.
 */
export function runRealtime(slots: BenchSession | BenchSession[], inputs: Float32Array[], seconds: number, intervalMs = 15): Promise<RealtimeResult> {
  if (!Array.isArray(slots)) slots = [slots];
  const busy = slots.map(() => false);
  return new Promise((resolve) => {
    let completed = 0, dropped = 0, ticks = 0, i = 0;
    const times: number[] = [];
    const timer = setInterval(async () => {
      ticks++;
      const s = busy.indexOf(false);
      if (s < 0) { dropped++; return; }
      busy[s] = true;
      const x = inputs[i++ % inputs.length];
      const t0 = performance.now();
      try {
        const out = await slots[s].session.run(slots[s].feeder.feed(x));
        await slots[s].feeder.read(out);
        times.push(performance.now() - t0);
        completed++;
      } finally { busy[s] = false; }
    }, intervalMs);
    setTimeout(() => {
      clearInterval(timer);
      setTimeout(() => resolve({ seconds, intervalMs, slots: slots.length, ticks, completed, dropped, ...summarize(times) }), 200);
    }, seconds * 1000);
  });
}

/** The floor for any GPU result: upload 24 bytes, copy, one mapAsync — no inference at all. */
export async function readbackFloor(ort: Ort, runs: number): Promise<Summary> {
  const device: GPUDevice = await ort.env.webgpu.device; // (see makeFeeder)
  const src = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(64);
  const times = new Float64Array(runs);
  for (let i = 0; i < runs; i++) {
    data[0] = i;
    const t0 = performance.now();
    device.queue.writeBuffer(src, 0, data);
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, staging, 0, 256);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const v = new Float32Array(staging.getMappedRange())[0];
    staging.unmap();
    times[i] = performance.now() - t0;
    if (v !== i) throw new Error('readback mismatch');
  }
  src.destroy(); staging.destroy();
  return summarize(times);
}

export async function releaseSession({ session, feeder }: Pick<BenchSession, 'session' | 'feeder'>) {
  feeder.dispose();
  await session.release();
}
