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
  sendSongAdvance,
  sendSongLyrics,
  sendQueueAdd,
  sendQueueRemove,
  sendQueueReorder,
  sendPingReply,
} from "../logic/WebsocketHandling";
import MusicBars from "../components/MusicBars";
import QueuePanel from "../components/QueuePanel";

const PartyPage = () => {
  const routerState = useLocation().state;
  const { songId, slug } = useParams();

  const [tickData, setTickData] = useState({});
  const [partyId, setPartyId] = useState(routerState?.partyId ?? undefined);
  const [currentUserName] = useState(routerState?.currentUserName ?? "Host");
  const [isHost] = useState(routerState?.isHost ?? true);

  // Auto-create a party on mount if we don't already have one
  useEffect(() => {
    if (partyId) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${apiUrl}/parties`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner: currentUserName }),
        });
        const json = await resp.json();
        const id = json.data?.partyId ?? json.partyId;
        if (!cancelled && id) setPartyId(id);
      } catch (e) {
        console.error("Failed to auto-create party", e);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [iframePlayer, setIframePlayer] = useState(null);
  const [thumbnailUrl, setThumbnailUrl] = useState();
  const [videoId, setVideoId] = useState();

  const navigate = useNavigate();

  const [error, setError] = useState(false);
  const [hitNotesByPlayer, setHitNotesByPlayer] = useState({});
  const [setOnProcessing, setSetOnProcessing] = useState();
  const [wss, setWss] = useState();
  const [micActive, setMicActive] = useState(false);
  const stopMicRef = useRef(null);

  const [queue, setQueue] = useState([]);
  const [serverScores, setServerScores] = useState(null);
  const [songEnded, setSongEnded] = useState(false);
  const [endScores, setEndScores] = useState([]); // [{username, score, cumulativeScore}]
  const [countdownProgress, setCountdownProgress] = useState(0); // 0..1
  const [nextSongInfo, setNextSongInfo] = useState(null); // {songId, artist, title} from server
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
  const partyIdRef = useRef(partyId);
  partyIdRef.current = partyId;
  const currentUserNameRef = useRef(currentUserName);
  currentUserNameRef.current = currentUserName;

  // Throttle counter for video:time
  const videoTimeFrameCount = useRef(0);

  // Countdown start time for the score screen
  const countdownStartRef = useRef(null);

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
            const player = iframePlayerRef.current;
            if (w && isHostRef.current && player) {
              // Throttle to ~3/sec: rAF runs at ~60fps, so send every ~20 frames
              videoTimeFrameCount.current++;
              if (videoTimeFrameCount.current >= 20) {
                videoTimeFrameCount.current = 0;
                sendVideoTimeV2(w, {
                  videoTime,
                  isPlaying: player.getPlayerState() === 1,
                });
              }
              // Also keep legacy for backward compat
              sendVideoTime(w, songId, videoTime, player.getPlayerState() === 1);
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
              nickname: currentUserNameRef.current,
              partyId: partyIdRef.current ?? null,
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
  }, [songId, slug, navigate]);

  // Join singing — init microphone on demand
  const handleJoinSinging = useCallback(async () => {
    if (micActive) return;
    try {
      const result = await initMicInput();
      stopMicRef.current = result.stopMicInput;
      setSetOnProcessing(() => result.setOnProcessing);
      setMicActive(true);
    } catch (e) {
      console.warn("Microphone access denied or unavailable:", e.message);
    }
  }, [micActive]);

  // Leave singing — stop microphone
  const handleLeaveSinging = useCallback(() => {
    stopMicRef.current?.();
    stopMicRef.current = null;
    setSetOnProcessing(undefined);
    setMicActive(false);
  }, []);

  // Stop mic on unmount
  useEffect(() => {
    return () => { stopMicRef.current?.(); };
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
          iframePlayer?.playVideo?.();
        } else {
          iframePlayer?.pauseVideo?.();
        }
        if (jsonObj.data.songId !== songId) {
          navigate(`/sing/${jsonObj.data.songId}`);
        }
        if (Math.abs(jsonObj.data.videoTime - (iframePlayer?.getCurrentTime?.() ?? 0)) > 0.2) {
          iframePlayer?.seekTo?.(jsonObj.data.videoTime);
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
        // Server sends { players: [{username, score, cumulativeScore}, ...] }
        const players = jsonObj.data.players ?? jsonObj.data.scores ?? [];
        const scoresMap = {};
        for (const p of players) {
          scoresMap[p.username] = p.cumulativeScore ?? p.score ?? 0;
        }
        setServerScores(scoresMap);
      }

      if (jsonObj.type === "party:song_started") {
        const s = jsonObj.data?.currentSong ?? jsonObj.data;
        if (s?.songId && s.songId !== songId) {
          const nextSlug = urlEscapedTitle(s.artist, s.title);
          navigate(`/sing/${nextSlug}/${s.songId}`, {
            state: { partyId, currentUserName, isHost },
          });
        }
      }

      if (jsonObj.type === "party:song_ended") {
        const scores = jsonObj.data?.scores ?? [];
        setEndScores(scores.sort((a, b) => (b.cumulativeScore ?? b.score) - (a.cumulativeScore ?? a.score)));
        setNextSongInfo(jsonObj.data?.nextSong ?? null);
        setSongEnded(true);
        countdownStartRef.current = performance.now();
        setCountdownProgress(0);
      }

      if (jsonObj.type === "video:time" && !isHost) {
        if (jsonObj.data.isPlaying) {
          iframePlayer?.playVideo?.();
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

  // When the YouTube video ends, signal song:end to the server
  const handleVideoEnd = useCallback(() => {
    if (wss && isHost) {
      sendSongEnd(wss);
    }
    // The score overlay is shown when party:song_ended arrives from the server.
    // If there's no WS (solo mode), show it directly.
    if (!wss) {
      setSongEnded(true);
      countdownStartRef.current = performance.now();
      setCountdownProgress(0);
    }
  }, [wss, isHost]);

  // Smooth countdown — runs via rAF, auto-advances when complete
  const COUNTDOWN_DURATION = 4000; // ms
  useEffect(() => {
    if (!songEnded || !countdownStartRef.current) return;
    let rafId;
    const tick = () => {
      const elapsed = performance.now() - countdownStartRef.current;
      const progress = Math.min(1, elapsed / COUNTDOWN_DURATION);
      setCountdownProgress(progress);
      if (progress >= 1) {
        // Time's up — advance
        setSongEnded(false);
        if (wss && isHost) {
          sendSongAdvance(wss);
        }
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [songEnded, wss, isHost]);

  return (
    <div className="min-h-screen">
      <BackgroundImage thumbnailUrl={thumbnailUrl} />

      <BottomPartyIdBar
        partyId={partyId}
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
        {/* Left sidebar: join + scores */}
        <div className="lg:w-48 flex-shrink-0 space-y-3">
          {!micActive ? (
            <button
              onClick={handleJoinSinging}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-neon-green/10 text-neon-green hover:bg-neon-green/20 border border-neon-green/30 hover:border-neon-green/60 transition-all text-sm font-semibold"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
              Join singing
            </button>
          ) : (
            <button
              onClick={handleLeaveSinging}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/60 transition-all text-sm font-semibold"
            >
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              Leave singing
            </button>
          )}
          {serverScores && (
            <div className="bg-surface-light/80 rounded-lg p-3 backdrop-blur-sm">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Scores</div>
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
          <VideoPlayer videoId={videoId} onPlayerObject={setIframePlayer} onEnd={handleVideoEnd} />
        </div>

        {/* Right sidebar: queue + similar */}
        <div className="lg:w-64 flex-shrink-0 space-y-4">
          <QueuePanel
            queue={queue}
            isHost={isHost}
            onAdd={handleQueueAdd}
            onRemove={handleQueueRemove}
            onReorder={handleQueueReorder}
          />

          {similarSongs.length > 0 && (
            <div className="bg-surface-light/80 rounded-lg border border-surface-lighter p-3 backdrop-blur-sm">
              <h3 className="text-white font-bold text-sm mb-2">Similar Songs</h3>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {similarSongs.slice(0, 8).map((song, i) => {
                  const local = song.localMatch;
                  return (
                    <div key={i} className="flex items-center gap-2 group">
                      <div className="flex-1 min-w-0 text-sm">
                        <div className="text-gray-300 truncate">{song.name ?? song.title}</div>
                        <div className="text-gray-500 text-xs truncate">{song.artist?.name ?? song.artist}</div>
                      </div>
                      {local && (
                        <button
                          onClick={() => handleQueueAdd(local)}
                          className="flex-shrink-0 w-7 h-7 rounded-full bg-neon-green/10 text-neon-green hover:bg-neon-green/25 border border-neon-green/30 hover:border-neon-green/60 flex items-center justify-center text-lg leading-none transition-all opacity-60 group-hover:opacity-100"
                          title={`Add ${local.title} to queue`}
                        >
                          +
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Song ended overlay */}
      {songEnded && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center">
          <div className="max-w-lg w-full mx-4 text-center">
            {/* Title */}
            <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta mb-8 drop-shadow-[0_0_30px_rgba(0,229,255,0.5)]">
              Song Complete!
            </h2>

            {/* Leaderboard */}
            {endScores.length > 0 && (
              <div className="space-y-3 mb-8">
                {endScores.map((player, i) => {
                  const medals = ["\u{1F451}", "\u{1F948}", "\u{1F949}"];
                  const medal = medals[i] ?? `#${i + 1}`;
                  const colors = [
                    "from-yellow-500/20 to-amber-600/20 border-yellow-500/60 shadow-[0_0_20px_rgba(234,179,8,0.3)]",
                    "from-gray-300/15 to-gray-400/15 border-gray-400/50",
                    "from-amber-700/15 to-orange-800/15 border-amber-700/40",
                  ];
                  const colorClass = colors[i] ?? "from-surface to-surface border-surface-lighter";
                  const scoreColors = ["text-yellow-400", "text-gray-300", "text-amber-600"];
                  const scoreColor = scoreColors[i] ?? "text-neon-cyan";
                  const maxScore = endScores[0]?.score || 1;
                  const barWidth = Math.max(8, (player.score / maxScore) * 100);

                  return (
                    <div
                      key={player.username}
                      className={`relative rounded-xl border bg-gradient-to-r ${colorClass} overflow-hidden`}
                      style={{ animationDelay: `${i * 150}ms` }}
                    >
                      {/* Score bar background */}
                      <div
                        className="absolute inset-y-0 left-0 bg-white/5 transition-all duration-1000 ease-out"
                        style={{ width: `${barWidth}%` }}
                      />
                      <div className="relative flex items-center gap-4 px-5 py-4">
                        <span className="text-2xl w-8 text-center flex-shrink-0">{medal}</span>
                        <div className="flex-1 text-left min-w-0">
                          <div className={`font-bold truncate ${i === 0 ? "text-xl text-white" : "text-base text-gray-200"}`}>
                            {player.username}
                          </div>
                          {player.cumulativeScore > player.score && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              Total: {player.cumulativeScore.toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className={`font-mono font-black text-right flex-shrink-0 ${i === 0 ? "text-3xl" : "text-xl"} ${scoreColor}`}>
                          {player.score.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Next up + countdown */}
            <div className="flex flex-col items-center gap-4">
              {/* Next song info */}
              {(() => {
                const next = queue.length > 0 ? queue[0] : nextSongInfo;
                if (next?.title) {
                  return (
                    <div className="text-gray-400">
                      Up next: <span className="text-neon-magenta font-semibold">{next.title}</span>
                      <span className="text-gray-500"> - {next.artist}</span>
                    </div>
                  );
                }
                return <div className="text-gray-500">No more songs</div>;
              })()}

              <div className="flex items-center gap-4">
                {/* Abort button */}
                <button
                  onClick={() => {
                    setSongEnded(false);
                    countdownStartRef.current = null;
                  }}
                  className="px-4 py-2 rounded-lg bg-surface-lighter/80 text-gray-300 hover:bg-surface-lighter hover:text-white border border-surface-lighter hover:border-gray-500 transition-all text-sm"
                >
                  Stay here
                </button>

                {/* Countdown circle */}
                <div className="relative w-14 h-14 flex-shrink-0">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                    <circle
                      cx="28" cy="28" r="24" fill="none"
                      stroke="url(#countdownGradient)" strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 24}
                      strokeDashoffset={2 * Math.PI * 24 * countdownProgress}
                    />
                    <defs>
                      <linearGradient id="countdownGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#00e5ff" />
                        <stop offset="100%" stopColor="#d500f9" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg">
                    {Math.ceil((1 - countdownProgress) * 4)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartyPage;
