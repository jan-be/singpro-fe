import { sampleSize, pitchHzToNote, createNoiseGate } from "./MicSharedFuns";
import pitchFinderWorkletUrl from "./PitchFinderWorklet.js?worker&url";
import PitchWorkerUrl from "./PitchWorker.js?worker";

const TARGET_SAMPLE_RATE = 16000; // swift-f0 model's native rate

export const initMicInput = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    },
  });

  // --- ONNX Worker setup ---
  const onnxWorker = new PitchWorkerUrl();

  // Wait for model to load
  await new Promise((resolve, reject) => {
    onnxWorker.onmessage = ({ data }) => {
      if (data.type === 'init') {
        if (data.status === 'ok') resolve();
        else reject(new Error(data.error));
      }
    };
    const modelUrl = new URL('/model.onnx', window.location.origin).href;
    onnxWorker.postMessage({ type: 'init', modelUrl });
  });

  // Callback that the consumer sets via setOnProcessing
  let processingCallback = null;

  // Handle ONNX worker results
  onnxWorker.onmessage = ({ data }) => {
    if (data.type === 'detect') {
      const note = pitchHzToNote(data.pitchHz, data.volume);
      if (processingCallback) {
        processingCallback({ data: { note, volume: data.volume } });
      }
    }
  };

  // --- Audio capture setup ---
  // Use the device's default sample rate so iOS/Android don't switch to the
  // telephony audio category. A 16kHz AudioContext triggers "call mode" on
  // mobile because the OS interprets it as a voice-call session.
  // The worklet downsamples from the native rate to 16kHz internally.
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
  // Do NOT connect workletNode to context.destination — that triggers
  // mobile call-mode audio routing. The worklet sends data via postMessage.

  // Worklet sends 16kHz audio chunks to ONNX worker
  const noiseGate = createNoiseGate();
  workletNode.port.onmessage = ({ data }) => {
    const { audio, volume } = data;

    if (noiseGate.shouldGate(volume)) {
      if (processingCallback) {
        processingCallback({ data: { note: 0, volume } });
      }
      return;
    }

    onnxWorker.postMessage(
      { type: 'detect', audio, volume },
      [audio.buffer]
    );
  };

  return {
    setOnProcessing: fn => { processingCallback = fn; },
    stopMicInput: () => {
      processingCallback = null;
      workletNode.port.onmessage = null;
      stream.getTracks().forEach(t => t.stop());
      source.disconnect();
      workletNode.disconnect();
      if (context.state !== 'closed') context.close();
      onnxWorker.terminate();
    },
  };
};
