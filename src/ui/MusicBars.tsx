import React from "react";
import {connect} from "react-redux";
import {TickDataType} from "../logic/LyricsParser";

const MusicBars = (props: any) => {
  let tickData: TickDataType = props.tickData;

  return <svg width={1200} height={200}>
    {tickData.currentLine && tickData.currentLine.filter(el => !el.isBreak).map((el, i) => {
      return (<rect x={i * 80} y={200 - el.tone * 10} width="80" height="10" rx="15" ry="15"/>)
    })}
  </svg>
};

const mapStateToProps = (state: any) => ({
  tickData: state.tickData,
});

export default connect(mapStateToProps)(MusicBars);
