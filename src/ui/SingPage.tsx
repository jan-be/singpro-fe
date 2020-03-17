import React from 'react';
import YouTube from 'react-youtube';
import MusicBars from "./MusicBars";
import BackgroundImage from "./BackgroundImage";
import LyricsReader from "./Lyrics";
import {tickBeat} from "../state/actions";
import {connect} from "react-redux";
import setSelfAdjustingInterval from "../logic/SelfAdjustingInterval";

const SingPage = (props: any) => {
  const startTicking = () => {
    setTimeout(() => {
      setSelfAdjustingInterval(() => {
        tickBeat(true);
      }, 60000 / props.lyricData.bpm);
    }, props.lyricData.gap);
  };

  return (
    <div>
      <BackgroundImage/>
      <LyricsReader/>
      <MusicBars/>
      <YouTube videoId={props.videoId} onPlay={startTicking}/>
      <MusicBars/>
      <LyricsReader/>
    </div>
  );
};

const mapStateToProps = (state: any) => ({
  videoId: state.videoId,
  lyricData: state.lyricData,
});

export default connect(mapStateToProps)(SingPage);
