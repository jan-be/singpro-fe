import React, { useEffect, useState } from 'react';
import YouTube from 'react-youtube';
import BackgroundImage from "./BackgroundImage";
import Lyrics from "./Lyrics";
import SelfAdjustingInterval from "../logic/SelfAdjustingInterval";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import MusicBars from "./MusicBars";
import css from './SingPage.module.css'

const SingPage = props => {

  const { videoId } = props.match.params;

  const [tickData, setTickData] = useState({});
  const [lyricData, setLyricData] = useState();

  let ticker;

  useEffect(() => {
    let fun = async () => {
      let e = await readTextFile(`/ulfs/${videoId}`);
      setLyricData(e);
      setTickData(getTickData(e, 0));
    };
    fun();
  }, [videoId]);

  const onPlay = () => {
    setTimeout(() => {
      ticker = new SelfAdjustingInterval(() => {
        setTickData(oldTickData => getTickData(lyricData, oldTickData.tick + 1));
      }, 60000 / lyricData.bpm, null);
      ticker.start();
    }, lyricData.gap);
  };

  return (
    <div className={css.hmm}>
      <BackgroundImage videoId={videoId}/>
      <Lyrics tickData={tickData}/>
      <MusicBars tickData={tickData}/>
      <YouTube videoId={videoId} onPlay={onPlay}/>
    </div>
  );
};

export default SingPage;
