import React, { useEffect, useState } from "react";
import css from './MusicBars.module.css'
import { doAudioProcessing } from "../logic/MicrophoneInput";

const MusicBars = props => {
  let tickData = props.tickData;

  let [notes, setNotes] = useState([]);

  let lineStartTick =
    tickData.currentLine
      ? tickData.currentLine[1].start
      : 0;

  useEffect(() => {
    doAudioProcessing(note => {
      setNotes(oldNotes => {
        return oldNotes.length > 500 ? [...oldNotes.slice(1, 500), note] : [...oldNotes, note]
      });
    });
  }, []);

  return (
    <div>
      <svg width={1200} height={200}>
        {tickData.currentLine && tickData.currentLine.filter(el => !el.isBreak).map((el, i) => {
          let isCurrent = tickData.lyricRef.syllableIndex === i && !tickData.lyricRef.isSilent;

          return (
            <rect x={(el.start - lineStartTick) * 10}
                  y={200 - el.tone * 10}
                  key={i}
                  className={isCurrent ? css.barCurrent : css.barNotCurrent}
                  width={el.length * 10}
                  height="10"
                  rx="15" ry="15"/>
          );
        })}

        {notes.map(((note, i) =>
          <rect
            key={i}
            x={i}
            y={200 - note * 10}
            className={css.barPlayer}
            width="3"
            height="3"
            rx="15" ry="15"/>))}

      </svg>
    </div>
  )
};

export default MusicBars;
