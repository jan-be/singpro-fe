import React, { useEffect, useRef, useState, useCallback } from "react";
import BackgroundImage from "../components/BackgroundImage";
import Lyrics from "../components/Lyrics";
import { getTickData, readTextFile } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import BottomPartyIdBar from "../components/BottomPartyIdBar";
import { urlEscapedTitle } from "../logic/RandomUtility";
import { apiUrl } from "../GlobalConsts";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { initMicInput } from "../logic/MicrophoneInput";
import { getAndSetHitNotesByPlayer } from "../logic/MicInputToTick";
import {
  openWebSocket,
  sendLastNote,
  sendVideoTime,
  sendPartyJoin,
  sendPlayerNote,
  sendVideoTimeV2,
  sendSongStart,
  sendSongEnd,
  sendSongLyrics,
  sendQueueAdd,
  sendQueueRemove,
  sendQueueReorder,
  sendPingReply,
} from "../logic/WebsocketHandling";
import PlayerScoreList from "../components/PlayerScoreList";
import MusicBars from "../components/MusicBars";
import QueuePanel from "../components/QueuePanel";

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

  const [queue, setQueue] = useState([]);
  const [serverScores, setServerScores] = useState(null);
  const [songEnded, setSongEnded] = useState(false);
  const [similarSongs, setSimilarSongs] = useState([]);

  // Refs for values accessed in the animation loop
  const iframePlayerRef = useRef(iframePlayer);
  iframePlayerRef.current = iframePlayer;
  const wssRef = useRef(wss);
  wssRef.current = wss;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  // Gap stored as ref because GapCorrector mutates it at high frequency
  const gapRef = useRef(undefined);

  // Store songInfo for listen recording
  const songInfoRef = useRef(null);

  // Throttle counter for video:time
  const videoTimeFrameCount = useRef(0);

  // Fetch song data and start animation loop
  useEffect(() => {
    let rafId;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${apiUrl}/songs/${songId}`);
        const jsonObj = await resp.json();

        if (cancelled) return;

        const correctSlug = urlEscapedTitle(jsonObj.data.artist, jsonObj.data.title);
        if (slug !== correctSlug) {
          navigate(`/sing/${correctSlug}/${songId}`, { replace: true });
        }

        songInfoRef.current = jsonObj.data;

        // Fetch similar songs
        if (jsonObj.data.artist && jsonObj.data.title) {
          fetch(`${apiUrl}/similar?artist=${encodeURIComponent(jsonObj.data.artist)}&track=${encodeURIComponent(jsonObj.data.title)}`)
            .then(r => r.json())
            .then(j => { if (!cancelled) setSimilarSongs(j.data ?? []); })
            .catch(() => {});
        }

        if (jsonObj.data && jsonObj.data.lyrics) {
          const lyricData = await readTextFile(jsonObj.data.lyrics);

          if (cancelled) return;

          if (jsonObj.data.gap) {
            lyricData.gap = jsonObj.data.gap;
          }
          gapRef.current = lyricData.gap;

          setTickData(getTickData(lyricData, 0));

          // Send lyrics to server if we have a ws connection
          const trySendLyrics = () => {
            const w = wssRef.current;
            if (w && w.readyState === WebSocket.OPEN) {
              sendSongLyrics(w, { lyrics: jsonObj.data.lyrics, gap: lyricData.gap });
            }
          };
          // Try immediately and again after a short delay (ws might not be ready yet)
          trySendLyrics();
          setTimeout(trySendLyrics, 2000);

          const animate = () => {
            const videoTime = iframePlayerRef.current?.getCurrentTime?.() ?? 0;
            lyricData.gap = gapRef.current;
            setTickData(getTickData(lyricData, videoTime));

            const w = wssRef.current;
            if (w && isHostRef.current) {
              // Throttle to ~3/sec: rAF runs at ~60fps, so send every ~20 frames
              videoTimeFrameCount.current++;
              if (videoTimeFrameCount.current >= 20) {
                videoTimeFrameCount.current = 0;
                sendVideoTimeV2(w, {
                  videoTime,
                  isPlaying: iframePlayerRef.current.getPlayerState() === 1,
                });
              }
              // Also keep legacy for backward compat
              sendVideoTime(w, songId, videoTime, iframePlayerRef.current.getPlayerState() === 1);
            }
            rafId = window.requestAnimationFrame(animate);
          };
          rafId = window.requestAnimationFrame(animate);

          setThumbnailUrl(jsonObj.data.thumbnailUrl);
          setVideoId(jsonObj.data.videoId);

          // Record listen
          const sessionId = sessionStorage.getItem("sessionId") ?? crypto.randomUUID();
          sessionStorage.setItem("sessionId", sessionId);
          fetch(`${apiUrl}/listens`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              artist: jsonObj.data.artist,
              title: jsonObj.data.title,
              songId,
              videoId: jsonObj.data.videoId,
              nickname: currentUserName,
              partyId: partyId ?? null,
            }),
          }).catch(() => {});
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
  }, [songId, slug, navigate, partyId, currentUserName]);

  // Init microphone
  useEffect(() => {
    let stopped = false;
    let cleanup;

    (async () => {
      const result = await initMicInput();
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

  // Process mic input
  useEffect(() => {
    setOnProcessing && setOnProcessing(msg => {
      const { note } = msg.data;
      const videoTime = iframePlayerRef.current?.getCurrentTime?.() ?? 0;

      tickData.lyricRef && setHitNotesByPlayer(oldData =>
        getAndSetHitNotesByPlayer(tickData, oldData, note, currentUserName));

      if (wss) {
        sendLastNote(wss, note);
        sendPlayerNote(wss, { note, videoTime });
      }
    });
  }, [tickData, setOnProcessing, wss, currentUserName]);

  // Open WebSocket
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

      // Also send v2 join
      sendPartyJoin(wsInstance, { partyId, username: currentUserName, isShowingVideo: true });

      // Send song start
      if (songInfoRef.current) {
        sendSongStart(wsInstance, {
          songId,
          artist: songInfoRef.current.artist,
          title: songInfoRef.current.title,
          videoId: songInfoRef.current.videoId,
        });
      }

      setWss(wsInstance);
    })();

    return () => {
      closed = true;
      wsInstance?.close();
    };
  }, [partyId, currentUserName, isHost, songId]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!wss) return;
    const handler = msg => {
      const jsonObj = JSON.parse(msg.data);

      // Legacy v1
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

      // v2 messages
      if (jsonObj.type === "player:note_echo" && tickData.currentLine) {
        setHitNotesByPlayer(oldData =>
          getAndSetHitNotesByPlayer(tickData, oldData, jsonObj.data.note, jsonObj.data.username));
      }

      if (jsonObj.type === "party:queue_updated") {
        setQueue(jsonObj.data.queue ?? []);
      }

      if (jsonObj.type === "party:scores_updated") {
        setServerScores(jsonObj.data.scores ?? jsonObj.data);
      }

      if (jsonObj.type === "party:song_started" && !isHost) {
        const s = jsonObj.data;
        if (s.songId !== songId) {
          navigate(`/sing/${s.songId}`, { state: { partyId, currentUserName, isHost: false } });
        }
      }

      if (jsonObj.type === "party:song_ended") {
        setSongEnded(true);
      }

      if (jsonObj.type === "video:time" && !isHost) {
        if (jsonObj.data.isPlaying) {
          iframePlayer.playVideo?.();
        } else {
          iframePlayer?.pauseVideo?.();
        }
        if (Math.abs(jsonObj.data.videoTime - (iframePlayer?.getCurrentTime?.() ?? 0)) > 0.2) {
          iframePlayer?.seekTo?.(jsonObj.data.videoTime);
        }
      }

      if (jsonObj.type === "ping:request") {
        sendPingReply(wss, { serverTs: jsonObj.data.serverTs });
      }

      if (jsonObj.type === "error") {
        console.error("WS error:", jsonObj.data);
      }
    };
    wss.onmessage = handler;
    return () => { wss.onmessage = null; };
  }, [tickData, wss, isHost, iframePlayer, navigate, songId, partyId, currentUserName]);

  // Queue handlers
  const handleQueueAdd = useCallback((song) => {
    if (wss) sendQueueAdd(wss, { songId: song.songId, artist: song.artist, title: song.title, videoId: song.videoId });
  }, [wss]);

  const handleQueueRemove = useCallback((index) => {
    if (wss) sendQueueRemove(wss, { index });
  }, [wss]);

  const handleQueueReorder = useCallback((from, to) => {
    if (wss) sendQueueReorder(wss, { from, to });
  }, [wss]);

  return (
    <div className="min-h-screen">
      <BackgroundImage thumbnailUrl={thumbnailUrl} />

      <BottomPartyIdBar
        partyId={partyId}
        setPartyId={setPartyId}
        songId={songId}
        gapData={{
          gap: tickData.lyricData?.gap,
          defaultGap: tickData.lyricData?.defaultGap,
          setGap: gap => { gapRef.current = gap; },
        }}
      />

      {error && (
        <div className="text-center py-4 text-red-400 font-bold">
          Error: No data from the API
        </div>
      )}

      <Lyrics tickData={tickData} />

      <div className="flex flex-col lg:flex-row gap-4 p-4">
        {/* Left sidebar: scores */}
        <div className="lg:w-48 flex-shrink-0">
          <PlayerScoreList hitNotesByPlayer={hitNotesByPlayer} />
          {serverScores && (
            <div className="mt-3 bg-surface-light/80 rounded-lg p-3 backdrop-blur-sm">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Server Scores</div>
              {Object.entries(serverScores).map(([name, score]) => (
                <div key={name} className="flex justify-between text-sm py-1">
                  <span className="text-white">{name}</span>
                  <span className="text-neon-green font-mono">{score}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center: music bars + video */}
        <div className="flex-1 min-w-0">
          <MusicBars tickData={tickData} hitNotesByPlayer={hitNotesByPlayer} />
          <VideoPlayer videoId={videoId} onPlayerObject={setIframePlayer} />
        </div>

        {/* Right sidebar: queue + similar */}
        <div className="lg:w-64 flex-shrink-0 space-y-4">
          {partyId && (
            <QueuePanel
              queue={queue}
              isHost={isHost}
              onAdd={handleQueueAdd}
              onRemove={handleQueueRemove}
              onReorder={handleQueueReorder}
            />
          )}

          {similarSongs.length > 0 && (
            <div className="bg-surface-light/80 rounded-lg border border-surface-lighter p-3 backdrop-blur-sm">
              <h3 className="text-white font-bold text-sm mb-2">Similar Songs</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {similarSongs.slice(0, 8).map((song, i) => (
                  <div key={i} className="text-sm">
                    <div className="text-gray-300 truncate">{song.name ?? song.title}</div>
                    <div className="text-gray-500 text-xs truncate">{song.artist?.name ?? song.artist}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Song ended overlay */}
      {songEnded && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
          <div className="bg-surface-light rounded-xl p-8 max-w-md w-full mx-4 text-center border border-surface-lighter">
            <h2 className="text-3xl font-bold text-white mb-4">Song Complete!</h2>
            {serverScores && (
              <div className="mb-6 space-y-2">
                {Object.entries(serverScores)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, score], i) => (
                    <div key={name} className="flex justify-between items-center py-2 px-4 rounded bg-surface">
                      <span className="text-white">
                        {i === 0 && <span className="text-neon-green mr-2">&#9733;</span>}
                        {name}
                      </span>
                      <span className="text-neon-cyan font-mono font-bold">{score}</span>
                    </div>
                  ))}
              </div>
            )}
            {queue.length > 0 && (
              <p className="text-gray-400 mb-4">
                Next up: <span className="text-neon-magenta">{queue[0].title}</span>
              </p>
            )}
            <button
              onClick={() => {
                setSongEnded(false);
                if (queue.length > 0) {
                  const next = queue[0];
                  const nextSlug = urlEscapedTitle(next.artist, next.title);
                  navigate(`/sing/${nextSlug}/${next.songId}`, {
                    state: { partyId, currentUserName, isHost },
                  });
                }
              }}
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-purple text-white font-bold hover:shadow-[0_0_25px_rgba(0,229,255,0.4)] transition-all cursor-pointer"
            >
              {queue.length > 0 ? "Next Song" : "Continue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartyPage;
