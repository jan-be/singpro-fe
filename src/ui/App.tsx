import React from 'react';
import YouTube from 'react-youtube';
import './App.css';
import Lyrics from "./Lyrics";
import MusicBars from "./MusicBars";
import BackgroundImage from "./BackgroundImage";
import LyricsReader from "./LyricsReader";
import store from "../state/store";
import {tickBeat} from "../state/actions";
import {connect} from "react-redux";

const App = (props: any) => {
  const startTicking = () => {
    setTimeout(() => {
      setInterval(() => {
        store.dispatch(tickBeat());
      }, 60000 / props.lyricData.bpm);
    }, props.lyricData.gap);
  };

  return (
    <div>
      <BackgroundImage/>
      // @ts-ignore
      <LyricsReader/>
      <MusicBars/>
      <YouTube videoId={store.getState().videoId} onPlay={startTicking}/>
      <MusicBars/>
      <Lyrics/>
    </div>
  );
};

const mapStateToProps = (state: any) => ({
  lyricData: state.lyricData,
});

export default connect(mapStateToProps)(App);
