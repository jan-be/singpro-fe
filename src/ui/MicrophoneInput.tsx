import React, {useState} from "react";
import cWrapper from '../c_pitchtracking/cWrapper';
import {setCurrentTone} from "../state/actions";

const MicrophoneInput = () => {
  const [micVal, setMicVal] = useState(1);
  const [started, setstarted] = useState(false);

  const initMicInput = async () => {
    let stream = await navigator.mediaDevices.getUserMedia({audio: true});

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

  const noteIntFromPitch = (frequency: number) => {
    let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    return Math.round(noteNum) + 69;
  };

  const hmm = async () => {
    let [processor, myWrapper] = await Promise.all([initMicInput(), cWrapper]);

    console.log(myWrapper.version());

    let sinWave = [];
    for (let i = 0; i < 1024; i++) {
      sinWave[i] = Math.sin(i / 3);
    }

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      let buf = new Uint8Array(new Float64Array(e.inputBuffer.getChannelData(0)).buffer);
      let pitchFreq = myWrapper.getPitch(buf);

      let notePitchFull = noteIntFromPitch(pitchFreq);

      setCurrentTone((pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0);

    };
  };


  if (!started) {
    setstarted(true);
    hmm();
  }

  return (
    <span/>
  );
};

export default MicrophoneInput;
