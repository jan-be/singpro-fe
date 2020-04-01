import React from "react";

import css from './Lyrics.module.css';

const Lyrics = props => {
  let tickData = props.tickData;

  return (
    <div className={css.lyrics}>
      <div className={css.lyrics1}>
        {tickData.currentLine && tickData.currentLine.map((el, i) => {
          let isCurrent = tickData.lyricRef.syllableIndex === i && !tickData.lyricRef.isSilent;

          return <span className={isCurrent ? css.lyrics1Current : css.lyrics1NotCurrent} key={i}>{el.syllable}</span>
        })}
        &nbsp;
      </div>
      <div className={css.lyrics2}>
        {tickData.nextLine && tickData.nextLine.map((el, i) =>
          <span key={i}>{el.syllable}</span>)
        }
        &nbsp;
      </div>
    </div>
  );
};

export default Lyrics;
