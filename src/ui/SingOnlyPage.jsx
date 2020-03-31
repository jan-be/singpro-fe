import React, { useEffect, useState } from 'react';
import { doAudioProcessing, initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";

const SingOnlyPage = props => {

  const [note, setNote] = useState(0);
  const [count, setCount] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [time, setTime] = useState({ delta: 0, oldTime: 0 });

  const getRandInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  useEffect(() => {
    let processor;
    let wss;
    let stopMicInput;

    (async () => {
      const playerId = getRandInt(0, 360);

      [{ processor, stopMicInput }, wss] = await Promise.all([
        initMicInput(),
        openWebSocket(false)
      ]);

      processor.onaudioprocess = e => {
        setCount(oldCount => oldCount + 1);

        let { note, volume, sampleRate } = doAudioProcessing(e);

        setNote(Math.min(10, Math.log2(1 + Math.abs(volume))));

        setSampleRate(sampleRate);

        setTime(({ delta, oldTime }) => {
          return { delta: (Date.now() - oldTime), oldTime: Date.now() };
        });

        wss.sendObj(
          { type: "note", data: { note, playerId } }
        );
      };
    })();
    return () => {
      stopMicInput();
      wss.close();
    };
  }, []);

  return (
    <div>
      <div>{time.delta}</div>

      recording {sampleRate} {count}

      <svg width={200} height={200}>
        <circle cx={100} cy={100} r={20} fill="black"/>
        <circle cx={100} cy={100} r={20 + 14 * note} stroke="black" fillOpacity="0"/>
      </svg>
    </div>
  );
};

export default SingOnlyPage;
