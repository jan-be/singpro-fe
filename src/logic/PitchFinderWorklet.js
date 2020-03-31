import PitchFinder from "pitchfinder";

class PitchFinderWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  noteIntFromPitch = frequency => {
    let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    return Math.round(noteNum) + 69;
  };

  sum = array => array.reduce((pv, cv) => pv + cv, 0);

  doAudioProcessing = buf => {
    let volume = this.sum(buf);

    let pitchFreq = PitchFinder.AMDF({ sampleRate: 3000 })(buf);

    let notePitchFull = this.noteIntFromPitch(pitchFreq);

    let note = (pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0;

    return { note, volume }
  };


  process(inputs, outputs, parameters) {
    this.port.postMessage(this.doAudioProcessing(inputs[0][0]));

    return true
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
