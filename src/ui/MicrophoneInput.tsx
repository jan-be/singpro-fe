import React, {useState} from "react";
import cWrapper from '../c_pitchtracking/cWrapper';

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

  const hmm = async () => {
    let [processor, myWrapper] = await Promise.all([initMicInput(), cWrapper]);

    console.log(myWrapper.version());

    let sinWave = [];
    for (let i = 0; i < 1024; i++) {
      sinWave[i] = Math.sin(i / 3);
    }

    let offset = myWrapper.module._malloc(1024 * 8);
    myWrapper.module.HEAPF64.set(new Float64Array(sinWave), offset / 8);


    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      let buf = new Uint8Array(new Float64Array(e.inputBuffer.getChannelData(0)).buffer);
      setMicVal(myWrapper.getPitch(buf, -1, -1));

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
