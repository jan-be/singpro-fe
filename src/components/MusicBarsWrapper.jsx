import React, { useEffect, useState } from "react";
import MusicBars from "./MusicBars";
import { getAndSetHitNotesByPlayer } from "../logic/MicInputToTick";
import { initMicInput } from "../logic/MicrophoneInput";
import { openWebSocket } from "../logic/WebsocketHandling";
import { getRandInt, setLastMsg } from "../logic/RandomUtility";
import AccountCircleIcon from '@mui/icons-material/AccountCircle';

const MusicBarsWrapper = props => {
  const [hitNotesByPlayer, setHitNotesByPlayer] = useState({});
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
      tickData.lyricRef && setHitNotesByPlayer(oldData => getAndSetHitNotesByPlayer(tickData, oldData, note, "host"));
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
      let newTime = performance.now();
      setLastMsg(newTime);

      let jsonObj = JSON.parse(msg.data);

      if (jsonObj.type === "note" && tickData.currentLine) {
        setHitNotesByPlayer(oldData =>
          getAndSetHitNotesByPlayer(tickData, oldData, jsonObj.data.note, jsonObj.data.username));
      }
    };
  }, [tickData, wss]);

  return (
    <div>
      {Object.keys(hitNotesByPlayer).map((playerName, i) => {
        let randInt = getRandInt(0, 360, playerName);
        return <div key={i}>
          <AccountCircleIcon style={{ color: `hsl(${randInt}, 100%, 50%)` }}/>{playerName}
        </div>;
      })
      }
      <MusicBars tickData={props.tickData} hitNotesByPlayer={hitNotesByPlayer}/>
    </div>
  );
};

export default MusicBarsWrapper;
