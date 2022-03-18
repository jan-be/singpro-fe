import React, { useEffect, useState } from 'react';
import BackgroundImage from "../components/BackgroundImage";
import Lyrics from "../components/Lyrics";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import MusicBarsWrapper from "../components/MusicBarsWrapper";
import BottomPartyIdBar from "../components/BottomPartyIdBar";
import { getRandInt, urlEscapedTitle } from "../logic/RandomUtility";
import { apiUrl } from "../GlobalConsts";
import { useNavigate, useParams } from "react-router-dom";

const PartyPage = () => {

  const { songId, slug } = useParams();

  const [tickData, setTickData] = useState({});
  const [partyId] = useState(getRandInt(1e5, 1e6));

  const [player, setPlayer] = useState({});

  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [videoId, setVideoId] = useState("");

  const navigate = useNavigate();

  const [error, setError] = useState(false);

  useEffect(() => {
    let interval;
    (async () => {
      try {
        let resp = await fetch(`${apiUrl}/songs/${songId}`);
        let jsonObj = await resp.json();

        let correctSlug = urlEscapedTitle(jsonObj.data.artist, jsonObj.data.title);
        if (!slug || slug !== correctSlug) {
          console.log("alarm", navigate);
          navigate(`/sing/${correctSlug}/${songId}`, {replace: true});
        }

        if (jsonObj.data && jsonObj.data.lyrics) {
          let e = await readTextFile(jsonObj.data.lyrics);

          setTickData(getTickData(e, 0));
          interval = setInterval(() => {
            setTickData(getTickData(e, player?.getCurrentTime?.() ?? 0));

          }, 10);

          setThumbnailUrl(jsonObj.data.thumbnailUrl);
          setVideoId(jsonObj.data.videoId);
        }
      } catch (e) {
        setError(true);
      }
    })();
    return () => clearInterval(interval);
  }, [songId, slug, navigate, player]);

  let errorField = error ? <b>Error: No data from the API</b> : null;

  return (
    <div>
      {errorField}
      <BackgroundImage thumbnailUrl={thumbnailUrl}/>
      <Lyrics tickData={tickData}/>
      <MusicBarsWrapper tickData={tickData} partyId={partyId}/>
      <VideoPlayer videoId={videoId} onPlayerObject={setPlayer}/>
      <BottomPartyIdBar partyId={partyId}/>
    </div>
  );
};

export default PartyPage;
