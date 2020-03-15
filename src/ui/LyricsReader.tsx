import React from "react";
import {connect} from "react-redux";
import {getLyricsAroundTick} from "../logic/LyricsParser";
import './LyricsReader.css'

const LyricsReader = (props: any) => {
  let lyric1 = getLyricsAroundTick(props.tick);

  return (<div className="lyrics">
    <div id="lyrics-1">
      {lyric1.map((el, i) => <span key={i}>{el}</span>)}&nbsp;
    </div>
    <div id="lyrics-2">
      &nbsp;
    </div>
  </div>)
};

const mapStateToProps = (state: any) => ({
  lyrics: state.lyrics,
  tick: state.tick,
});

export default connect(mapStateToProps)(LyricsReader);