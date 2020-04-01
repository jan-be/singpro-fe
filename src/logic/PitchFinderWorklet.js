import PitchFinder from "pitchfinder";

class PitchFinderWorklet extends AudioWorkletProcessor {
  largerBufferSize = 1024;
  largerBuffer = new Float32Array(this.largerBufferSize);
  bufferPosition = 0;

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

    let pitchFreq = PitchFinder.AMDF({ sampleRate: 48000 })(buf);

    let notePitchFull = this.noteIntFromPitch(pitchFreq);

    let note = (pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0;

    return { note, volume }
  };


  process(inputs) {
    this.largerBuffer.set(inputs[0][0], this.bufferPosition);

    this.bufferPosition = (this.bufferPosition + 128) % this.largerBufferSize;

    if (this.bufferPosition === 0) {
      this.port.postMessage(this.doAudioProcessing(this.largerBuffer));
    }

    return true
  }
}

registerProcessor('pitch-finder-worklet', PitchFinderWorklet);
