import React, { useEffect, useRef, useState } from 'react';
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
import { openWebSocket, sendLastNote, sendVideoTime } from "../logic/WebsocketHandling";
import PlayerScoreList from "../components/PlayerScoreList";
import MusicBars from "../components/MusicBars";

const PartyPage = () => {

  const routerState = useLocation().state;

  const { songId, slug } = useParams();

  const [tickData, setTickData] = useState({});
  const [partyId, setPartyId] = useState(routerState?.partyId ?? undefined);
  const [currentUserName] = useState(routerState?.currentUserName ?? "Host");
  const [isHost] = useState(routerState?.isHost ?? true);

  const [iframePlayer, setIframePlayer] = useState({});

  const [thumbnailUrl, setThumbnailUrl] = useState();
  const [videoId, setVideoId] = useState();

  const navigate = useNavigate();

  const [error, setError] = useState(false);

  const [hitNotesByPlayer, setHitNotesByPlayer] = useState({});
  const [setOnProcessing, setSetOnProcessing] = useState();
  const [wss, setWss] = useState();

  // Refs for values accessed in the animation loop (avoids stale closures & re-running the effect)
  const iframePlayerRef = useRef(iframePlayer);
  iframePlayerRef.current = iframePlayer;
  const wssRef = useRef(wss);
  wssRef.current = wss;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  // Gap stored as ref because GapCorrector mutates it at high frequency during slider drag.
  // It's read every animation frame by getTickData, so it doesn't need to trigger re-renders.
  const gapRef = useRef(undefined);

  useEffect(() => {
    let rafId;
    let cancelled = false;
    (async () => {
      try {
        let resp = await fetch(`${apiUrl}/songs/${songId}`);
        let jsonObj = await resp.json();

        if (cancelled) return;

        let correctSlug = urlEscapedTitle(jsonObj.data.artist, jsonObj.data.title);
        if (slug !== correctSlug) {
          navigate(`/sing/${correctSlug}/${songId}`, { replace: true });
        }

        if (jsonObj.data && jsonObj.data.lyrics) {
          let lyricData = await readTextFile(jsonObj.data.lyrics);

          if (cancelled) return;

          if (jsonObj.data.gap) {
            lyricData.gap = jsonObj.data.gap;
          }
          gapRef.current = lyricData.gap;

          setTickData(getTickData(lyricData, 0));

          const animate = () => {
            let videoTime = iframePlayerRef.current?.getCurrentTime?.() ?? 0;
            lyricData.gap = gapRef.current;
            setTickData(getTickData(lyricData, videoTime));
            let w = wssRef.current;
            if (w && isHostRef.current) {
              sendVideoTime(w, songId, videoTime, iframePlayerRef.current.getPlayerState() === 1);
            }
            rafId = window.requestAnimationFrame(animate);
          };
          rafId = window.requestAnimationFrame(animate);

          setThumbnailUrl(jsonObj.data.thumbnailUrl);
          setVideoId(jsonObj.data.videoId);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [songId, slug, navigate]);

  useEffect(() => {
    let stopped = false;
    let cleanup;

    (async () => {
      let result = await initMicInput();
      if (stopped) {
        result.stopMicInput();
        return;
      }
      cleanup = result.stopMicInput;
      setSetOnProcessing(() => result.setOnProcessing);
    })();

    return () => {
      stopped = true;
      cleanup?.();
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
    if (!partyId) return;

    let closed = false;
    let wsInstance;

    (async () => {
      wsInstance = await openWebSocket({ isHost, isShowingVideo: true, partyId, username: currentUserName });
      if (closed) {
        wsInstance.close();
        return;
      }
      setWss(wsInstance);
    })();

    return () => {
      closed = true;
      wsInstance?.close();
    };
  }, [partyId, currentUserName, isHost]);

  useEffect(() => {
    if (!wss) return;
    const handler = msg => {
      let jsonObj = JSON.parse(msg.data);

      if (jsonObj.type === "note" && tickData.currentLine) {
        setHitNotesByPlayer(oldData =>
          getAndSetHitNotesByPlayer(tickData, oldData, jsonObj.data.note, jsonObj.data.username));
      }

      if (jsonObj.type === "videoTime" && !isHost) {
        if (jsonObj.data.isPlaying) {
          iframePlayer.playVideo?.();
        } else {
          iframePlayer?.pauseVideo?.();
        }

        if (jsonObj.data.songId !== songId) {
          navigate(`/sing/${jsonObj.data.songId}`);
        }

        if (Math.abs(jsonObj.data.videoTime - iframePlayer?.getCurrentTime()) > 0.2) {
          iframePlayer?.seekTo(jsonObj.data.videoTime);
        }
      }
    };
    wss.onmessage = handler;
    return () => { wss.onmessage = null; };
  }, [tickData, wss, isHost, iframePlayer, navigate, songId]);

  return (
    <div>
      <CssBaseline/>
      <BackgroundImage thumbnailUrl={thumbnailUrl}/>

      <BottomPartyIdBar partyId={partyId} setPartyId={setPartyId} songId={songId} gapData={{
        gap: tickData.lyricData?.gap,
        defaultGap: tickData.lyricData?.defaultGap,
        setGap: gap => { gapRef.current = gap; },
      }}/>

      {error ? <b>Error: No data from the API</b> : null}

      <Lyrics tickData={tickData}/>

      <Grid container>
        <Grid size={{ xs: 12, md: 2 }}>
          <PlayerScoreList hitNotesByPlayer={hitNotesByPlayer}/>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <MusicBars tickData={tickData} hitNotesByPlayer={hitNotesByPlayer}/>
          <VideoPlayer videoId={videoId} onPlayerObject={setIframePlayer}/>
        </Grid>
      </Grid>
    </div>
  );
};

export default PartyPage;
