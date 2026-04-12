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
import PingIndicator from "../components/PingIndicator";
import ShareCard from "../components/ShareCard";

// --- Session persistence helpers ---
// Party session is stored in sessionStorage so page reloads / back-navigation
// don't lose the partyId, username, or host status.
const SESSION_KEY = 'singpro_party';

function savePartySession({ partyId, username, isHost }) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ partyId, username, isHost }));
}

export function loadPartySession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearPartySession() {
  sessionStorage.removeItem(SESSION_KEY);
}

const PartyPage = () => {
  const routerState = useLocation().state;
  const navigate = useNavigate();
  const { songId: urlSongId } = useParams();

  // Restore session from sessionStorage if router state is missing (e.g. page reload)
  const savedSession = loadPartySession();

  const [tickData, setTickData] = useState({});
  const [partyId, setPartyId] = useState(
    routerState?.partyId ?? savedSession?.partyId ?? undefined
  );
  const [currentUserName] = useState(
    routerState?.currentUserName ?? savedSession?.username ?? "Host"
  );
  const [isHost] = useState(
    routerState?.isHost ?? savedSession?.isHost ?? true
  );

  // Non-host joiners with an active party session should always wait for party:state
  // to tell them the current song — never trust the URL song ID, which could be wrong
  // (e.g. joiner navigated to the home page and clicked a different song).
  // Hosts always use the URL song ID since they're the ones picking songs.
  const initialSongId = isHost ? urlSongId : (
    (routerState?.partyId ?? savedSession?.partyId) ? 'none' : urlSongId
  );

  // activeSongId is state — it starts from the URL but updates in-place on song transitions
  const [activeSongId, setActiveSongId] = useState(initialSongId);
  const [showVideo, setShowVideo] = useState(() => {
    if (routerState?.isHost ?? savedSession?.isHost ?? true) return true; // host always
    try {
      const stored = localStorage.getItem('singpro_show_video');
      return stored === 'true'; // default false for joiners
    } catch { return false; }
  });

  const toggleVideo = useCallback(() => {
    setShowVideo(prev => {
      const next = !prev;
      try { localStorage.setItem('singpro_show_video', String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // Persist session whenever partyId becomes known
  useEffect(() => {
    if (partyId) {
      savePartySession({ partyId, username: currentUserName, isHost });
    }
  }, [partyId, currentUserName, isHost]);

  // Auto-create a party on mount if we don't already have one AND we are the host
  useEffect(() => {
    if (partyId || !isHost) return;
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

  // Clear stale player reference when joiner hides video.
  // Without this, the animation loop uses a dead player object instead of hostVideoTimeRef.
  useEffect(() => {
    if (!showVideo) {
      setIframePlayer(null);
    }
  }, [showVideo]);

  // Callback when YouTube player becomes ready. For joiners, seek to the host's
  // current position so the player doesn't start from 0.
  const handlePlayerReady = useCallback((playerObj) => {
    setIframePlayer(playerObj);
    if (!isHost && hostVideoTimeRef.current > 0) {
      playerObj.seekTo(getHostVideoTime(), true);
      if (hostIsPlayingRef.current) {
        playerObj.playVideo();
      }
    }
  }, [isHost]);

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
  const activeSongIdRef = useRef(activeSongId);
  activeSongIdRef.current = activeSongId;

  // Gap stored as ref because GapCorrector mutates it at high frequency
  const gapRef = useRef(undefined);

  // Store songInfo for listen recording
  const songInfoRef = useRef(null);
  const partyIdRef = useRef(partyId);
  partyIdRef.current = partyId;
  const currentUserNameRef = useRef(currentUserName);
  currentUserNameRef.current = currentUserName;

  // Ref for tickData so the mic callback always sees the latest without re-registering
  const tickDataRef = useRef(tickData);
  tickDataRef.current = tickData;

  // Store raw lyrics text + gap so we can send them to the server when WS connects
  const lyricsPayloadRef = useRef(null);

  // Track whether we've already sent song:start for the current activeSongId
  // to prevent duplicate sends across racing effects
  const sentSongStartForRef = useRef(null);

  // Throttle counter for video:time
  const videoTimeFrameCount = useRef(0);

  // Debounce tracking for non-host video sync
  const lastSeekRef = useRef(0); // timestamp of last seekTo call

  // Host video time received via WS — used by non-host joiners when video is hidden.
  // We also track the local timestamp of when it was received so we can interpolate
  // forward between updates (host broadcasts ~3x/sec, but mic fires ~50x/sec).
  const hostVideoTimeRef = useRef(0);
  const hostVideoTimeReceivedAtRef = useRef(0); // performance.now() timestamp

  // Whether the host says playback is active — used when local player is unavailable
  const hostIsPlayingRef = useRef(false);

  // Measured one-way network latency for this client (ms), sent back by server in ping:ack.
  // Used to compensate drift in syncJoinerPlayer so the sync loop doesn't react to
  // network delay as if it were real playback drift.
  const ownLatencyRef = useRef(0);

  // Per-player latency map for scoreboard display: { username -> latencyMs }
  const [playerLatencies, setPlayerLatencies] = useState({});

  /**
   * Get interpolated host video time — smooth monotonic clock for joiners.
   *
   * When a new WS update arrives, we only accept it if it moves time forward
   * (or if it's a legitimate rewind like a seek). This prevents the small
   * backward jumps caused by network jitter resetting the interpolation base
   * to a value behind what we'd already predicted.
   */
  const smoothHostTimeRef = useRef(0); // last value we returned — monotonic

  const getHostVideoTime = () => {
    const base = hostVideoTimeRef.current;
    if (!hostIsPlayingRef.current || !hostVideoTimeReceivedAtRef.current) return base;
    const elapsed = (performance.now() - hostVideoTimeReceivedAtRef.current) / 1000;
    const interpolated = base + elapsed;

    // Enforce monotonicity: never go backward by small amounts.
    // A large backward jump (>1s) is a legitimate seek — allow it.
    if (interpolated < smoothHostTimeRef.current &&
        smoothHostTimeRef.current - interpolated < 1) {
      return smoothHostTimeRef.current;
    }
    smoothHostTimeRef.current = interpolated;
    return interpolated;
  };

  // --- Joiner video sync: playback-rate drift correction ---
  // Adjusts playback rate to keep the joiner's YouTube player tightly synced
  // with the host. The call-mode audio issue is solved by MediaStreamTrackProcessor
  // (no AudioContext for mic), so playback rate changes are safe.
  //
  // Thresholds:
  //   drift > 3s    → hard seek (debounced)
  //   drift > 20ms  → speed up (1.25x) or slow down (0.75x)
  //   drift ≤ 20ms  → normal speed (1x)
  //
  // Ping compensation:
  //   The host's videoTime was sent some time ago. By the time the joiner receives
  //   and processes it, roughly one network RTT/2 has passed. Without compensation,
  //   the joiner sees hostTime as slightly stale, making drift appear negative
  //   (joiner appears behind), causing spurious 1.25x speed-ups even when perfectly
  //   in sync. We add ownLatencyRef (measured RTT/2) to hostTime before comparing.
  const playerStateRef = useRef(-1);

  const handleVideoStateChange = useCallback((state) => {
    if (isHost) return;
    playerStateRef.current = state;
  }, [isHost]);

  const syncJoinerPlayer = (player, hostTime) => {
    if (playerStateRef.current !== 1) return; // only while playing

    const localTime = player.getCurrentTime?.() ?? 0;
    // Compensate for one-way network latency: the host timestamp was created
    // ~latencyMs ago, so the "true" host time right now is slightly ahead.
    const compensatedHostTime = hostTime + ownLatencyRef.current / 1000;
    const drift = localTime - compensatedHostTime; // positive = ahead, negative = behind

    if (Math.abs(drift) > 3) {
      const now = performance.now();
      if (now - lastSeekRef.current < 3000) return;
      lastSeekRef.current = now;
      player.setPlaybackRate(1);
      player.seekTo(compensatedHostTime, true);
      return;
    }

    if (drift < -0.02) {
      player.setPlaybackRate(1.25);
    } else if (drift > 0.02) {
      player.setPlaybackRate(0.75);
    } else if (player.getPlaybackRate?.() !== 1) {
      player.setPlaybackRate(1);
    }
  };

  // Countdown start time for the score screen
  const countdownStartRef = useRef(null);

  // Fetch song data and start animation loop
  useEffect(() => {
    if (!activeSongId || activeSongId === 'none') return;

    let rafId;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${apiUrl}/songs/${activeSongId}`);
        const jsonObj = await resp.json();

        if (cancelled) return;

        if (!jsonObj.data) {
          console.error("Song API returned no data for", activeSongId);
          setError(true);
          return;
        }

        // Update URL slug cosmetically (no navigation / remount)
        const artist = jsonObj.data.artist ?? '';
        const title = jsonObj.data.title ?? '';
        if (artist && title) {
          const correctSlug = urlEscapedTitle(artist, title);
          window.history.replaceState(null, '', `/sing/${correctSlug}/${activeSongId}${window.location.search}`);
        }

        songInfoRef.current = jsonObj.data;

        // Fetch similar songs
        if (artist && title) {
          fetch(`${apiUrl}/similar?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}`)
            .then(r => r.json())
            .then(j => { if (!cancelled) setSimilarSongs(j.data ?? []); })
            .catch(() => {});
        }

        if (jsonObj.data.lyrics) {
          const lyricData = await readTextFile(jsonObj.data.lyrics);

          if (cancelled) return;

          if (jsonObj.data.gap) {
            lyricData.gap = jsonObj.data.gap;
          }
          gapRef.current = lyricData.gap;

          setTickData(getTickData(lyricData, 0));

          // Store lyrics payload so the WS effect can send it once connected
          lyricsPayloadRef.current = { lyrics: jsonObj.data.lyrics, gap: lyricData.gap };

          // If WS is already connected and we're the host, send song:start + lyrics now
          // (covers the case where WS connected before song data arrived, or song transition)
          const w = wssRef.current;
          if (w && w.readyState === WebSocket.OPEN && isHostRef.current) {
            if (sentSongStartForRef.current !== activeSongId) {
              sentSongStartForRef.current = activeSongId;
              sendSongStart(w, {
                songId: activeSongId,
                artist: jsonObj.data.artist,
                title: jsonObj.data.title,
                videoId: jsonObj.data.videoId,
              });
            }
            sendSongLyrics(w, lyricsPayloadRef.current);
          }

          const animate = () => {
            const player = iframePlayerRef.current;
            // For non-host joiners: prefer hostVideoTimeRef when local player
            // is absent or hasn't loaded yet (getCurrentTime returns 0/undefined).
            let videoTime;
            if (isHostRef.current) {
              videoTime = player?.getCurrentTime?.() ?? 0;
            } else {
              // Always use the smooth interpolated host time for display (lyrics/bars).
              // The YouTube player's getCurrentTime() jitters due to playback rate
              // adjustments and internal buffering. The host time is a smooth monotonic
              // clock that only moves forward.
              videoTime = getHostVideoTime();
            }
            lyricData.gap = gapRef.current;
            setTickData(getTickData(lyricData, videoTime));

            const w = wssRef.current;
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
              artist,
              title,
              songId: activeSongId,
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
  }, [activeSongId]); // only re-run when the active song changes

  // Join singing — init microphone on demand
  const micStatsRef = useRef(null);
  const handleJoinSinging = useCallback(async () => {
    if (micActive) return;
    try {
      const result = await initMicInput();
      stopMicRef.current = result.stopMicInput;
      micStatsRef.current = result.stats;
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

  // Auto-join singing for non-host players
  useEffect(() => {
    if (!isHost && !micActive) {
      handleJoinSinging();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Process mic input — uses refs to avoid re-registering the callback on every tick
  useEffect(() => {
    setOnProcessing && setOnProcessing(msg => {
      const { note, error } = msg.data;
      if (error) { console.error("[pitch worklet]", error); return; }

      // Don't process or send notes when the video is paused
      const player = iframePlayerRef.current;
      const isPlaying = player ? player.getPlayerState?.() === 1 : hostIsPlayingRef.current;
      if (!isPlaying) return;

      // For scoring, non-host joiners always use interpolated host video time.
      // The local player (if present) may drift by up to 0.2s due to the seek threshold,
      // causing tick misalignment vs. the host. Using the same time source for everyone
      // ensures fair scoring.
      const videoTime = (!isHostRef.current)
        ? getHostVideoTime()
        : (player?.getCurrentTime?.() ?? 0);
      const td = tickDataRef.current;

      td.lyricRef && setHitNotesByPlayer(oldData =>
        getAndSetHitNotesByPlayer(td, oldData, note, currentUserNameRef.current));

      const w = wssRef.current;
      if (w) {
        sendPlayerNote(w, { note, videoTime });
      }
    });
  }, [setOnProcessing]);

  // Open WebSocket — depends only on partyId, NOT songId.
  // This connects once per party and stays connected across song transitions.
  useEffect(() => {
    if (!partyId) return;

    let closed = false;
    let wsInstance;

    (async () => {
      wsInstance = await openWebSocket();
      if (closed) {
        wsInstance.close();
        return;
      }

      sendPartyJoin(wsInstance, { partyId, username: currentUserName, isShowingVideo: true });

      // Only host sends song lifecycle messages
      if (isHost) {
        const info = songInfoRef.current;
        const sid = activeSongIdRef.current;
        if (info && sid && sid !== 'none' && sentSongStartForRef.current !== sid) {
          sentSongStartForRef.current = sid;
          sendSongStart(wsInstance, {
            songId: sid,
            artist: info.artist,
            title: info.title,
            videoId: info.videoId,
          });
        }

        // Send lyrics to server for server-side scoring (may have been fetched before WS connected)
        if (lyricsPayloadRef.current) {
          sendSongLyrics(wsInstance, lyricsPayloadRef.current);
        }
      }

      setWss(wsInstance);
    })();

    return () => {
      closed = true;
      wsInstance?.close();
    };
  }, [partyId, currentUserName, isHost]); // NO songId — WS is per-party

  // Handle WebSocket messages
  useEffect(() => {
    if (!wss) return;
    const handler = msg => {
      const jsonObj = JSON.parse(msg.data);
      const td = tickDataRef.current;

      // v2 messages
      if (jsonObj.type === "player:note_echo" && td.currentLine) {
        setHitNotesByPlayer(oldData =>
          getAndSetHitNotesByPlayer(td, oldData, jsonObj.data.note, jsonObj.data.username));
      }

      if (jsonObj.type === "party:queue_updated") {
        setQueue(jsonObj.data.queue ?? []);
      }

      // party:state is sent by the server on join — contains full state including currentSong
      if (jsonObj.type === "party:state") {
        const state = jsonObj.data;
        if (state.queue) setQueue(state.queue);
        // If we're rejoining and don't have a song yet, pick up the current song
        if (state.currentSong?.songId && (!activeSongIdRef.current || activeSongIdRef.current === 'none')) {
          setActiveSongId(state.currentSong.songId);
        }
      }

      if (jsonObj.type === "party:scores_updated") {
        const players = jsonObj.data.players ?? jsonObj.data.scores ?? [];
        const scoresMap = {};
        for (const p of players) {
          scoresMap[p.username] = p.score ?? 0;
        }
        setServerScores(scoresMap);
      }

      if (jsonObj.type === "party:song_started") {
        const s = jsonObj.data?.currentSong ?? jsonObj.data;
        if (s?.songId && s.songId !== activeSongIdRef.current) {
          // Update song in-place — NO navigate(), NO remount
          setSongEnded(false);
          setHitNotesByPlayer({});
          setServerScores(null);
          setEndScores([]);
          setSimilarSongs([]);
          playerStateRef.current = -1;
          setActiveSongId(s.songId);
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
        hostVideoTimeRef.current = jsonObj.data.videoTime ?? 0;
        hostVideoTimeReceivedAtRef.current = performance.now();
        hostIsPlayingRef.current = !!jsonObj.data.isPlaying;

        const player = iframePlayerRef.current;
        if (player) {
          if (jsonObj.data.isPlaying) {
            player.playVideo?.();
          } else {
            player.pauseVideo?.();
          }
          syncJoinerPlayer(player, jsonObj.data.videoTime);
        }
      }

      if (jsonObj.type === "ping:request") {
        sendPingReply(wss, { serverTs: jsonObj.data.serverTs });
      }

      if (jsonObj.type === "ping:ack") {
        // Server measured our RTT/2 and sent it back — store for sync compensation
        ownLatencyRef.current = jsonObj.data.latencyMs ?? 0;
      }

      if (jsonObj.type === "party:latency_updated") {
        const latencyMap = {};
        for (const p of jsonObj.data.latencies ?? []) {
          latencyMap[p.username] = p.latencyMs;
        }
        setPlayerLatencies(latencyMap);
      }

      if (jsonObj.type === "error") {
        console.error("WS error:", jsonObj.data);
      }
    };
    wss.onmessage = handler;
    return () => { wss.onmessage = null; };
  }, [wss, isHost]);

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

  // Smooth countdown — runs via rAF, auto-advances when complete.
  // Any mouse/touch activity permanently cancels the countdown so the user
  // can browse scores and share at their own pace.
  const COUNTDOWN_DURATION = 4000; // ms
  const [countdownCancelled, setCountdownCancelled] = useState(false);
  const countdownCancelledRef = useRef(false);
  useEffect(() => {
    if (!songEnded || !countdownStartRef.current) return;
    setCountdownCancelled(false);
    countdownCancelledRef.current = false;
    let rafId;
    const tick = () => {
      // Use ref so cancellation is visible even across closure boundaries
      if (countdownCancelledRef.current || !countdownStartRef.current) return;
      const elapsed = performance.now() - countdownStartRef.current;
      const progress = Math.min(1, elapsed / COUNTDOWN_DURATION);
      setCountdownProgress(progress);
      if (progress >= 1) {
        // Time's up — advance (double-check cancellation wasn't requested)
        if (countdownCancelledRef.current) return;
        setSongEnded(false);
        if (wss && isHost) {
          sendSongAdvance(wss);
        }
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // Cancel countdown permanently on any user interaction
    const cancelCountdown = () => {
      countdownCancelledRef.current = true;
      cancelAnimationFrame(rafId);
      countdownStartRef.current = null;
      setCountdownCancelled(true);
    };
    window.addEventListener('mousemove', cancelCountdown);
    window.addEventListener('mousedown', cancelCountdown);
    window.addEventListener('touchstart', cancelCountdown);

    return () => {
      countdownCancelledRef.current = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', cancelCountdown);
      window.removeEventListener('mousedown', cancelCountdown);
      window.removeEventListener('touchstart', cancelCountdown);
    };
  }, [songEnded, wss, isHost]);

  // Leave party — clears session, closes WS, navigates home
  const handleLeaveParty = useCallback(() => {
    clearPartySession();
    if (wss) {
      try { wss.close(); } catch { /* */ }
    }
    navigate('/', { replace: true });
  }, [wss, navigate]);

  // Waiting for host to pick a song (non-host joined with no current song)
  if (!activeSongId || activeSongId === 'none') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-surface to-[#0a0a1a] flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-neon-cyan font-mono text-lg animate-pulse">
          Waiting for host to pick a song...
        </div>
        {partyId && (
          <div className="text-gray-500 text-sm">Party: {partyId}</div>
        )}
        <button
          onClick={handleLeaveParty}
          className="mt-4 px-6 py-2 rounded-lg bg-surface-light border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all text-sm"
        >
          Leave Party
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <BackgroundImage thumbnailUrl={thumbnailUrl} />

      <BottomPartyIdBar
        partyId={partyId}
        songId={activeSongId}
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
        {/* Left sidebar: join + scores + leave */}
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
          {serverScores && Object.keys(serverScores).length > 0 && (
            <div className="bg-surface-light/80 rounded-lg p-3 backdrop-blur-sm">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Scores</div>
              {Object.entries(serverScores).map(([name, score]) => (
                <div key={name} className="flex items-center justify-between text-sm py-1 gap-2">
                  <span className="text-white truncate flex-1 min-w-0">{name}</span>
                  <PingIndicator latencyMs={playerLatencies[name]} />
                  <span className="text-neon-green font-mono flex-shrink-0">{score}</span>
                </div>
              ))}
            </div>
          )}

          {/* Leave party button */}
          <button
            onClick={handleLeaveParty}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-surface-light/60 text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-surface-lighter hover:border-red-500/40 transition-all text-xs"
          >
            Leave Party
          </button>

          {/* Video toggle (joiners only) */}
          {!isHost && (
            <button
              onClick={toggleVideo}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-all text-xs ${
                showVideo
                  ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30 hover:bg-neon-cyan/20'
                  : 'bg-surface-light/60 text-gray-400 border-surface-lighter hover:text-white hover:bg-surface-lighter'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {showVideo ? (
                  <>
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </>
                ) : (
                  <>
                    <path d="M2 3h20v14H2z" opacity="0.3" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </>
                )}
              </svg>
              {showVideo ? 'Hide Video' : 'Show Video'}
            </button>
          )}
        </div>

        {/* Center: music bars + video */}
        <div className="flex-1 min-w-0">
          <MusicBars tickData={tickData} hitNotesByPlayer={hitNotesByPlayer} />
          {showVideo && (
            <VideoPlayer videoId={videoId} onPlayerObject={handlePlayerReady} onStateChange={handleVideoStateChange} onEnd={handleVideoEnd} />
          )}
        </div>

        {/* Right sidebar: queue + similar */}
        <div className="lg:w-64 flex-shrink-0 space-y-4">
          <QueuePanel
            queue={queue}
            isHost={isHost}
            currentUserName={currentUserName}
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
                  // Tied scores get the same rank/medal
                  const rank = i === 0 ? 0
                    : (player.score === endScores[i - 1].score
                      ? endScores.findIndex(p => p.score === player.score)
                      : i);
                  const medals = ["\u{1F451}", "\u{1F948}", "\u{1F949}"];
                  const medal = medals[rank] ?? `#${rank + 1}`;
                  const colors = [
                    "from-yellow-500/20 to-amber-600/20 border-yellow-500/60 shadow-[0_0_20px_rgba(234,179,8,0.3)]",
                    "from-gray-300/15 to-gray-400/15 border-gray-400/50",
                    "from-amber-700/15 to-orange-800/15 border-amber-700/40",
                  ];
                  const colorClass = colors[rank] ?? "from-surface to-surface border-surface-lighter";
                  const scoreColors = ["text-yellow-400", "text-gray-300", "text-amber-600"];
                  const scoreColor = scoreColors[rank] ?? "text-neon-cyan";
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
                          <div className={`font-bold truncate ${rank === 0 ? "text-xl text-white" : "text-base text-gray-200"}`}>
                            {player.username}
                          </div>
                          {player.cumulativeScore > player.score && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              Total: {player.cumulativeScore.toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className={`font-mono font-black text-right flex-shrink-0 ${rank === 0 ? "text-3xl" : "text-xl"} ${scoreColor}`}>
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
                {/* Share score image */}
                <ShareCard songInfo={songInfoRef.current} scores={endScores} currentUserName={currentUserName} />

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

                {/* Next Song button — appears when countdown is cancelled */}
                {countdownCancelled && (
                  <button
                    onClick={() => {
                      setSongEnded(false);
                      if (wss && isHost) {
                        sendSongAdvance(wss);
                      }
                    }}
                    className="px-5 py-2 rounded-lg bg-gradient-to-r from-neon-cyan/20 to-neon-magenta/20 text-white hover:from-neon-cyan/30 hover:to-neon-magenta/30 border border-neon-cyan/40 hover:border-neon-cyan/60 transition-all text-sm font-semibold"
                  >
                    Next Song &rarr;
                  </button>
                )}

                {/* Countdown circle — hidden once user interacts */}
                {!countdownCancelled && (
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
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Debug overlay — toggled by ?debug URL parameter */}
      <MicDebugOverlay statsRef={micStatsRef} />
    </div>
  );
};

/** Tiny debug overlay that polls mic stats and displays them. Only renders when ?debug is in the URL. */
const MicDebugOverlay = ({ statsRef }) => {
  const [, forceUpdate] = useState(0);
  const show = new URLSearchParams(window.location.search).has('debug');

  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => forceUpdate(n => n + 1), 250);
    return () => clearInterval(id);
  }, [show]);

  if (!show) return null;

  const s = statsRef.current;
  if (!s) {
    return (
      <div className="fixed top-2 right-2 z-50 bg-black/80 text-white font-mono text-xs p-2 rounded border border-white/20">
        Mic not active
      </div>
    );
  }

  return (
    <div className="fixed top-2 right-2 z-50 bg-black/80 text-white font-mono text-xs p-3 rounded border border-white/20 leading-relaxed">
      <div className="text-neon-cyan font-bold mb-1">Mic Debug</div>
      <div>Chunks: {s.totalChunks} total, {s.chunksPerSec}/s</div>
      <div>Notes: {s.totalNotes} total, {s.notesPerSec}/s</div>
      <div>Gated: {s.gatedChunks}</div>
      <div>Noise floor: {s.noiseFloor?.toFixed(5)} | threshold: {(Math.max(0.002, (s.noiseFloor ?? 0) * 2)).toFixed(5)}</div>
      <div>Last note: {s.lastNote} | vol: {s.lastVolume?.toFixed(4)}</div>
    </div>
  );
};

export default PartyPage;
