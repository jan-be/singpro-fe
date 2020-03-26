import React, { useEffect, useState } from "react";
import { doAudioProcessing } from "../logic/MicrophoneInput";
import MusicBars from "./MusicBars";

const MusicBarsStupidWrapper = props => {
  let [noteForCurrentTick, setNoteForCurrentTick] = useState([]);

  useEffect(() => {
    doAudioProcessing(note => {
      setNoteForCurrentTick(note);
    });
  }, []);

  return (
    <MusicBars tickData={props.tickData} noteForCurrentTick={noteForCurrentTick}/>
  )
};

export default MusicBarsStupidWrapper;
