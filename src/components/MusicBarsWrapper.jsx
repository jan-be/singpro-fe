import React, { useEffect, useState } from "react";
import MusicBars from "./MusicBars";
import { getAndSetHitNotesByPlayerTicks } from "../logic/MicInputToTick";
import { initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";

const MusicBarsWrapper = props => {
  const [hitNotesByPlayerTicks, setHitNotesByPlayerTicks] = useState({});
  let tickData = props.tickData;
  const [audioProcessor, setAudioProcessor] = useState({});
  const [wss, setWss] = useState({});

  useEffect(() => {
    let processor, stopMicInput;

    (async () => {
      ({ processor, stopMicInput } = await initMicInput());
      setAudioProcessor(processor);
    })();

    return () => {
      stopMicInput();
    };
  }, []);

  useEffect(() => {
    audioProcessor.onmessage = msg => {
      let { note } = msg.data;

      setHitNotesByPlayerTicks(oldData => {
        return getAndSetHitNotesByPlayerTicks(
          tickData,
          oldData,
          note,
          0)
      });
    };
  }, [tickData, audioProcessor]);

  useEffect(() => {
    let wssTmp;
    (async () => {
      wssTmp = await openWebSocket(true);

      setWss(wssTmp);
    })();

    return () => {
      wssTmp.close();
    }
  }, []);
  useEffect(() => {
    wss.onmessage = msg => {
      let jsonObj = JSON.parse(msg.data);

      if (jsonObj.type === "note" && tickData.currentLine) {
        setHitNotesByPlayerTicks(oldData => {
            return getAndSetHitNotesByPlayerTicks(
              tickData,
              oldData,
              jsonObj.data.note,
              jsonObj.data.playerId)
          }
        );
      }
    }
  }, [tickData, wss]);


  return (
    <MusicBars tickData={props.tickData} hitNotesByPlayerTicks={hitNotesByPlayerTicks}/>
  )
};

export default MusicBarsWrapper;
