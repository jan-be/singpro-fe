// pitchWorkerCore.js — the message protocol of the WASM pitch worker
// (PitchWorkerMinimal.js, on our minimal ONNX Runtime build): `init` loads
// swift-f0, `detect` runs one 16 kHz chunk with its time on the chunk clock
// and returns the pitch the voicing tracker accepts (0 = none).
// MicrophoneInput sends one chunk at a time (inferenceScheduler.js), so there
// is never a queue here.

import { createVoicingTracker } from './pitchModel';

/**
 * Answer the worker's messages with an ONNX Runtime module.
 * @param {object} ort       an onnxruntime-web module, configured for WASM
 * @param {string} provider  reported on init, e.g. 'wasm'
 */
export function servePitchRequests(ort, provider) {
  let session = null;
  const voicing = createVoicingTracker();

  self.onmessage = async ({ data }) => {
    const { type } = data;

    if (type === 'init') {
      try {
        session = await ort.InferenceSession.create(data.modelUrl, { executionProviders: ['wasm'] });
        self.postMessage({ type: 'init', status: 'ok', provider });
      } catch (err) {
        self.postMessage({ type: 'init', status: 'error', error: err.message });
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
        // raw*: the model's own last frame, for the level calibration (levelCalibration.js)
        self.postMessage({ type: 'detect', pitchHz, rawHz: hz[hz.length - 1] ?? 0, rawConf: conf[conf.length - 1] ?? 0, volume, fric: data.fric, pos: data.pos, ms: performance.now() - t0 });
      } catch (err) {
        // On error, send zero pitch — don't break the pipeline
        self.postMessage({ type: 'detect', pitchHz: 0, volume: data.volume ?? 0, fric: data.fric, pos: data.pos, ms: performance.now() - t0, error: err.message });
      }
    }
  };
}
