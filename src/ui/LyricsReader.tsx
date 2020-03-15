import React from "react";
import {connect} from "react-redux";
import {getLyricForTick} from "../logic/LyricsParser";
import './LyricsReader.css'

const LyricsReader = (props: any) => {
  let lyricToShow = getLyricForTick(props.tick);

  return (<div className="lyrics">
    <div id="lyrics-1">
      {lyricToShow}&nbsp;
    </div>
  </div>)
};

const mapStateToProps = (state: any) => ({
  lyrics: state.lyrics,
  tick: state.tick,
});

export default connect(mapStateToProps)(LyricsReader);