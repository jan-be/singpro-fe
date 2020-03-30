import React, { useEffect, useState } from 'react';
import { doAudioProcessing, initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";

const SingOnlyPage = props => {

  const [note, setNote] = useState(0);

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
        let { note, volume } = doAudioProcessing(e);

        setNote(Math.min(10, Math.log2(1 + Math.abs(volume))));

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
      recording

      <svg width={200} height={200}>
        <circle cx={100} cy={100} r={20} fill="black"/>
        <circle cx={100} cy={100} r={20 + 14 * note} stroke="black" fillOpacity="0"/>
      </svg>
    </div>
  );
};

export default SingOnlyPage;
