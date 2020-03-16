import React from "react";
import {connect} from "react-redux";
import './LyricsReader.css'
import {LyricRefType} from "../logic/LyricsParser";

const LyricsReader = (props: any) => {
  // @ts-ignore
  let lyricRef: LyricRefType = undefined;
  if (props.lyricsRefs) {
    lyricRef = props.lyricsRefs[props.tick];
  }

  return (<div className="lyrics">
    <div id="lyrics-1">
      {lyricRef && lyricRef.line.map((el, i) =>
        lyricRef.syllableIndex === i
          ? <span className="lyrics-1-current" key={i}>{el.syllable}</span>
          : <span className="lyrics-1-el" key={i}>{el.syllable}</span>)

      }&nbsp;
    </div>
    <div id="lyrics-2">
      &nbsp;
    </div>
  </div>)
};

const mapStateToProps = (state: any) => ({
  lyricsRefs: state.lyricData.lyricRefs,
  tick: state.tick,
});

export default connect(mapStateToProps)(LyricsReader);