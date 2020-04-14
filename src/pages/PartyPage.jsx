import React, { useEffect, useState } from 'react';
import BackgroundImage from "../components/BackgroundImage";
import Lyrics from "../components/Lyrics";
import SelfAdjustingInterval from "../logic/SelfAdjustingInterval";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import MusicBarsWrapper from "../components/MusicBarsWrapper";
import BottomPartyIdBar from "../components/BottomPartyIdBar";
import { getRandInt } from "../logic/RandomUtility";
import { apiDomain } from "../GlobalConsts";

const PartyPage = props => {

  const { songId } = props.match.params;

  const [tickData, setTickData] = useState({});
  const [lyricData, setLyricData] = useState({});
  const [partyId] = useState(getRandInt(1e5, 1e6));

  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [videoId, setVideoId] = useState("");

  let ticker;

  useEffect(() => {
    (async () => {
      let resp = await fetch(`https://${apiDomain}/songs/${songId}`);
      let jsonObj = await resp.json();

      console.log(jsonObj)

      if (jsonObj.data && jsonObj.data.lyrics) {
        let e = await readTextFile(jsonObj.data.lyrics);
        setLyricData(e);
        setTickData(getTickData(e, 0));

        setThumbnailUrl(jsonObj.data.thumbnailUrl);
        setVideoId(jsonObj.data.videoId);
      }
    })();
  }, [songId]);

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
      <BackgroundImage thumbnailUrl={thumbnailUrl}/>
      <Lyrics tickData={tickData}/>
      <MusicBarsWrapper tickData={tickData} partyId={partyId}/>
      <VideoPlayer videoId={videoId} onPlay={onPlay}/>
      <BottomPartyIdBar partyId={partyId}/>
    </div>
  );
};

export default PartyPage;
