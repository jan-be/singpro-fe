import React, { useEffect, useState } from 'react';
import BackgroundImage from "../components/BackgroundImage";
import Lyrics from "../components/Lyrics";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import MusicBarsWrapper from "../components/MusicBarsWrapper";
import BottomPartyIdBar from "../components/BottomPartyIdBar";
import { getRandInt, urlEscapedTitle } from "../logic/RandomUtility";
import { apiUrl } from "../GlobalConsts";
import { useHistory } from "react-router-dom";

const PartyPage = props => {

  const { songId, slug } = props.match.params;

  const [tickData, setTickData] = useState({});
  const [lyricData, setLyricData] = useState({});
  const [partyId] = useState(getRandInt(1e5, 1e6));

  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [videoId, setVideoId] = useState("");

  const history = useHistory();

  useEffect(() => {
    (async () => {
      let resp = await fetch(`${apiUrl}/songs/${songId}`);
      let jsonObj = await resp.json();

      let correctSlug = urlEscapedTitle(jsonObj.data.artist, jsonObj.data.title);
      if (!slug || slug !== correctSlug) {
        history.replace(`/sing/${correctSlug}/${songId}`);
      }

      if (jsonObj.data && jsonObj.data.lyrics) {
        let e = await readTextFile(jsonObj.data.lyrics);
        setLyricData(e);
        setTickData(getTickData(e, 0));

        setThumbnailUrl(jsonObj.data.thumbnailUrl);
        setVideoId(jsonObj.data.videoId);
      }
    })();
  }, [songId, slug, history]);

  const onPlayerObject = player => {
    setInterval(() => {
      if (lyricData) {
        setTickData(getTickData(lyricData, player.getCurrentTime()));
      }
    }, 10);
  };

  return (
    <div>
      <BackgroundImage thumbnailUrl={thumbnailUrl}/>
      <Lyrics tickData={tickData}/>
      <MusicBarsWrapper tickData={tickData} partyId={partyId}/>
      <VideoPlayer videoId={videoId} onPlayerObject={onPlayerObject}/>
      <BottomPartyIdBar partyId={partyId}/>
    </div>
  );
};

export default PartyPage;
