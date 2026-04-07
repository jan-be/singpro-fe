import { sampleRate, sampleSize, pitchHzToNote, createNoiseGate } from "./MicSharedFuns";
import pitchFinderWorkletUrl from "./PitchFinderWorklet.js?worker&url";
import PitchWorkerUrl from "./PitchWorker.js?worker";

export const initMicInput = async () => {
  // Disable telephony audio processing to prevent mobile devices from switching
  // to the earpiece/call audio route when the microphone is activated.
  // With these constraints, the OS keeps using the speaker/media route.
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
    // Model URL: served from public/ by Vite
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
        // Match the interface expected by PartyPage: msg.data.note
        processingCallback({ data: { note, volume: data.volume } });
      }
    }
  };

  // --- Audio capture setup ---
  const hasWorklet = typeof AudioWorkletNode !== 'undefined';

  if (hasWorklet) {
    // AudioContext at 16kHz — matches swift-f0's native rate, no resampling needed
    const context = new AudioContext({ latencyHint: 'interactive', sampleRate });
    if (context.state === 'suspended') await context.resume();
    const source = context.createMediaStreamSource(stream);

    await context.audioWorklet.addModule(pitchFinderWorkletUrl);
    const workletNode = new AudioWorkletNode(context, 'pitch-finder-worklet');

    source.connect(workletNode);
    // Connect worklet to a silent gain node (not destination) to keep the
    // audio graph alive without outputting sound. Connecting directly to
    // context.destination causes mobile browsers to switch to the telephony
    // audio route (earpiece + call mode).
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    workletNode.connect(silentOutput);
    silentOutput.connect(context.destination);

    // Worklet sends 16kHz audio chunks directly to ONNX worker
    const noiseGate = createNoiseGate();
    workletNode.port.onmessage = ({ data }) => {
      const { audio, volume } = data;

      // Adaptive noise gate — skips frames below dynamic threshold
      if (noiseGate.shouldGate(volume)) {
        if (processingCallback) {
          processingCallback({ data: { note: 0, volume } });
        }
        return;
      }

      // Send directly to ONNX worker — already at 16kHz (transfer buffer for zero-copy)
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
        stopMicInput(stream, source, workletNode, context);
        onnxWorker.terminate();
      },
    };
  } else {
    // Fallback: ScriptProcessorNode (deprecated but works everywhere)
    // The ScriptProcessor path uses the Resampler to downsample from the
    // browser's native rate to 16kHz, then accumulates into sampleSize chunks.
    const { default: Resampler } = await import("audio-resampler");

    const context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(256, 1, 1);
    source.connect(processor);
    // Route through silent gain node to avoid triggering call audio on mobile
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    processor.connect(silentOutput);
    silentOutput.connect(context.destination);

    let audioBuffer = new Float32Array(sampleSize);
    let bufferPosition = 0;
    const noiseGateFallback = createNoiseGate();

    processor.onaudioprocess = (e) => {
      Resampler(e.inputBuffer, sampleRate, ev => {
        const resampled = ev.getAudioBuffer().getChannelData(0);
        const chunkLen = resampled.length;

        if (bufferPosition + chunkLen >= sampleSize) {
          const firstPart = sampleSize - bufferPosition;
          audioBuffer.set(resampled.subarray(0, firstPart), bufferPosition);

          // Compute volume
          let sumSq = 0;
          for (let i = 0; i < sampleSize; i++) sumSq += audioBuffer[i] * audioBuffer[i];
          const volume = Math.sqrt(sumSq / sampleSize);

          if (!noiseGateFallback.shouldGate(volume)) {
            // Already at 16kHz — send directly to ONNX
            const forOnnx = new Float32Array(audioBuffer);
            onnxWorker.postMessage({ type: 'detect', audio: forOnnx, volume }, [forOnnx.buffer]);
          } else if (processingCallback) {
            processingCallback({ data: { note: 0, volume } });
          }

          const remainder = chunkLen - firstPart;
          if (remainder > 0) {
            audioBuffer.set(resampled.subarray(firstPart), 0);
          }
          bufferPosition = remainder;
        } else {
          audioBuffer.set(resampled, bufferPosition);
          bufferPosition += chunkLen;
        }
      });
    };

    return {
      setOnProcessing: fn => { processingCallback = fn; },
      stopMicInput: () => {
        processingCallback = null;
        processor.onaudioprocess = null;
        stopMicInput(stream, source, processor, context);
        onnxWorker.terminate();
      },
    };
  }
};

const stopMicInput = (stream, source, processor, context) => {
  stream.getTracks().forEach(e => e.stop());
  source.disconnect();
  processor.disconnect();
  if (context && context.state !== 'closed') {
    context.close();
  }
};
