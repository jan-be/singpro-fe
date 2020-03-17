import React from "react";
import {connect} from "react-redux";
import {TickDataType} from "../logic/LyricsParser";

import css from './Lyrics.module.css';

const Lyrics = (props: any) => {
  let tickData: TickDataType = props.tickData;

  return <div className={css.lyrics}>
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
  </div>;
};

const mapStateToProps = (state: any) => ({
  tickData: state.tickData,
});

export default connect(mapStateToProps)(Lyrics);