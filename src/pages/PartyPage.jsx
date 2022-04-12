import React, { useEffect, useState } from 'react';
import BackgroundImage from "../components/BackgroundImage";
import Lyrics from "../components/Lyrics";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import BottomPartyIdBar from "../components/BottomPartyIdBar";
import { urlEscapedTitle } from "../logic/RandomUtility";
import { apiUrl } from "../GlobalConsts";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CssBaseline, Grid } from "@mui/material";
import { initMicInput } from "../logic/MicrophoneInput";
import { getAndSetHitNotesByPlayer } from "../logic/MicInputToTick";
import { openWebSocket, sendLastNote } from "../logic/WebsocketHandling";
import PlayerScoreList from "../components/PlayerScoreList";
import MusicBars from "../components/MusicBars";

const PartyPage = () => {

  const routerState = useLocation().state;

  const { songId, slug } = useParams();

  const [tickData, setTickData] = useState({});
  const [partyId, setPartyId] = useState(routerState?.partyId ?? null);
  const [currentUserName] = useState(routerState?.currentUserName ?? "Host");

  const [player, setPlayer] = useState({});

  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [videoId, setVideoId] = useState("");

  const navigate = useNavigate();

  const [error, setError] = useState(false);

  const [hitNotesByPlayer, setHitNotesByPlayer] = useState({});
  const [setOnProcessing, setSetOnProcessing] = useState(null);
  const [wss, setWss] = useState();

  useEffect(() => {
    let animationFun;
    (async () => {
      try {
        let resp = await fetch(`${apiUrl}/songs/${songId}`);
        let jsonObj = await resp.json();

        let correctSlug = urlEscapedTitle(jsonObj.data.artist, jsonObj.data.title);
        if (!slug || slug !== correctSlug) {
          navigate(`/sing/${correctSlug}/${songId}`, { replace: true });
        }

        if (jsonObj.data && jsonObj.data.lyrics) {
          let e = await readTextFile(jsonObj.data.lyrics);

          let tickData = getTickData(e, 0);
          if (jsonObj.data.gap) {
            tickData.lyricData.gap = jsonObj.data.gap;
          }

          setTickData(tickData);
          animationFun = () => {
            setTickData(getTickData(e, player?.getCurrentTime?.() ?? 0));
            window.requestAnimationFrame(animationFun);
          };
          animationFun();

          setThumbnailUrl(jsonObj.data.thumbnailUrl);
          setVideoId(jsonObj.data.videoId);
        }
      } catch (e) {
        setError(true);
      }
    })();
    return () => {animationFun = () => {};};
  }, [songId, slug, navigate, player]);

  useEffect(() => {
    let setOnProcessing, stopMicInput;

    (async () => {
      ({ setOnProcessing, stopMicInput } = await initMicInput());
      setSetOnProcessing(() => setOnProcessing);
    })();

    return () => {
      stopMicInput && stopMicInput();
    };
  }, []);

  useEffect(() => {
    setOnProcessing && setOnProcessing(msg => {
      let { note } = msg.data;
      tickData.lyricRef && setHitNotesByPlayer(oldData => getAndSetHitNotesByPlayer(tickData, oldData, note, currentUserName));
      if (wss) {
        sendLastNote(wss, note);
      }
    });
  }, [tickData, setOnProcessing, wss, currentUserName]);

  useEffect(() => {
    if (partyId) {
      let wssTmp;
      (async () => {
        wssTmp = await openWebSocket({ isHost: true, partyId, username: currentUserName });

        setWss(wssTmp);
      })();

      return () => {
        wssTmp && wssTmp.close();
      };
    }
  }, [partyId, currentUserName]);
  useEffect(() => {
    if (wss) {
      wss.onmessage = msg => {
        let jsonObj = JSON.parse(msg.data);

        if (jsonObj.type === "note" && tickData.currentLine) {
          setHitNotesByPlayer(oldData =>
            getAndSetHitNotesByPlayer(tickData, oldData, jsonObj.data.note, jsonObj.data.username));
        }
      };
    }
  }, [tickData, wss]);

  return (
    <div>
      <CssBaseline/>
      <BackgroundImage thumbnailUrl={thumbnailUrl}/>

      <BottomPartyIdBar partyId={partyId} setPartyId={setPartyId} songId={songId} gapData={{
        gap: tickData.lyricData?.gap,
        defaultGap: tickData.lyricData?.defaultGap,
        setGap: gap => tickData.lyricData.gap = gap,
      }}/>

      {error ? <b>Error: No data from the API</b> : null}

      <Lyrics tickData={tickData}/>

      <Grid container>
        <Grid item xs={12} md={2}>
          <PlayerScoreList hitNotesByPlayer={hitNotesByPlayer}/>
        </Grid>
        <Grid item xs={12} md={8}>
          <MusicBars tickData={tickData} hitNotesByPlayer={hitNotesByPlayer}/>
          <VideoPlayer videoId={videoId} onPlayerObject={setPlayer}/>
        </Grid>
      </Grid>
    </div>
  );
};

export default PartyPage;
