import React, { useEffect, useState } from 'react';
import { initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";
import { useParams } from "react-router-dom";
import WrapperPage from "./WrapperPage";

const SingOnlyPage = () => {

  const params = useParams();

  const { username } = params;
  const partyId = parseInt(params.partyId);

  const [volume, setVolume] = useState(0);
  const [note, setNote] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let setOnProcessing;
    let wss;
    let stopMicInput;

    (async () => {
      [{ setOnProcessing, stopMicInput }, wss] = await Promise.all([
        initMicInput(),
        openWebSocket({ partyId, username }),
      ]);
      setOnProcessing(msg => {
        let { note, volume } = msg.data;

        setVolume(Math.min(10, Math.log2(1 + Math.abs(volume))));

        setCount(oldCount => oldCount + 1);

        setNote(note);

        wss.sendObj(
          { type: "note", data: { note } },
        );
      });
    })();
    return () => {
      stopMicInput();
      wss.close();
    };
  }, [partyId, username]);

  return (
    <WrapperPage>
      <div>{note}</div>
      <div>{count}</div>

      recording

      <svg width={200} height={200}>
        <circle cx={100} cy={100} r={20} fill="black"/>
        <circle cx={100} cy={100} r={20 + 14 * volume} stroke="black" fillOpacity="0"/>
      </svg>
    </WrapperPage>
  );
};

export default SingOnlyPage;
