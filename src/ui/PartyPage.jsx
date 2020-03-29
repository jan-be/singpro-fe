import React, { useEffect, useState } from 'react';
import BackgroundImage from "./BackgroundImage";
import Lyrics from "./Lyrics";
import SelfAdjustingInterval from "../logic/SelfAdjustingInterval";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import VideoPlayer from "./VideoPlayer";
import MusicBarsWrapper from "./MusicBarsWrapper";

const PartyPage = props => {

  const { videoId } = props.match.params;

  const [tickData, setTickData] = useState({});
  const [lyricData, setLyricData] = useState();

  let ticker;

  useEffect(() => {
    (async () => {
      let e = await readTextFile(`/ulfs/${videoId}`);
      setLyricData(e);
      setTickData(getTickData(e, 0));
    })();
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
    <div>
      <BackgroundImage videoId={videoId}/>
      <Lyrics tickData={tickData}/>
      <MusicBarsWrapper tickData={tickData}/>
      <VideoPlayer videoId={videoId} onPlay={onPlay}/>
    </div>
  );
};

export default PartyPage;
