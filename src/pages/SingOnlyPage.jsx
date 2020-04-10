import React, { useEffect, useState } from 'react';
import { initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";
import { getRandInt } from "../logic/RandomUtility";

const SingOnlyPage = props => {

  const partyId = parseInt(props.match.params.partyId);

  const [volume, setVolume] = useState(0);
  const [note, setNote] = useState(0);
  const [count, setCount] = useState(0);
  const [time, setTime] = useState({ delta: 0, oldTime: 0 });

  useEffect(() => {
    let setOnProcessing;
    let wss;
    let stopMicInput;

    (async () => {
      const playerId = getRandInt(0, 360);

      [{ setOnProcessing, stopMicInput }, wss] = await Promise.all([
        initMicInput(),
        openWebSocket({ partyId, playerId }),
      ]);
      setOnProcessing(msg => {
        let { note, volume } = msg.data;

        setVolume(Math.min(10, Math.log2(1 + Math.abs(volume))));

        setCount(oldCount => oldCount + 1);

        setNote(note);

        setTime(({ oldTime }) => {
          return { delta: (Date.now() - oldTime), oldTime: Date.now() };
        });

        wss.sendObj(
          { type: "note", data: { note } },
        );
      });
    })();
    return () => {
      stopMicInput();
      wss.close();
    };
  }, [partyId]);

  return (
    <div>
      <div>{time.delta}</div>
      <div>{note}</div>
      <div>{count}</div>

      recording

      <svg width={200} height={200}>
        <circle cx={100} cy={100} r={20} fill="black"/>
        <circle cx={100} cy={100} r={20 + 14 * volume} stroke="black" fillOpacity="0"/>
      </svg>
    </div>
  );
};

export default SingOnlyPage;
