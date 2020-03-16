import React from "react";
import {connect} from "react-redux";
import {LyricRefType, LyricType} from "../logic/LyricsParser";

import css from './LyricsReader.module.css';

const LyricsReader = (props: any) => {
  // @ts-ignore
  let lyricRef: LyricRefType = undefined;
  let currentLine: LyricType[] = [];
  let nextLine: LyricType[] = [];
  if (props.lyricRefs && props.lyricRefs.length > 0) {
    lyricRef = props.lyricRefs[props.tick];
  }
  if (lyricRef) {
    currentLine = props.lyricLines[lyricRef.lineIndex];
    nextLine = props.lyricLines[lyricRef.lineIndex + 1];
  }

  return (<div className={css.lyrics}>
    <div className={css.lyrics1}>
      {currentLine && currentLine.map((el, i) =>
        lyricRef.syllableIndex === i
          ? <span className={css.lyrics1NotCurrent} key={i}>{el.syllable}</span>
          : <span className={css.lyrics1Current} key={i}>{el.syllable}</span>)
      }
      &nbsp;
    </div>
    <div className={css.lyrics2}>
      {nextLine && nextLine.map((el, i) =>
        <span key={i}>{el.syllable}</span>)
      }
      &nbsp;
    </div>
  </div>)
};

const mapStateToProps = (state: any) => ({
  lyricLines: state.lyricData.lyricLines,
  lyricRefs: state.lyricData.lyricRefs,
  tick: state.tick,
});

export default connect(mapStateToProps)(LyricsReader);