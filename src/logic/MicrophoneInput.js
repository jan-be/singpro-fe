// eslint-disable-next-line import/no-webpack-loader-syntax
import PitchFinderWorklet from 'worklet-loader!./PitchFinderWorklet';
import { doAudioProcessing, sampleRate, sampleSize } from "./MicSharedFuns";
import Resampler, { initResampler } from "audio-resampler";

export const initMicInput = async () => {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  if (new AudioContext().audioWorklet) {
    let context = new AudioContext({
      latencyHint: 'interactive',
      sampleRate,
    });

    const source = context.createMediaStreamSource(stream);

    await context.audioWorklet.addModule(PitchFinderWorklet);
    let pitchFinderWorkletNode = new AudioWorkletNode(context, 'pitch-finder-worklet');

    source.connect(pitchFinderWorkletNode);
    pitchFinderWorkletNode.connect(context.destination);

    return {
      setOnProcessing: fun => {
        pitchFinderWorkletNode.port.onmessage = fun
      },
      stopMicInput: () => {
        stopMicInput(stream, source, pitchFinderWorkletNode);
        pitchFinderWorkletNode.port.onmessage = null;
      },
    };
  } else {
    initResampler();

    let cb;

    let context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(256, 1, 1);
    source.connect(processor);
    processor.connect(context.destination);

    let nativeSampleRate = source.context.sampleRate;

    let resampledBuffer = new Float32Array(sampleSize);
    let bufferPosition = 0;

    processor.onaudioprocess = (e) => {
      Resampler(e.inputBuffer, sampleRate, ev => {
        resampledBuffer.set(ev.getAudioBuffer().getChannelData(0), bufferPosition);

        bufferPosition = (bufferPosition + 256 * sampleRate / nativeSampleRate) % sampleSize;

        if (bufferPosition === 0) {
          let { note, volume } = doAudioProcessing(resampledBuffer);
          cb && cb({ data: { note, volume } });
        }
      });

    };

    return {
      setOnProcessing: fun => cb = fun,
      stopMicInput: () => {
        stopMicInput(stream, source, processor);
        processor.onaudioprocess = null;
      },
    };
  }
};

const stopMicInput = (stream, source, processor) => {
  stream.getTracks().forEach(e => e.stop());
  source.disconnect();
  processor.disconnect();
};
