import React from "react";
import {connect} from "react-redux";
import {TickDataType} from "../logic/LyricsParser";

import css from './Lyrics.module.css';

const Lyrics = (props: any) => {
  let tickdata: TickDataType = props.tickData;

  return (<div className={css.lyrics}>
    <div className={css.lyrics1}>
      {tickdata.currentLine && tickdata.currentLine.map((el, i) =>
        tickdata.lyricRef.syllableIndex === i && !tickdata.lyricRef.isSilent
          ? <span className={css.lyrics1NotCurrent} key={i}>{el.syllable}</span>
          : <span className={css.lyrics1Current} key={i}>{el.syllable}</span>)
      }
      &nbsp;
    </div>
    <div className={css.lyrics2}>
      {tickdata.nextLine && tickdata.nextLine.map((el, i) =>
        <span key={i}>{el.syllable}</span>)
      }
      &nbsp;
    </div>
  </div>)
};

const mapStateToProps = (state: any) => ({
  tickData: state.tickData,
});

export default connect(mapStateToProps)(Lyrics);