import {useState} from "react";
import {setCurrentTone} from "../state/actions";
import PitchFinder from 'pitchfinder';

const MicrophoneInput = () => {
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
    let processor = await initMicInput();

    const detectPitch = PitchFinder.DynamicWavelet();

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      let buf = e.inputBuffer.getChannelData(0);
      let pitchFreq = detectPitch(buf);

      let notePitchFull = noteIntFromPitch(pitchFreq);

      setCurrentTone((pitchFreq && notePitchFull >= 0 && notePitchFull < 200) ? notePitchFull - 36 : 0);

    };
  };


  if (!started) {
    setstarted(true);
    hmm();
  }

  return null;
};

export default MicrophoneInput;
