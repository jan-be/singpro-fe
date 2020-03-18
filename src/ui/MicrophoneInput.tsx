import React, {useState} from "react";
import hmm from '../c_pitchtracking/EmscriptCaller';

console.log(hmm.methods.callGetPitch([1, 2, 4, 5, 1]));

const MicrophoneInput = () => {
  const [micVal, setMicVal] = useState(1);
  const [started, setstarted] = useState(false);

  const hmm = async () => {
    const response = await fetch("pitchC.wasm");
    const buffer = await response.arrayBuffer();
    const obj = await WebAssembly.instantiate(buffer, {env: { foo: () => 42, bar: () => 3.14 }});
    // @ts-ignore
    obj.instance.exports.getPitch();
    // @ts-ignore
    // console.log(obj.instance.exports.getPitch([1, 3, 4, 5, 6, 2, 4, 1]));

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
      // Do something with the data, e.g. convert it to WAV
      // setMicVal(getPitch(e));
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
