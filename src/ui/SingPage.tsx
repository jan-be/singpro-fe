import React from 'react';
import YouTube from 'react-youtube';
import './SingPage.css';
import Lyrics from "./Lyrics";
import MusicBars from "./MusicBars";
import BackgroundImage from "./BackgroundImage";
import LyricsReader from "./LyricsReader";
import store from "../state/store";
import {tickBeat} from "../state/actions";
import {connect} from "react-redux";
import setSelfAdjustingInterval from "../logic/SelfAdjustingInterval";

const SingPage = (props: any) => {
  const startTicking = () => {
    setTimeout(() => {
      setSelfAdjustingInterval(() => {
        store.dispatch(tickBeat());
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
      <Lyrics/>
    </div>
  );
};

const mapStateToProps = (state: any) => ({
  videoId: state.videoId,
  lyricData: state.lyricData,
});

export default connect(mapStateToProps)(SingPage);
