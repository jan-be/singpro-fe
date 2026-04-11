import React from "react";

import css from './Lyrics.module.css';

const CYAN = '#00e5ff';
const GRAY = '#e0e0e0';

const Lyrics = props => {
  let tickData = props.tickData;

  return (
    <div className={css.lyrics}>
      <div className={css.lyrics1}>
        {tickData.currentLine && tickData.currentLine.map((el, i) => {
          if (el.isBreak) return null;

          const isSilent = tickData.lyricRef.isSilent;
          const isCurrent = tickData.lyricRef.syllableIndex === i && !isSilent;
          const isPast = i < tickData.lyricRef.syllableIndex;

          if (isCurrent) {
            const progress = Math.max(0, Math.min(1,
              (tickData.tickFloat - el.start) / Math.max(1, el.length)
            ));
            const pct = (progress * 100).toFixed(1);

            return (
              <span
                key={i}
                className={css.sweepText}
                style={{
                  backgroundImage: `linear-gradient(90deg, ${CYAN} ${pct}%, ${GRAY} ${pct}%)`,
                }}
              >
                {el.syllable}
              </span>
            );
          }

          return (
            <span key={i} className={isPast ? css.pastText : css.futureText}>
              {el.syllable}
            </span>
          );
        })}
        &nbsp;
      </div>
      <div className={css.lyrics2}>
        {tickData.nextLine && tickData.nextLine.map((el, i) =>
          el.isBreak ? null : <span key={i}>{el.syllable}</span>)
        }
        &nbsp;
      </div>
    </div>
  );
};

export default Lyrics;
