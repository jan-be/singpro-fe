import React, { useEffect, useState } from "react";
import MusicBars from "./MusicBars";
import { getAndSetHitNotesByPlayerTicks } from "../logic/MicInputToTick";
import { initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";
import { getRandInt } from "../logic/RandomUtility";

const MusicBarsWrapper = props => {
  const [hitNotesByPlayerTicks, setHitNotesByPlayerTicks] = useState({});
  let tickData = props.tickData;
  const [audioProcessor, setAudioProcessor] = useState({});
  const [partyId, setPartyId] = useState(0);
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
      let partyId = getRandInt(0, 1e6);

      setPartyId(partyId);

      wssTmp = await openWebSocket({ isHost: true, partyId });

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
    <div>
      {partyId}
      <MusicBars tickData={props.tickData} hitNotesByPlayerTicks={hitNotesByPlayerTicks}/>
    </div>
  )
};

export default MusicBarsWrapper;
