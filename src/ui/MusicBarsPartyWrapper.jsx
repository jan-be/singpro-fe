import React, { useEffect, useState } from "react";
import MusicBars from "./MusicBars";

const MusicBarsPartyWrapper = props => {
  let [noteForCurrentTick, setNoteForCurrentTick] = useState([]);

  useEffect(() => {
    (async () => {
      const apiDomain = `api.${window.location.hostname}`;

      const wss = new WebSocket(`wss://${apiDomain}/ws`);
      wss.onopen = () => wss.send("hmm");
      wss.onmessage = msg => {
        let data = JSON.parse(msg.data);
        if (data.type === "note") {
          setNoteForCurrentTick(data.data.note);
        }
      }
    })();
  }, []);

  return (
    <MusicBars tickData={props.tickData} noteForCurrentTick={noteForCurrentTick}/>
  )
};

export default MusicBarsPartyWrapper;
