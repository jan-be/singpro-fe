import PitchFinder from 'pitchfinder';
// eslint-disable-next-line import/no-webpack-loader-syntax
import PitchFinderWorklet from 'worklet-loader!./PitchFinderWorklet';

let sampleRate;

export const initMicInput = async () => {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  let context = new AudioContext({
    // latencyHint: 'interactive',
    sampleRate: 3000,
  });


  const source = context.createMediaStreamSource(stream);

  await context.audioWorklet.addModule(PitchFinderWorklet);
  let pitchfindingWorkletNode = new AudioWorkletNode(context, 'pitch-finder-worklet');

  source.connect(pitchfindingWorkletNode);
  pitchfindingWorkletNode.connect(context.destination);

  return { processor: pitchfindingWorkletNode.port, stopMicInput: () => stopMicInput(stream, source, pitchfindingWorkletNode) };
};

const stopMicInput = (stream, source, workletNode) => {
  stream.getTracks().forEach(e => e.stop());
  source.disconnect();
  workletNode.disconnect();
  workletNode.port.onmessage = null;
};

const noteIntFromPitch = frequency => {
  let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
};

const sum = array => array.reduce((pv, cv) => pv + cv, 0);

export const doAudioProcessing = e => {
  let buf = e.inputBuffer.getChannelData(0);

  // let sampleRate = e.inputBuffer.sampleRate;

  let volume = sum(buf);

  let pitchFreq = PitchFinder.AMDF({ sampleRate: 16000 })(buf);

  let notePitchFull = noteIntFromPitch(pitchFreq);

  let note = (pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0;

  return { note, volume, sampleRate }
};
