import React, { useEffect, useState } from "react";
import css from './MusicBars.module.css'

const MusicBars = props => {
  let tickData = props.tickData;
  let noteForCurrentTick = props.noteForCurrentTick;

  let [noteForTicks, setNoteForTicks] = useState([]);

  const getAverage = (oldAverage, oldSampleCount, newValue) => {
    return (oldAverage * oldSampleCount + newValue) / (oldSampleCount + 1);
  };

  useEffect(() =>
      setNoteForTicks(oldValue => {
        let oldObj = oldValue[tickData.tick];
        if (!oldObj) oldObj = { value: 0, samples: 0 };

        let newAverage = getAverage(oldObj.value, oldObj.samples, noteForCurrentTick);

        let hmm = oldValue;
        hmm[tickData.tick] = { value: newAverage, samples: oldObj.samples + 1 };

        return hmm;
      })
    , [noteForCurrentTick, tickData.tick]);

  let lineStartTick =
    tickData.currentLine
      ? tickData.currentLine[1].start
      : 0;

  return (
    <div className={css.barContainerWrapper}>
      <div className={css.barContainer}>
        <svg width={1000} height={200}>
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

          {noteForTicks.map(((note, i) =>
            <rect
              key={i}
              x={(i - lineStartTick) * 10}
              y={200 - note.value * 10}
              className={css.barPlayer}
              width="10"
              height="10"
              rx="15" ry="15"/>))}

        </svg>
      </div>
    </div>
  )
};

export default MusicBars;
