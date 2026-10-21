// pitchWorkerCore.js — the message protocol of the WASM pitch worker
// (PitchWorkerMinimal.js, on our minimal ONNX Runtime build): `init` loads
// swift-f0, `detect` runs one 16 kHz chunk with its time on the chunk clock
// and returns the pitch the voicing tracker accepts (0 = none).
// MicrophoneInput sends one chunk at a time (inferenceScheduler.js), so there
// is never a queue here.

import { createVoicingTracker } from './pitchModel';
import type { PitchFrames, PitchWorkerRequest, PitchWorkerResponse } from './pitchModel';

/** A loaded model as servePitchRequests runs it: tensors (T) in, outputs by name out (swift-f0: pitch_hz, confidence) */
export interface PitchSession<T> {
  run(feeds: Record<string, T>): Promise<Record<string, { data: PitchFrames }>>;
}

/** The part of an ONNX Runtime module servePitchRequests uses (ortMinimal.js, or onnxruntime-web's API) */
export interface PitchRuntime<T> {
  InferenceSession: {
    create(model: string, options: { executionProviders: string[] }): Promise<PitchSession<T>>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => T;
}

/**
 * Answer the worker's messages with an ONNX Runtime module.
 * @param ort       an onnxruntime-web module, configured for WASM
 * @param provider  reported on init, e.g. 'wasm'
 */
export function servePitchRequests<T>(ort: PitchRuntime<T>, provider: string): void {
  let session: PitchSession<T> | null = null;
  const voicing = createVoicingTracker();

  self.onmessage = async ({ data }: MessageEvent<PitchWorkerRequest>) => {
    const { type } = data;

    if (type === 'init') {
      try {
        session = await ort.InferenceSession.create(data.modelUrl, { executionProviders: ['wasm'] });
        self.postMessage({ type: 'init', status: 'ok', provider } satisfies PitchWorkerResponse);
      } catch (err) {
        self.postMessage({ type: 'init', status: 'error', error: (err as Error).message } satisfies PitchWorkerResponse);
      }
      return;
    }

    if (type === 'detect' && session) {
      const t0 = performance.now();
      try {
        const { audio, volume, t } = data; // audio: Float32Array (16kHz), volume: number, t: chunk clock (s)
        const inputTensor = new ort.Tensor('float32', audio, [1, audio.length]);
        const results = await session.run({ input_audio: inputTensor });
        const hz = results.pitch_hz.data, conf = results.confidence.data;
        const pitchHz = voicing.pick(hz, conf, t ?? t0 / 1000);
        // raw*: the model's own last frame, for the level calibration (levelCalibration.js);
        // firstHz: its first, for how the pitch moves within the window (singingGate.js)
        self.postMessage({ type: 'detect', pitchHz, rawHz: hz[hz.length - 1] ?? 0, rawConf: conf[conf.length - 1] ?? 0, firstHz: hz[0] ?? 0, volume, fric: data.fric, pos: data.pos, ms: performance.now() - t0 } satisfies PitchWorkerResponse);
      } catch (err) {
        // On error, send zero pitch — don't break the pipeline
        self.postMessage({ type: 'detect', pitchHz: 0, volume: data.volume ?? 0, fric: data.fric, pos: data.pos, ms: performance.now() - t0, error: (err as Error).message } satisfies PitchWorkerResponse);
      }
    }
  };
}
