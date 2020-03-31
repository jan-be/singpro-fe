import PitchFinder from 'pitchfinder';

let sampleRate;

export const initMicInput = async (handleMicInput) => {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  sampleRate = stream.getTracks()[0].getSettings().sampleRate;

  let context = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: 16000,
  });

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(512, 1, 1);

  source.connect(processor);
  processor.connect(context.destination);

  processor.onaudioprocess = handleMicInput;

  return { processor, stopMicInput: () => stopMicInput(stream, source, processor) };
};

const stopMicInput = (stream, source, processor) => {
  stream.getTracks().forEach(e => e.stop());
  source.disconnect();
  processor.disconnect();
  processor.onaudioprocess = null;
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
