import PitchFinder from "pitchfinder";

export const sampleRate = 12000, sampleSize = 1280;

const noteIntFromPitch = frequency => {
  let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  return Math.round(noteNum) + 69;
};

export const doAudioProcessing = buf => {
  let volume = sum(buf);

  let pitchFreq = PitchFinder.AMDF({ sampleRate })(buf);

  let notePitchFull = noteIntFromPitch(pitchFreq);

  let note = (pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0;

  return { note, volume }
};

const sum = array => array.reduce((pv, cv) => pv + cv, 0);
