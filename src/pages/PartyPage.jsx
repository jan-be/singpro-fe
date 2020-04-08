import React, { useEffect, useState } from 'react';
import BackgroundImage from "../components/BackgroundImage";
import Lyrics from "../components/Lyrics";
import SelfAdjustingInterval from "../logic/SelfAdjustingInterval";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import MusicBarsWrapper from "../components/MusicBarsWrapper";
import BottomPartyIdBar from "../components/BottomPartyIdBar";
import { getRandInt } from "../logic/RandomUtility";

const PartyPage = props => {

  const { videoId } = props.match.params;

  const [tickData, setTickData] = useState({});
  const [lyricData, setLyricData] = useState({});
  const [partyId] = useState(getRandInt(0, 1e6));

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
      <MusicBarsWrapper tickData={tickData} partyId={partyId}/>
      <VideoPlayer videoId={videoId} onPlay={onPlay}/>
      <BottomPartyIdBar partyId={partyId}/>
    </div>
  );
};

export default PartyPage;
