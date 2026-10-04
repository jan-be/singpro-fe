import { createNoiseGate } from "./MicSharedFuns";
import pitchFinderWorkletUrl from "./PitchFinderWorklet.js?worker&url";
import PitchWorkerMinimalUrl from "./PitchWorkerMinimal.js?worker";
import PitchWorkerUrl from "./PitchWorker.js?worker";
import PitchWorkerCompatUrl from "./PitchWorkerCompat.js?worker";
import PitchWorkerGpuUrl from "./PitchWorkerGpu.js?worker";
import MicCaptureWorker from "./MicCaptureWorker.js?worker";
import { startWasmPitchWorker } from "./pitchWorkerChoice";
import { UserAudioRecorder } from "./AudioRecorder";
import { WINDOW_SAMPLES, HOP_SAMPLES } from "./pitchModel";
import { createInferenceScheduler } from "./inferenceScheduler";
import { createLevelCalibration } from "./levelCalibration";
import { createMicCapture } from "./micChunker";

const TARGET_SAMPLE_RATE = 16000; // swift-f0 model's native rate
const HOP_SECONDS = HOP_SAMPLES / TARGET_SAMPLE_RATE;
// The chunk clock jumps this far on a resume, so nothing from before a pause
// counts as "just now" for the voicing tracker (see createVoicingTracker)
const PAUSE_CLOCK_JUMP_S = 10;
const IDLE_LEVELS_PER_SEC = 10;   // input level updates while the song is paused

/**
 * On iOS/Android, opening a mic MediaStream and connecting it to an AudioContext
 * causes the OS to switch to the "communication" audio category (call mode).
 * This routes audio to the earpiece, reduces volume, and degrades all audio
 * output quality — including the YouTube player running in another element.
 *
 * Workaround: use MediaStreamTrackProcessor (where available) to read mic
 * samples WITHOUT an AudioContext. The raw PCM frames are sent to a Worker
 * for pitch detection. No AudioContext = no call mode switch.
 *
 * Fallback (desktop / older browsers): use AudioContext + AudioWorklet as before.
 *
 * Both capture paths have an idle mode for a paused song (setActive(false)):
 * no resampling, no chunks and therefore no pitch inference, only a coarse
 * input level a few times a second for the microphone panel's meter.
 */

// Feature-detect MediaStreamTrackProcessor (Chrome 94+, Edge 94+, not Safari yet)
const hasTrackProcessor = typeof globalThis.MediaStreamTrackProcessor === 'function';

/**
 * Read the track processor's frames on the main thread, a microtask chain, into
 * `capture` (createMicCapture). Returns a function that stops reading.
 */
function readOnMainThread(readable, capture) {
  const reader = readable.getReader();
  let running = true;
  (async () => {
    while (running) {
      const { value: frame, done } = await reader.read();
      if (done || !running) { frame?.close(); break; }

      // Extract float32 samples from the AudioData frame
      const channelData = new Float32Array(frame.numberOfFrames);
      frame.copyTo(channelData, { planeIndex: 0 });
      frame.close();
      capture.push(channelData, channelData.length);
    }
  })();
  return () => {
    running = false;
    reader.cancel().catch(() => {});
  };
}

async function initViaTrackProcessor(stream) {
  const track = stream.getAudioTracks()[0];
  const nativeSampleRate = track.getSettings().sampleRate || 48000;
  // We accumulate and downsample in JS since we don't have a worklet (the
  // same chunks as PitchFinderWorklet.js, see micChunker.js)
  const options = {
    nativeRate: nativeSampleRate,
    targetRate: TARGET_SAMPLE_RATE,
    windowSamples: WINDOW_SAMPLES,
    hopSamples: HOP_SAMPLES,
    levelsPerSec: IDLE_LEVELS_PER_SEC,
  };

  let onChunk = null; // callback: ({audio, volume, fric, pos}) => void
  let active = true;
  let stopped = false;

  // Read in a worker where the stream can be transferred there
  // (MicCaptureWorker.js): the ~100 frames a second then never touch the main
  // thread, only the ~33 chunks do. `gen` counts setActive calls; the worker
  // tags what it sends with the latest it has seen, and anything older is
  // dropped, so no chunk arrives after a pause (as with the main-thread loop).
  let worker = null;
  let gen = 0;
  let heard = false; // the worker has sent something

  // ...else on the main thread
  let mainCapture = null;
  let stopReading = null;
  const readHere = (readable) => {
    mainCapture = createMicCapture({
      ...options,
      onChunk: chunk => { if (onChunk) onChunk(chunk); },
      onLevel: volume => { if (onChunk) onChunk({ volume }); },
    });
    mainCapture.setActive(active);
    stopReading = readOnMainThread(readable, mainCapture);
  };
  // A worker that cannot read at all hands over before it sent anything
  const takeOver = () => {
    worker?.terminate();
    worker = null;
    if (!stopped && !heard) readHere(new MediaStreamTrackProcessor({ track }).readable);
  };

  const processor = new MediaStreamTrackProcessor({ track });
  try {
    worker = new MicCaptureWorker();
    worker.onmessage = ({ data }) => {
      if (data.type === 'failed') { takeOver(); return; }
      heard = true;
      if (data.gen === gen && onChunk) onChunk(data);
    };
    worker.onerror = takeOver;
    worker.postMessage({ type: 'start', readable: processor.readable, options }, [processor.readable]);
  } catch {
    // no transferable streams: the stream is still ours
    worker?.terminate();
    worker = null;
    readHere(processor.readable);
  }

  return {
    kind: 'trackProcessor',
    nativeSampleRate,
    setOnChunk: fn => { onChunk = fn; },
    setActive: (value) => {
      if (value === active) return;
      active = value;
      if (worker) worker.postMessage({ type: 'active', active: value, gen: ++gen });
      else mainCapture?.setActive(value);
    },
    stop: () => {
      stopped = true;
      worker?.terminate();
      worker = null;
      stopReading?.();
      track.stop();
    },
  };
}

async function initViaAudioWorklet(stream) {
  // Desktop fallback — AudioContext won't cause call-mode issues on desktop
  const context = new AudioContext({ latencyHint: 'interactive' });
  if (context.state === 'suspended') await context.resume();
  const source = context.createMediaStreamSource(stream);

  await context.audioWorklet.addModule(pitchFinderWorkletUrl);
  const workletNode = new AudioWorkletNode(context, 'pitch-finder-worklet', {
    processorOptions: {
      nativeSampleRate: context.sampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
    },
  });

  source.connect(workletNode);
  // Do NOT connect to destination — worklet sends data via postMessage

  let onChunk = null;
  workletNode.port.onmessage = ({ data }) => {
    if (onChunk) onChunk(data);
  };

  return {
    kind: 'worklet',
    nativeSampleRate: context.sampleRate,
    setOnChunk: fn => { onChunk = fn; },
    setActive: active => workletNode.port.postMessage({ type: 'active', active }),
    stop: () => {
      workletNode.port.onmessage = null;
      stream.getTracks().forEach(t => t.stop());
      source.disconnect();
      workletNode.disconnect();
      if (context.state !== 'closed') context.close();
    },
  };
}

/** Start a pitch worker and wait for its model to load. Resolves { worker, provider }. */
const startPitchWorker = (WorkerCtor, modelPath) => new Promise((resolve, reject) => {
  const worker = new WorkerCtor();
  worker.onmessage = ({ data }) => {
    if (data.type !== 'init') return;
    if (data.status === 'ok') resolve({ worker, provider: data.provider || 'wasm' });
    else { worker.terminate(); reject(new Error(data.error)); }
  };
  worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'pitch worker failed to load')); };
  worker.postMessage({ type: 'init', modelUrl: new URL(modelPath, window.location.origin).href });
});

/**
 * Why joining failed, for the mic panel: 'denied' (the browser or the user
 * refused access), 'noDevice' (none, or the remembered one is gone) or 'failed'.
 */
export const micErrorKind = (e) => {
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError': case 'PermissionDeniedError': return 'denied';
    case 'NotFoundError': case 'OverconstrainedError': case 'DevicesNotFoundError': return 'noDevice';
    default: return 'failed';
  }
};

/**
 * @param {{ deviceId?: string, gpu?: boolean, onPhase?: (phase: 'starting' | 'loading') => void }} [options]
 *   deviceId: a specific input device (from enumerateDevices), default otherwise
 *   gpu: try the WebGPU pitch worker first (opt-in, see pitchGpuFlag.js); WASM if it cannot start
 *   onPhase: 'starting' while the browser opens the microphone (and may ask
 *     for permission), 'loading' while the pitch detector loads, which the
 *     first time means downloading ~1 MB (runtime and model, compressed)
 */
export const initMicInput = async ({ deviceId, gpu = false, onPhase } = {}) => {
  onPhase?.('starting');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });

  // --- ONNX Worker setup ---
  onPhase?.('loading');
  let onnxWorker = null;
  let provider = 'wasm';
  if (gpu) {
    try {
      ({ worker: onnxWorker, provider } = await startPitchWorker(PitchWorkerGpuUrl, '/model-gpu.onnx'));
    } catch (e) {
      console.warn('[pitch] WebGPU worker unavailable, using WASM:', e.message);
    }
  }
  if (!onnxWorker) {
    try {
      // Our minimal ONNX Runtime; the stock 1.29, or 1.18 where that cannot
      // start (Safari before iOS 18), only if the minimal one fails
      ({ worker: onnxWorker, provider } = await startWasmPitchWorker({
        startMinimal: () => startPitchWorker(PitchWorkerMinimalUrl, '/model.ort'),
        startMain: () => startPitchWorker(PitchWorkerUrl, '/model.onnx'),
        startCompat: () => startPitchWorker(PitchWorkerCompatUrl, '/model.onnx'),
      }));
    } catch (e) {
      stream.getTracks().forEach(t => t.stop()); // no detector: let go of the microphone
      throw e;
    }
  }

  // Callback that the consumer sets via setOnProcessing
  let processingCallback = null;
  // ...and via setOnAudio: every hop of 16 kHz audio with its capture position
  let audioCallback = null;

  // --- Debug stats ---
  const stats = {
    provider,          // 'wasm-min' | 'wasm' | 'wasm-1.18' | 'webgpu'
    active: true,      // false while the song is paused (pipeline idle)
    totalChunks: 0,
    chunksPerSec: 0,
    totalNotes: 0,     // non-zero frequencies detected
    notesPerSec: 0,
    gatedChunks: 0,
    droppedChunks: 0,  // skipped because the worker was still busy (a slow device)
    inputGain: 1,      // the level calibration's boost of the model's input
    lastFreq: 0,
    lastVolume: 0,
    inferMs: 0,        // mean inference time over the last second
    inferMsMax: 0,     // slowest inference in the last second
    inferErrors: 0,
    _secChunks: 0,
    _secNotes: 0,
    _secInferSum: 0,
    _secInferN: 0,
    _secInferMax: 0,
  };
  const statsInterval = setInterval(() => {
    stats.chunksPerSec = stats._secChunks;
    stats.notesPerSec = stats._secNotes;
    stats.inferMs = stats._secInferN ? stats._secInferSum / stats._secInferN : 0;
    stats.inferMsMax = stats._secInferMax;
    stats._secChunks = 0;
    stats._secNotes = 0;
    stats._secInferSum = 0;
    stats._secInferN = 0;
    stats._secInferMax = 0;
  }, 1000);

  // One inference at a time, the newest window next: a device slower than
  // real time skips windows instead of falling ever further behind
  const scheduler = createInferenceScheduler(({ audio, volume, t, fric, pos }) => {
    onnxWorker.postMessage({ type: 'detect', audio, volume, t, fric, pos }, [audio.buffer]);
  });

  // A quiet mic's voice is boosted toward a common level before the model
  // (the gate and the level shown stay on the raw input)
  const calibration = createLevelCalibration({ stepSeconds: HOP_SECONDS });

  // Handle ONNX worker results
  onnxWorker.onmessage = ({ data }) => {
    if (data.type === 'detect') {
      scheduler.done();
      stats.droppedChunks = scheduler.dropped;
      calibration.update({ volume: data.volume, pitchHz: data.rawHz, confidence: data.rawConf });
      stats.inputGain = calibration.gain();
      const freq = data.pitchHz; // raw Hz (0 = no pitch detected)
      stats.lastFreq = freq;
      if (freq > 0) {
        stats.totalNotes++;
        stats._secNotes++;
      }
      if (data.ms != null) {
        stats._secInferSum += data.ms;
        stats._secInferN++;
        if (data.ms > stats._secInferMax) stats._secInferMax = data.ms;
      }
      if (data.error) stats.inferErrors++;
      if (processingCallback) {
        processingCallback({ data: { freq, volume: data.volume, fric: data.fric ? 1 : 0, pos: data.pos } });
      }
    }
  };

  // --- Audio capture ---
  // Use MediaStreamTrackProcessor on mobile to avoid AudioContext call-mode.
  // Fall back to AudioWorklet on desktop / older browsers.
  const capture = hasTrackProcessor
    ? await initViaTrackProcessor(stream)
    : await initViaAudioWorklet(stream);

  // Where the capture is in its audio (seconds taken in while active), for
  // the recording to place each pitch in what it recorded: the newest
  // chunk's end, plus the time since it arrived while running
  let lastPos = 0, lastPosAt = null, captureActive = true;
  const capturePosition = () =>
    lastPosAt === null || !captureActive ? lastPos : lastPos + (performance.now() - lastPosAt) / 1000;

  const track = stream.getAudioTracks()[0];
  const recorder = new UserAudioRecorder(stream, {
    position: capturePosition,
    capture: {
      path: capture.kind,                          // how the samples are read (MicrophoneInput.js)
      pitch: provider,                             // which pitch worker ran: 'wasm-min' | 'wasm' | 'wasm-1.18' | 'webgpu'
      sampleRate: capture.nativeSampleRate,
      inputLatency: track?.getSettings?.().latency ?? null, // the browser's own estimate, where it gives one
      windowSeconds: WINDOW_SAMPLES / TARGET_SAMPLE_RATE,
      hopSeconds: HOP_SECONDS,
    },
  });

  const noiseGate = createNoiseGate({ stepSeconds: HOP_SECONDS });
  // Audio time of each chunk, advancing one hop per chunk (gated ones too):
  // the voicing tracker's clock. Chunks can arrive in bursts, so wall-clock
  // time would not do.
  let chunkClock = 0;
  // fric: the chunk's newest 30 ms held a hissed consonant (fricative.js). It
  // rides along with the pitch; a gated chunk keeps it too, since a quiet "s"
  // is mostly above what the 16 kHz level measures.
  capture.setOnChunk(({ audio, volume, fric = 0, pos }) => {
    stats.lastVolume = volume;
    if (!audio) return; // song paused: only the level for the mic panel's meter
    if (pos !== undefined) { lastPos = pos; lastPosAt = performance.now(); }
    // The newest hop, quiet ones included (they are mostly the speakers): for
    // measuring how late the music reaches this mic (bleedController.js)
    if (audioCallback && pos !== undefined) audioCallback(audio.slice(audio.length - HOP_SAMPLES), pos);

    stats.totalChunks++;
    stats._secChunks++;
    stats.noiseFloor = noiseGate.getNoiseFloor();
    chunkClock += HOP_SECONDS;

    if (noiseGate.shouldGate(volume)) {
      stats.gatedChunks++;
      if (processingCallback) {
        processingCallback({ data: { freq: 0, volume, fric, pos } });
      }
      return;
    }

    const gain = calibration.gain();
    if (gain !== 1) for (let i = 0; i < audio.length; i++) audio[i] *= gain;
    scheduler.submit({ audio, volume, t: chunkClock, fric, pos });
  });

  // Song playing → full pipeline; song paused → capture idles (level only),
  // no inference, and the recording pauses with it.
  let active = true;
  const setActive = (value) => {
    const next = !!value;
    if (next === active) return;
    active = next;
    stats.active = next;
    if (next) chunkClock += PAUSE_CLOCK_JUMP_S;
    else scheduler.clear();
    // the capture position stands still while paused, like the recording
    lastPos = capturePosition();
    lastPosAt = null;
    captureActive = next;
    capture.setActive(next);
    recorder.setPaused(!next);
  };

  return {
    setOnProcessing: fn => { processingCallback = fn; },
    setOnAudio: fn => { audioCallback = fn; },
    setActive,
    stats,
    recorder,
    stopMicInput: () => {
      processingCallback = null;
      audioCallback = null;
      clearInterval(statsInterval);
      capture.stop();
      onnxWorker.terminate();
      recorder.stopAndUpload();
    },
  };
};
