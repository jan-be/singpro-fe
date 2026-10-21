// PitchWorkerGpu.ts — swift-f0 on ONNX Runtime's WebGPU provider. Same message
// protocol as PitchWorkerMinimal.ts; opt-in (see pitchGpuFlag.ts), and MicrophoneInput
// falls back to the WASM worker when this one cannot start.
//
// It needs the GPU-resident model (public/model-gpu.onnx, derived from
// model.onnx by bench/ort-webgpu/make_gpu_model.py): the original's STFT and
// int64 ops would bounce to the CPU on every run, which made WebGPU five
// times slower than WASM. With everything on the GPU the inference itself
// takes ~1 ms; the rest of each run is the browser's GPU→CPU readback.
//
// The input is written into one persistent GPU buffer and both outputs are
// copied into one staging buffer, so a run costs one upload and one mapAsync.

import * as ort from 'onnxruntime-web/webgpu';
import { createVoicingTracker, WINDOW_SAMPLES } from './pitchModel';
import type { PitchWorkerRequest, PitchWorkerResponse } from './pitchModel';

// WebGPU's flag constants, which TypeScript's lib leaves out (it has the interfaces)
declare const GPUBufferUsage: { readonly MAP_READ: number, readonly COPY_SRC: number, readonly COPY_DST: number, readonly STORAGE: number };
declare const GPUMapMode: { readonly READ: number };

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

const FRAMES = 3; // model-gpu.onnx has a fixed 960-sample input → 3 frames

let session: ort.InferenceSession | null = null;
let io: { device: GPUDevice, input: GPUBuffer, staging: GPUBuffer } | null = null; // { device, input, staging }
const voicing = createVoicingTracker();

async function init(modelUrl: string) {
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('WebGPU is not available in this worker');
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['webgpu'],
    preferredOutputLocation: 'gpu-buffer',
  });
  // (ORT 1.29 sets the device itself here once a session exists; its types say a Promise of it)
  const device = ort.env.webgpu.device as unknown as GPUDevice | undefined;
  if (!device) throw new Error('ONNX Runtime has no WebGPU device');
  const input = device.createBuffer({
    size: WINDOW_SAMPLES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const staging = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  io = { device, input, staging };
  // The first run compiles the shaders (hundreds of ms): do it now, not on the first note
  await infer(new Float32Array(WINDOW_SAMPLES));
}

async function infer(audio: Float32Array<ArrayBuffer>) {
  const { device, input, staging } = io!;
  device.queue.writeBuffer(input, 0, audio);
  const out = await session!.run({
    input_audio: ort.Tensor.fromGpuBuffer(input, { dataType: 'float32', dims: [1, WINDOW_SAMPLES] }),
  });
  // both outputs (FRAMES floats each) in a single readback
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(out.pitch_hz.gpuBuffer, 0, staging, 0, FRAMES * 4);
  enc.copyBufferToBuffer(out.confidence.gpuBuffer, 0, staging, 16, FRAMES * 4);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const m = new Float32Array(staging.getMappedRange());
  const pitchHz = m.slice(0, FRAMES);
  const confidence = m.slice(4, 4 + FRAMES);
  staging.unmap();
  out.pitch_hz.dispose();
  out.confidence.dispose();
  return { pitchHz, confidence };
}

self.onmessage = async ({ data }: MessageEvent<PitchWorkerRequest>) => {
  const { type } = data;

  if (type === 'init') {
    try {
      await init(data.modelUrl);
      self.postMessage({ type: 'init', status: 'ok', provider: 'webgpu' } satisfies PitchWorkerResponse);
    } catch (err) {
      self.postMessage({ type: 'init', status: 'error', error: (err as Error).message } satisfies PitchWorkerResponse);
    }
    return;
  }

  if (type === 'detect' && session) {
    // One chunk at a time: MicrophoneInput waits for the answer (inferenceScheduler.ts)
    const t0 = performance.now();
    try {
      const { audio, volume, t } = data;
      if (audio.length !== WINDOW_SAMPLES) throw new Error(`expected ${WINDOW_SAMPLES} samples, got ${audio.length}`);
      const { pitchHz, confidence } = await infer(audio);
      self.postMessage({
        type: 'detect',
        pitchHz: voicing.pick(pitchHz, confidence, t ?? t0 / 1000),
        rawHz: pitchHz[FRAMES - 1], // the model's own last frame, for the level calibration
        rawConf: confidence[FRAMES - 1],
        firstHz: pitchHz[0], // its first frame: how the pitch moves within the window (singingGate.ts)
        volume,
        fric: data.fric, // the consonant flag of this chunk, passed through (fricative.ts)
        pos: data.pos,   // where the chunk ends in the captured audio, passed through
        ms: performance.now() - t0,
      } satisfies PitchWorkerResponse);
    } catch (err) {
      // On error, send zero pitch — don't break the pipeline
      self.postMessage({ type: 'detect', pitchHz: 0, volume: data.volume ?? 0, fric: data.fric, pos: data.pos, ms: performance.now() - t0, error: (err as Error).message } satisfies PitchWorkerResponse);
    }
  }
};
