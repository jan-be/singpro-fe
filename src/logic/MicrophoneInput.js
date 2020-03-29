import PitchFinder from 'pitchfinder';

let processor;

export const initMicInput = async () => {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const context = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: 44100
  });

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);

  source.connect(processor);
  processor.connect(context.destination);

  return processor;
};

const noteIntFromPitch = frequency => {
  let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
};

const sum = array => array.reduce((pv, cv) => pv + cv, 0);

export const doAudioProcessing = e => {
  let buf = e.inputBuffer.getChannelData(0);

  let volume = sum(buf);
  // let volume = undefined;

  let pitchFreq = PitchFinder.ACF2PLUS()(buf);

  let notePitchFull = noteIntFromPitch(pitchFreq);

  let note = (pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0;

  return { note, volume }
};

export const stopAudioProcessing = () => {
  if (processor) {
    processor.disconnect();
  }
};
