import React, {useState} from "react";
import cWrapper from '../c_pitchtracking/cWrapper';

const MicrophoneInput = () => {
  const [micVal, setMicVal] = useState(1);
  const [started, setstarted] = useState(false);

  const hmm = async () => {

    cWrapper.Module().onRuntimeInitialized = async () => {
      console.log("wadu");

      console.log(cWrapper.version());
      console.log(cWrapper.getPitch([1, 24, 5, 6], -1, -1));

      let stream = await navigator.mediaDevices.getUserMedia({audio: true});

      const context = new AudioContext({
        latencyHint: 'interactive',
        sampleRate: 44100
      });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(1024, 1, 1);

      source.connect(processor);
      processor.connect(context.destination);

      processor.onaudioprocess = (e) => {
        // console.log(e.inputBuffer.getChannelData(0));
        console.log(cWrapper.getPitch(e.inputBuffer.getChannelData(0), -1, -1));
      };
    };

  };

  if (!started) {
    setstarted(true);
    hmm();
  }

  return (
    <div>
      Mic
      {micVal}
    </div>
  );
};

export default MicrophoneInput;
