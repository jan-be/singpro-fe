import PitchFinder from 'pitchfinder';

const initMicInput = async () => {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const context = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: 44100
  });

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(1024, 1, 1);

  source.connect(processor);
  processor.connect(context.destination);

  return processor;
};

const noteIntFromPitch = frequency => {
  let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
};

export const doAudioProcessing = async onNewNote => {
  let processor = await initMicInput();

  const detectPitch = PitchFinder.AMDF();

  processor.onaudioprocess = e => {
    let buf = e.inputBuffer.getChannelData(0);
    let pitchFreq = detectPitch(buf);

    let notePitchFull = noteIntFromPitch(pitchFreq);

    let realNote = (pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0;

    onNewNote(realNote);

  };
};
