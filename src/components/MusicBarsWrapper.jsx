import React, { useEffect, useState } from "react";
import MusicBars from "./MusicBars";
import { getAndSetHitNotesByPlayerTicks } from "../logic/MicInputToTick";
import { initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";
import { getRandInt } from "../logic/RandomUtility";
import AccountCircleIcon from '@material-ui/icons/AccountCircle';

const MusicBarsWrapper = props => {
  const [hitNotesByPlayerTicks, setHitNotesByPlayerTicks] = useState({});
  let tickData = props.tickData;
  const [setOnProcessing, setSetOnProcessing] = useState(null);
  const [wss, setWss] = useState({});

  useEffect(() => {
    let setOnProcessing, stopMicInput;

    (async () => {
      ({ setOnProcessing, stopMicInput } = await initMicInput());
      setSetOnProcessing(() => setOnProcessing);
    })();

    return () => {
      stopMicInput && stopMicInput();
    };
  }, []);

  useEffect(() => {
    setOnProcessing && setOnProcessing(msg => {
      let { note } = msg.data;
      tickData.lyricRef && setHitNotesByPlayerTicks(oldData => getAndSetHitNotesByPlayerTicks(tickData, oldData, note, 0));
    });
  }, [tickData, setOnProcessing]);

  useEffect(() => {
    let wssTmp;
    (async () => {
      wssTmp = await openWebSocket({ isHost: true, partyId: props.partyId });

      setWss(wssTmp);
    })();

    return () => {
      wssTmp && wssTmp.close();
    };
  }, [props.partyId]);
  useEffect(() => {
    wss.onmessage = msg => {
      let jsonObj = JSON.parse(msg.data);

      if (jsonObj.type === "note" && tickData.currentLine) {
        setHitNotesByPlayerTicks(oldData =>
          getAndSetHitNotesByPlayerTicks(tickData, oldData, jsonObj.data.note, jsonObj.data.username));
      }
    };
  }, [tickData, wss]);

  return (
    <div>
      {Object.keys(hitNotesByPlayerTicks).map((playerName, i) => {
        let randInt = getRandInt(0, 360, playerName);
        return <div key={i}>
          <AccountCircleIcon style={{ color: `hsl(${randInt}, 100%, 50%)` }}/>{playerName}
        </div>;
      })
      }
      <MusicBars tickData={props.tickData} hitNotesByPlayerTicks={hitNotesByPlayerTicks}/>
    </div>
  );
};

export default MusicBarsWrapper;
