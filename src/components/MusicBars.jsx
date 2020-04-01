import React from "react";
import css from './MusicBars.module.css';

const MusicBars = props => {
  let tickData = props.tickData;
  let hitNotesByPlayerTicks = props.hitNotesByPlayerTicks;

  let lineStartTick =
    tickData.currentLine && tickData.currentLine[1]
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

          {Object.entries(hitNotesByPlayerTicks).map(([playerId, hitNotes]) => Object.entries(hitNotes).map((([i, note]) =>
            <rect
              key={i}
              fill={`hsl(${playerId}, 100%, 50%)`}
              x={(i - lineStartTick) * 10}
              y={200 - note.value * 10}
              // className={css.barPlayer}
              width="10"
              height="10"
              rx="15" ry="15"/>)))}

        </svg>
      </div>
    </div>
  )
};

export default MusicBars;
