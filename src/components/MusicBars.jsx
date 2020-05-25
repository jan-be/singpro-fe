import React from "react";
import css from './MusicBars.module.css';
import { getRandInt } from "../logic/RandomUtility";

const MusicBars = props => {
  let tickData = props.tickData;
  let hitNotesByPlayerTicks = props.hitNotesByPlayerTicks;

  let lineStartTick =
    tickData.currentLine && tickData.currentLine[1]
      ? tickData.currentLine[1].start
      : 0;


  let lowerBound = Math.min(...(tickData.currentLine?.map(e => e.tone) ?? [0]));
  let upperBound = Math.max(...(tickData.currentLine?.map(e => e.tone) ?? [0]));

  let difference = upperBound - lowerBound;

  if (difference < 12) {
    lowerBound -= 6 - difference / 2;
    upperBound += 6 - difference / 2;
  }

  return (
    <div className={css.barContainerWrapper}>
      <div className={css.barContainer}>
        <svg>
          {tickData.currentLine && tickData.currentLine.filter(el => !el.isBreak).map((el, i) => {
            let isCurrent = tickData.lyricRef.syllableIndex === i + 1 && !tickData.lyricRef.isSilent;

            return (
              <rect x={(el.start - lineStartTick) * 10}
                    y={200 - ((el.tone - lowerBound) / (upperBound - lowerBound)) * 200}
                    key={i}
                    className={isCurrent ? css.barCurrent : css.barNotCurrent}
                    width={el.length * 10}
                    height="10"
                    rx="15" ry="15"/>
            );
          })}

          {Object.entries(hitNotesByPlayerTicks).map(([username, hitNotes]) => Object.entries(hitNotes).map((([i, noteData]) => {
            let randInt = getRandInt(0, 360, username);

            let mostProbableNote = 0;
            for (let j = -10; j < 10; j++) {
              if (Math.abs(noteData.expectedTone - (noteData.actualTone + j * 12)) <= 6) {
                mostProbableNote = noteData.actualTone + j * 12;
              }
            }

            return <rect
              key={i}
              fill={`hsl(${randInt}, 100%, 50%)`}
              x={(i - lineStartTick) * 10}
              y={200 - ((mostProbableNote - lowerBound) / (upperBound - lowerBound)) * 200}
              // className={css.barPlayer}
              width="10"
              height="10"
              rx="15" ry="15"/>;
          })))}

        </svg>
      </div>
    </div>
  );
};

export default MusicBars;
