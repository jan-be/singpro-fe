// eslint-disable-next-line import/no-webpack-loader-syntax
import PitchFinderWorklet from 'worklet-loader!./PitchFinderWorklet';

export const initMicInput = async () => {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  let context = new AudioContext({
    // latencyHint: 'interactive',
    // sampleRate: 3000,
  });

  const source = context.createMediaStreamSource(stream);

  await context.audioWorklet.addModule(PitchFinderWorklet);
  let pitchFinderWorkletNode = new AudioWorkletNode(context, 'pitch-finder-worklet');

  source.connect(pitchFinderWorkletNode);
  pitchFinderWorkletNode.connect(context.destination);

  return { processor: pitchFinderWorkletNode.port, stopMicInput: () => stopMicInput(stream, source, pitchFinderWorkletNode) };
};

const stopMicInput = (stream, source, workletNode) => {
  stream.getTracks().forEach(e => e.stop());
  source.disconnect();
  workletNode.disconnect();
  workletNode.port.onmessage = null;
};
