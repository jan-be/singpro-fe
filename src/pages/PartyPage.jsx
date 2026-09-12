import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import BackgroundImage from "../components/BackgroundImage";
import { LiveStageLyrics, LiveMusicBars } from "../components/LiveView";
import SongTimeline from "../components/SongTimeline";
import { songRegions } from "../logic/songRegions";
import { popoverJustClosed, markPopoverClosed } from "../logic/popoverGuard";
import { createLiveStore, useLiveValue } from "../logic/liveStore";
import { getTickData, readTextFile, getP2TickData } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import PartyBar from "../components/PartyBar";
import { shuffle } from "../logic/RandomUtility";
import { apiUrl } from "../GlobalConsts";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { initMicInput } from "../logic/MicrophoneInput";
import { getAndSetHitNotesByPlayer, applyRemoteNotes } from "../logic/MicInputToTick";
import {
  openWebSocket,
  sendPartyJoin,
  sendPlayerNote,
  sendVideoTime,
  sendSongStart,
  sendSongEnd,
  sendSongAdvance,
  sendSongSkip,
  sendCountdownCancel,
  sendSongLyrics,
  sendQueueAdd,
  sendQueueRemove,
  sendQueueReorder,
  sendPingReply,
  sendPlayerColor,
  BIN_NOTES_BATCH,
  parseBinaryBatch,
} from "../logic/WebsocketHandling";
import QueuePanel from "../components/QueuePanel";
import { defaultHue } from "../logic/playerColor";
import ShareCard from "../components/ShareCard";
import StarRating from "../components/StarRating";
import { useAuth } from "../logic/AuthContext";
import { getSongScores, getSuggestions, requestFriend } from "../logic/authApi";
import { starsFor, MAX_SCORE, STAR_THRESHOLDS } from "../logic/scoreScale";
import { DuetIcon } from "../components/Icons";

// --- Session persistence helpers ---
// Party session is stored in sessionStorage so page reloads / back-navigation
// don't lose the partyId, username, or host status.
const SESSION_KEY = 'singpro_party';

// Stems need Web Audio (GainNodes on <audio> sources). Without it we simply
// keep playing the YouTube audio.
const WEB_AUDIO_SUPPORTED = typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);

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
  const { t } = useTranslation();
  const routerState = useLocation().state;
  const navigate = useNavigate();
  const { songId: urlSongId } = useParams();

  // Restore session from sessionStorage if router state is missing (e.g. page reload)
  const savedSession = loadPartySession();

  // Per-frame state (current line, cursor, players' notes) lives in a store that
  // only Lyrics/MusicBars subscribe to — see liveStore.js. The page itself
  // must not re-render at display rate.
  const liveRef = useRef(null);
  if (!liveRef.current) liveRef.current = createLiveStore();
  const live = liveRef.current;
  const liveGap = useLiveValue(live, f => f.tickData.lyricData?.gap);
  const liveDefaultGap = useLiveValue(live, f => f.tickData.lyricData?.defaultGap);
  const [partyId, setPartyId] = useState(
    routerState?.partyId ?? savedSession?.partyId ?? undefined
  );
  // A signed-in host plays under the account name; joiners chose theirs on the join page
  const { user: authUser, loading: authLoading, refreshBest } = useAuth();
  const [chosenUserName] = useState(routerState?.currentUserName ?? savedSession?.username ?? null);
  const currentUserName = chosenUserName ?? authUser?.username ?? t('party.defaultHost');
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
  // (once we know whether a signed-in user is the host, so the party gets their name)
  useEffect(() => {
    if (partyId || !isHost || authLoading) return;
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
  }, [authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const [iframePlayer, setIframePlayer] = useState(null);
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
  // YouTube shows the video title + channel over the top of the player for a
  // few seconds whenever playback starts or jumps (even without controls), so
  // a dark strip covers that band for a moment after every start and seek.
  const [titleCover, setTitleCover] = useState(true);
  const titleCoverTimer = useRef(null);
  const showTitleCover = useCallback(() => {
    setTitleCover(true);
    clearTimeout(titleCoverTimer.current);
    titleCoverTimer.current = setTimeout(() => setTitleCover(false), 4500);
  }, []);
  useEffect(() => () => clearTimeout(titleCoverTimer.current), []);

  const handlePlayerReady = useCallback((playerObj) => {
    setIframePlayer(playerObj);
    // Stems: mute the iframe entirely (immune to YouTube volume resets).
    // No stems: unmute and apply the persisted volume.
    if (hasStemsRef.current) {
      try { playerObj.mute(); } catch { /* */ }
    } else {
      try { playerObj.unMute(); playerObj.setVolume(volumeRef.current); } catch { /* */ }
    }
    if (!isHost && hostVideoTimeRef.current > 0) {
      playerObj.seekTo(getHostVideoTime(), true);
      showTitleCover();
      if (hostIsPlayingRef.current) {
        playerObj.playVideo();
      }
    }
  }, [isHost]);

  const [error, setError] = useState(false);
  const [setOnProcessing, setSetOnProcessing] = useState();
  const [wss, setWss] = useState();
  const [micActive, setMicActive] = useState(false);
  const micActiveRef = useRef(micActive);
  micActiveRef.current = micActive;
  const stopMicRef = useRef(null);
  const micRecorderRef = useRef(null);

  const [queue, setQueue] = useState([]);
  const [serverScores, setServerScores] = useState(null);
  // Colours the server has told us about (own colour seeded so it is known
  // before the join round-trip); anyone else gets the shared default
  const [playerColors, setPlayerColors] = useState(() => {
    let stored = null;
    try {
      const s = localStorage.getItem('singpro_player_color');
      if (s !== null) stored = Number(s);
    } catch { /* */ }
    return { [currentUserName]: stored ?? defaultHue(currentUserName) };
  });
  const learnPlayerColors = useCallback((players) => {
    setPlayerColors(prev => {
      let next = prev;
      for (const p of players) {
        if (p.color != null && prev[p.username] !== p.color) next = { ...next, [p.username]: p.color };
      }
      return next;
    });
  }, []);
  const [songEnded, setSongEnded] = useState(false);
  const [endScores, setEndScores] = useState([]); // [{username, score, cumulativeScore}]
  const [countdownProgress, setCountdownProgress] = useState(0); // 0..1
  const [nextSongInfo, setNextSongInfo] = useState(null); // {songId, artist, title} from server
  const [similarSongs, setSimilarSongs] = useState([]);
  // Saved scores on this song (top + friends) for the end screen; fetched once
  // the song has ended, i.e. after the server saved this round
  const [songScores, setSongScores] = useState(null);
  const [mateSuggestions, setMateSuggestions] = useState([]); // people you sang with, not friends yet
  useEffect(() => {
    if (!songEnded || !activeSongId || activeSongId === 'none') { setSongScores(null); setMateSuggestions([]); return; }
    let active = true;
    getSongScores(activeSongId).then(d => { if (active) setSongScores(d); }).catch(() => {});
    if (authUser) {
      refreshBest(); // star badges on the song cards
      getSuggestions().then(s => { if (active) setMateSuggestions(s); }).catch(() => {});
    }
    return () => { active = false; };
  }, [songEnded, activeSongId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeSkipSegment, setActiveSkipSegment] = useState(null); // current skippable segment or null
  const skipSegmentsRef = useRef([]); // [{start, end, category}] from SponsorBlock

  // Auto-skip toggle: when enabled, host auto-seeks past SponsorBlock segments
  // without needing to press the Skip button. Persisted to localStorage.
  const [autoSkip, setAutoSkip] = useState(() => {
    try {
      const stored = localStorage.getItem('singpro_auto_skip');
      return stored === null ? true : stored === 'true'; // default ON
    }
    catch { return true; }
  });
  const autoSkipRef = useRef(autoSkip);
  autoSkipRef.current = autoSkip;
  const toggleAutoSkip = useCallback(() => {
    setAutoSkip(prev => {
      const next = !prev;
      try { localStorage.setItem('singpro_auto_skip', String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // ── Stem audio: when both karaoke + vocals are available, mute YouTube and
  //    play both stems from our server with independent volume control. ──
  const [hasStems, setHasStems] = useState(false);
  const hasStemsRef = useRef(false); // quick ref for use in callbacks
  // Master volume: what you hear. Without stems it is the YouTube volume, with
  // stems it scales both stem GainNodes. (Reads the pre-rename key once.)
  const [volume, setVolume] = useState(() => {
    try {
      const v = localStorage.getItem('singpro_volume') ?? localStorage.getItem('singpro_music_vol');
      return v !== null ? Math.max(0, Math.min(100, Number(v))) : 100;
    } catch { return 100; }
  });
  // How much of the original vocals is mixed in (stems only). Defaults to full
  // so a first-time listener hears the song as they know it; remembered across
  // songs like any other preference.
  const [vocalsLevel, setVocalsLevel] = useState(() => {
    try { const v = localStorage.getItem('singpro_vocals_level'); return v !== null ? Math.max(0, Math.min(100, Number(v))) : 100; }
    catch { return 100; }
  });
  // How much of the instrumental is mixed in (stems only), the counterpart of vocalsLevel
  const [instrumentalLevel, setInstrumentalLevel] = useState(() => {
    try { const v = localStorage.getItem('singpro_instrumental_level'); return v !== null ? Math.max(0, Math.min(100, Number(v))) : 100; }
    catch { return 100; }
  });
  // One-time callout explaining the Vocals slider, shown on the first song with stems
  const [stemsHint, setStemsHint] = useState(false);
  const dismissStemsHint = useCallback(() => {
    setStemsHint(false);
    try { localStorage.setItem('singpro_stems_hint_seen', '1'); } catch { /* */ }
  }, []);
  useEffect(() => {
    if (!hasStems) return;
    try { if (localStorage.getItem('singpro_stems_hint_seen') === '1') return; } catch { /* */ }
    setStemsHint(true);
    const id = setTimeout(dismissStemsHint, 20_000);
    return () => clearTimeout(id);
  }, [hasStems, dismissStemsHint]);
  // Tooltip shown when user tries to adjust YouTube volume while stems are active
  const [volumeTooltip, setVolumeTooltip] = useState(false);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const vocalsLevelRef = useRef(vocalsLevel);
  vocalsLevelRef.current = vocalsLevel;
  const instrumentalLevelRef = useRef(instrumentalLevel);
  instrumentalLevelRef.current = instrumentalLevel;
  const karaokeAudioRef = useRef(null);  // HTMLAudioElement for instrumental
  const vocalsAudioRef = useRef(null);   // HTMLAudioElement for vocals
  const karaokeGainRef = useRef(null);   // GainNode for instrumental
  const vocalsGainRef = useRef(null);    // GainNode for vocals
  const audioCtxRef = useRef(null);      // shared AudioContext
  const karaokeSourceRef = useRef(null); // MediaElementAudioSourceNode
  const vocalsSourceRef = useRef(null);  // MediaElementAudioSourceNode

  hasStemsRef.current = hasStems;

  // Push volume + vocals level into the stem GainNodes. A slider change is a
  // user gesture, so this is also where a suspended AudioContext (WebKit
  // autoplay policy) gets resumed.
  const applyStemGains = useCallback(() => {
    const master = volumeRef.current / 100;
    if (karaokeGainRef.current) karaokeGainRef.current.gain.value = master * (instrumentalLevelRef.current / 100);
    if (vocalsGainRef.current) vocalsGainRef.current.gain.value = master * (vocalsLevelRef.current / 100);
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, []);

  // ── Create/replace Audio elements when stems become available ──
  useEffect(() => {
    // Tear down previous audio elements
    for (const ref of [karaokeAudioRef, vocalsAudioRef]) {
      const prev = ref.current;
      if (prev) { prev.pause(); prev.removeAttribute('src'); prev.load(); }
    }
    for (const ref of [karaokeSourceRef, vocalsSourceRef]) {
      if (ref.current) { try { ref.current.disconnect(); } catch { /* */ } ref.current = null; }
    }

    if (!hasStems || !activeSongId || activeSongId === 'none') {
      karaokeAudioRef.current = null;
      vocalsAudioRef.current = null;
      return;
    }

    // Mute YouTube — we're serving both stems ourselves
    try { iframePlayerRef.current?.mute(); } catch { /* */ }

    const karaokeAudio = new Audio();
    karaokeAudio.crossOrigin = 'anonymous';
    karaokeAudio.preload = 'auto';
    karaokeAudio.src = `${apiUrl}/songs/${activeSongId}/karaoke`;
    karaokeAudioRef.current = karaokeAudio;

    const vocalsAudio = new Audio();
    vocalsAudio.crossOrigin = 'anonymous';
    vocalsAudio.preload = 'auto';
    vocalsAudio.src = `${apiUrl}/songs/${activeSongId}/vocals`;
    vocalsAudioRef.current = vocalsAudio;

    // Set up AudioContext + GainNodes (reuse context across songs, recreate if closed)
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        // No usable Web Audio: undo the stems setup and let YouTube carry the sound
        console.warn('[stems] Web Audio unavailable, using YouTube audio:', e.message);
        for (const audio of [karaokeAudio, vocalsAudio]) { audio.removeAttribute('src'); audio.load(); }
        karaokeAudioRef.current = null;
        vocalsAudioRef.current = null;
        try { iframePlayerRef.current?.unMute(); iframePlayerRef.current?.setVolume(volumeRef.current); } catch { /* */ }
        setHasStems(false);
        return;
      }
      audioCtxRef.current = ctx;
      const kGain = ctx.createGain();
      kGain.connect(ctx.destination);
      karaokeGainRef.current = kGain;
      const vGain = ctx.createGain();
      vGain.connect(ctx.destination);
      vocalsGainRef.current = vGain;
    }
    if (ctx.state === 'suspended') ctx.resume();

    try {
      const kSrc = ctx.createMediaElementSource(karaokeAudio);
      kSrc.connect(karaokeGainRef.current);
      karaokeSourceRef.current = kSrc;

      const vSrc = ctx.createMediaElementSource(vocalsAudio);
      vSrc.connect(vocalsGainRef.current);
      vocalsSourceRef.current = vSrc;
    } catch (e) {
      console.warn('[stems] Failed to create audio sources:', e.message);
      return;
    }

    // Apply current volume + vocals level
    applyStemGains();

    return () => {
      for (const audio of [karaokeAudio, vocalsAudio]) {
        audio.pause(); audio.removeAttribute('src'); audio.load();
      }
      try { karaokeSourceRef.current?.disconnect(); } catch { /* */ }
      try { vocalsSourceRef.current?.disconnect(); } catch { /* */ }
      karaokeSourceRef.current = null;
      vocalsSourceRef.current = null;
      karaokeAudioRef.current = null;
      vocalsAudioRef.current = null;
    };
  }, [hasStems, activeSongId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Master volume → stem GainNodes (stems) or YouTube volume (no stems) + persist
  useEffect(() => {
    applyStemGains();
    if (!hasStemsRef.current) {
      try { iframePlayerRef.current?.setVolume(volume); } catch { /* */ }
    }
    try { localStorage.setItem('singpro_volume', String(volume)); } catch { /* */ }
  }, [volume, applyStemGains]);

  // Vocals level → vocals GainNode (relative to master) + persist
  useEffect(() => {
    applyStemGains();
    try { localStorage.setItem('singpro_vocals_level', String(vocalsLevel)); } catch { /* */ }
  }, [vocalsLevel, applyStemGains]);

  // Instrumental level → instrumental GainNode (relative to master) + persist
  useEffect(() => {
    applyStemGains();
    try { localStorage.setItem('singpro_instrumental_level', String(instrumentalLevel)); } catch { /* */ }
  }, [instrumentalLevel, applyStemGains]);

  // On song transition: with stems YouTube stays muted (we play both stems
  // ourselves), without stems YouTube carries the sound at the master volume.
  const lastStemsSongRef = useRef(null);
  useEffect(() => {
    if (activeSongId === lastStemsSongRef.current) return;
    lastStemsSongRef.current = activeSongId;
    try {
      if (hasStems) {
        iframePlayerRef.current?.mute();
      } else {
        iframePlayerRef.current?.unMute();
        iframePlayerRef.current?.setVolume(volume);
      }
    } catch { /* */ }
  }, [hasStems, activeSongId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll YouTube iframe volume every 500ms:
  //  - With stems: if user unmuted via iframe, re-mute and show tooltip
  //  - Without stems: if user changed volume via iframe, sync our slider
  useEffect(() => {
    const id = setInterval(() => {
      const player = iframePlayerRef.current;
      if (!player) return;

      if (hasStemsRef.current) {
        // Stems mode: YouTube must stay muted
        let muted;
        try { muted = player.isMuted(); } catch { return; }
        if (!muted) {
          try { player.mute(); } catch { /* */ }
          setVolumeTooltip(true);
        }
      } else {
        // No stems: sync our slider to YouTube's volume
        let ytVol;
        try { ytVol = player.getVolume(); } catch { return; }
        if (typeof ytVol !== 'number') return;
        ytVol = Math.round(ytVol);
        setVolume(prev => (Math.abs(prev - ytVol) > 2 ? ytVol : prev));
      }
    }, 500);
    return () => clearInterval(id);
  }, []); // stable — reads refs, not state

  // Auto-hide the "use our controls" tooltip after 4 seconds
  useEffect(() => {
    if (!volumeTooltip) return;
    const id = setTimeout(() => setVolumeTooltip(false), 4000);
    return () => clearTimeout(id);
  }, [volumeTooltip]);

  // Sync stem audio playback with YouTube player state.
  const karaokeSyncRef = useRef(false); // whether we're actively syncing

  // Periodic sync: keep stem audio aligned with YouTube during playback.
  // Check every 2 seconds; if drift > 0.3s, re-sync.
  useEffect(() => {
    if (!hasStems) return;
    const id = setInterval(() => {
      const kAudio = karaokeAudioRef.current;
      const vAudio = vocalsAudioRef.current;
      if (!kAudio || kAudio.paused) return;

      let targetTime;
      if (isHost) {
        targetTime = iframePlayerRef.current?.getCurrentTime?.() ?? 0;
      } else {
        targetTime = getHostVideoTime();
      }
      for (const audio of [kAudio, vAudio]) {
        if (audio && Math.abs(audio.currentTime - targetTime) > 0.3) {
          audio.currentTime = targetTime;
        }
      }
    }, 2000);
    return () => clearInterval(id);
  }, [hasStems, isHost]);

  // For non-host joiners: sync stem audio with host time on video:time messages.
  const syncStemsToTime = useCallback((time, playing) => {
    const kAudio = karaokeAudioRef.current;
    const vAudio = vocalsAudioRef.current;
    if (!kAudio) return;
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume();

    for (const audio of [kAudio, vAudio]) {
      if (!audio) continue;
      if (playing) {
        if (Math.abs(audio.currentTime - time) > 0.3) audio.currentTime = time;
        if (audio.paused) audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    }
  }, []);

  // Clean up AudioContext on unmount
  useEffect(() => {
    return () => {
      const ctx = audioCtxRef.current;
      if (ctx) ctx.close().catch(() => {});
    };
  }, []);

  // Player color: persisted to localStorage, sent to server on join/change
  const [ownColor, setOwnColor] = useState(() => {
    try {
      const stored = localStorage.getItem('singpro_player_color');
      if (stored !== null) return Number(stored);
    } catch { /* */ }
    return defaultHue(currentUserName);
  });
  const handleColorChange = useCallback((hue) => {
    setOwnColor(hue);
    try { localStorage.setItem('singpro_player_color', String(hue)); } catch { /* */ }
    setPlayerColors(prev => ({ ...prev, [currentUserName]: hue }));
    const w = wssRef.current;
    if (w) sendPlayerColor(w, { color: hue });
  }, [currentUserName]);

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

  // Whether "Fix timing" mode is active — enables MusicBars drag-to-adjust.
  // When off, dragging on the bars does nothing.
  const [isFixingTiming, setIsFixingTiming] = useState(false);

  // Store songInfo for listen recording
  const songInfoRef = useRef(null);
  const partyIdRef = useRef(partyId);
  partyIdRef.current = partyId;
  const currentUserNameRef = useRef(currentUserName);
  currentUserNameRef.current = currentUserName;


  // Store raw lyrics text + gap so we can send them to the server when WS connects
  const lyricsPayloadRef = useRef(null);

  // Duet/solo toggle: lyricDataRef holds the active parsed lyrics so the animate
  // loop picks up changes immediately when the user toggles duet mode.
  const lyricDataRef = useRef(null);
  const songRawRef = useRef(null); // { lyrics, duetLyrics, gap } from API
  const [duetMode, setDuetMode] = useState(false);
  const duetModeRef = useRef(false);
  const [hasDuetLyrics, setHasDuetLyrics] = useState(false);

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

  // YouTube player state for the stage (-1 unstarted, 0 ended, 1 playing,
  // 2 paused, 3 buffering, 5 cued): whenever the video is not playing, YouTube
  // paints its own UI (title bar, controls, "more videos"), so the click-catcher
  // over the video turns into an opaque overlay — a spinner while starting or
  // buffering, a play button when paused — and toggles playback on click.
  const [videoState, setVideoState] = useState(-1);
  // Queue + similar songs live in a drawer opened from the top-right pill
  const [queueOpen, setQueueOpen] = useState(false);
  const queueDrawerRef = useRef(null);
  useEffect(() => {
    if (!queueOpen) return;
    const onClickOutside = (e) => {
      if (e.target.closest?.('[data-queue-toggle]')) return;
      if (queueDrawerRef.current && !queueDrawerRef.current.contains(e.target)) { setQueueOpen(false); markPopoverClosed(); }
    };
    document.addEventListener('pointerdown', onClickOutside);
    return () => document.removeEventListener('pointerdown', onClickOutside);
  }, [queueOpen]);
  const [videoDuration, setVideoDuration] = useState(0);
  // Sung stretches of the current lyrics (and the second singer's, in duet mode) for the timeline
  const [timelineRegions, setTimelineRegions] = useState([]);
  const seekVideo = useCallback((seconds) => {
    try { iframePlayerRef.current?.seekTo?.(seconds, true); } catch { /* */ }
    showTitleCover();
  }, [showTitleCover]);
  const togglePlayback = useCallback(() => {
    if (popoverJustClosed()) return; // that click only dismissed a popover
    const player = iframePlayerRef.current;
    if (!player) return;
    try { if (player.getPlayerState?.() === 1) player.pauseVideo?.(); else player.playVideo?.(); } catch { /* */ }
  }, []);

  const handleVideoStateChange = useCallback((state) => {
    if (!isHost) {
      playerStateRef.current = state;
    }
    setVideoState(state);
    if (state === 1) showTitleCover();
    try { const d = iframePlayerRef.current?.getDuration?.(); if (d > 0) setVideoDuration(prev => (Math.abs(prev - d) > 0.5 ? d : prev)); } catch { /* */ }

    // Sync stem audio with YouTube player state
    if (!hasStemsRef.current) return;
    const kAudio = karaokeAudioRef.current;
    if (!kAudio) return;
    const vAudio = vocalsAudioRef.current;

    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume();

    if (state === 1) { // playing
      const player = iframePlayerRef.current;
      if (player) {
        const currentTime = player.getCurrentTime?.() ?? 0;
        for (const audio of [kAudio, vAudio]) {
          if (audio && Math.abs(audio.currentTime - currentTime) > 0.3) {
            audio.currentTime = currentTime;
          }
        }
        kAudio.play().catch(() => {});
        vAudio?.play().catch(() => {});
      }
      karaokeSyncRef.current = true;
    } else if (state === 2) { // paused
      kAudio.pause();
      vAudio?.pause();
      karaokeSyncRef.current = false;
    } else if (state === 0) { // ended
      kAudio.pause();
      vAudio?.pause();
      karaokeSyncRef.current = false;
    }
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
      showTitleCover();
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

        // Update URL cosmetically (no navigation / remount)
        if (activeSongId) {
          window.history.replaceState(null, '', `/sing/${activeSongId}${window.location.search}`);
        }

        songInfoRef.current = jsonObj.data;
        skipSegmentsRef.current = jsonObj.data.skipSegments ?? [];
        setActiveSkipSegment(null);
        setHasStems(Boolean(jsonObj.data.hasStems) && WEB_AUDIO_SUPPORTED);

        const { artist, title } = jsonObj.data;

        // Update browser tab title
        if (artist && title) {
          document.title = `${artist} - ${title} | singpro.app`;
        }

        // Fetch similar songs
        if (artist && title) {
          fetch(`${apiUrl}/similar?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&songId=${encodeURIComponent(activeSongId)}`)
            .then(r => r.json())
            .then(j => { if (!cancelled) setSimilarSongs(shuffle(j.data ?? [])); })
            .catch(() => {});
        }

        if (jsonObj.data.lyrics) {
          // Store raw lyrics for duet toggle re-parsing
          songRawRef.current = {
            lyrics: jsonObj.data.lyrics,
            duetLyrics: jsonObj.data.duetLyrics ?? null,
            gap: jsonObj.data.gap,
          };
          setHasDuetLyrics(!!jsonObj.data.duetLyrics);

          // Reset duet mode for new songs (default to solo)
          duetModeRef.current = false;
          setDuetMode(false);

          const lyricData = await readTextFile(jsonObj.data.lyrics);

          if (cancelled) return;

          if (jsonObj.data.gap) {
            lyricData.gap = Number(jsonObj.data.gap);
          }
          gapRef.current = lyricData.gap;
          lyricDataRef.current = lyricData;
          setTimelineRegions(songRegions(lyricData));

          live.setFrame(getTickData(lyricData, 0), getP2TickData(lyricData, 0));

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
              try { videoTime = player?.getCurrentTime?.() ?? 0; } catch { videoTime = 0; }
            } else {
              // Always use the smooth interpolated host time for display (lyrics/bars).
              // The YouTube player's getCurrentTime() jitters due to playback rate
              // adjustments and internal buffering. The host time is a smooth monotonic
              // clock that only moves forward.
              videoTime = getHostVideoTime();
            }
            const ld = lyricDataRef.current;
            if (ld) {
              ld.gap = gapRef.current;
              live.setFrame(getTickData(ld, videoTime), getP2TickData(ld, videoTime));
            }

            // Check if current time is inside a skippable segment (host only)
            if (isHostRef.current && skipSegmentsRef.current.length > 0) {
              const seg = skipSegmentsRef.current.find(s => videoTime >= s.start && videoTime < s.end);
              if (seg && autoSkipRef.current && player) {
                // Auto-skip: seek past the segment immediately, hide the Skip button.
                // Guard against re-triggering inside the new segment (seekTo lands at seg.end).
                try { player.seekTo(seg.end, true); showTitleCover(); } catch { /* player destroyed */ }
                setActiveSkipSegment(null);
              } else {
                setActiveSkipSegment(seg ?? null);
              }
            }

            const w = wssRef.current;
            if (w && isHostRef.current && player) {
              // Throttle to ~3/sec: rAF runs at ~60fps, so send every ~20 frames
              videoTimeFrameCount.current++;
              if (videoTimeFrameCount.current >= 20) {
                videoTimeFrameCount.current = 0;
                try {
                  sendVideoTime(w, {
                    videoTime,
                    isPlaying: player.getPlayerState() === 1,
                  });
                } catch { /* player destroyed */ }
              }
            }
            rafId = window.requestAnimationFrame(animate);
          };
          rafId = window.requestAnimationFrame(animate);

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

          // Start audio recording for the active song if microphone is active
          startRecordingIfActive(activeSongId, jsonObj.data, lyricData);
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

  // Toggle between solo and duet mode — re-parses lyrics and updates WS
  const handleDuetToggle = useCallback(async () => {
    const raw = songRawRef.current;
    if (!raw?.duetLyrics) return;

    const newMode = !duetModeRef.current;
    duetModeRef.current = newMode;
    setDuetMode(newMode);

    const rawText = newMode ? raw.duetLyrics : raw.lyrics;
    const ld = await readTextFile(rawText);
    if (raw.gap != null) ld.gap = Number(raw.gap);
    // Preserve any user-adjusted gap
    if (gapRef.current != null) ld.gap = gapRef.current;
    lyricDataRef.current = ld;
    setTimelineRegions(songRegions(ld));

    // Update display immediately
    live.setFrame(getTickData(ld, 0), getP2TickData(ld, 0));

    // Re-send lyrics to server for scoring
    lyricsPayloadRef.current = { lyrics: rawText, gap: ld.gap };
    const w = wssRef.current;
    if (w && w.readyState === WebSocket.OPEN && isHostRef.current) {
      sendSongLyrics(w, lyricsPayloadRef.current);
    }
  }, []);

  // Audio recording helpers for pitch accuracy dataset collection
  const stopAndUploadRecording = useCallback(() => {
    const score = live.notes[currentUserNameRef.current]?.score;
    micRecorderRef.current?.stopAndUpload({ score });
  }, []);

  const startRecordingIfActive = useCallback((songId, info, ld, recorderInstance) => {
    const rec = recorderInstance || micRecorderRef.current;
    if (!rec || !songId || songId === 'none') return;
    const sessionId = sessionStorage.getItem("sessionId") ?? crypto.randomUUID();
    sessionStorage.setItem("sessionId", sessionId);
    rec.start({
      songId,
      videoId: info?.videoId,
      artist: info?.artist,
      title: info?.title,
      gap: ld?.gap ?? info?.gap,
      bpm: ld?.bpm,
      sessionId,
      partyId: partyIdRef.current,
      nickname: currentUserNameRef.current,
    });
  }, []);

  // Join singing — init microphone on demand
  const micStatsRef = useRef(null);
  // Input device for singing (chosen in the microphone panel); remembered across sessions
  const [micDeviceId, setMicDeviceId] = useState(() => {
    try { return localStorage.getItem('singpro_mic_device') || null; } catch { return null; }
  });
  const joinSingingWith = useCallback(async (deviceId) => {
    if (stopMicRef.current) return; // already singing
    try {
      const result = await initMicInput({ deviceId: deviceId || undefined });
      stopMicRef.current = result.stopMicInput;
      micStatsRef.current = result.stats;
      micRecorderRef.current = result.recorder;
      micActiveRef.current = true;
      setSetOnProcessing(() => result.setOnProcessing);
      setMicActive(true);
      startRecordingIfActive(activeSongIdRef.current, songInfoRef.current, lyricDataRef.current, result.recorder);
    } catch (e) {
      console.warn("Microphone access denied or unavailable:", e.message);
    }
  }, [startRecordingIfActive]);
  const handleJoinSinging = useCallback(() => joinSingingWith(micDeviceId), [joinSingingWith, micDeviceId]);

  // Leave singing — stop microphone
  const handleLeaveSinging = useCallback(() => {
    stopAndUploadRecording();
    stopMicRef.current?.();
    stopMicRef.current = null;
    micRecorderRef.current = null;
    micActiveRef.current = false;
    setSetOnProcessing(undefined);
    setMicActive(false);
  }, [stopAndUploadRecording]);

  // Switching the input device while singing restarts the microphone on the new one
  const handleMicDeviceChange = useCallback((deviceId) => {
    setMicDeviceId(deviceId);
    try {
      if (deviceId) localStorage.setItem('singpro_mic_device', deviceId);
      else localStorage.removeItem('singpro_mic_device');
    } catch { /* */ }
    if (stopMicRef.current) {
      handleLeaveSinging();
      joinSingingWith(deviceId);
    }
  }, [handleLeaveSinging, joinSingingWith]);

  // Stop mic on unmount
  useEffect(() => {
    return () => {
      stopAndUploadRecording();
      stopMicRef.current?.();
    };
  }, [stopAndUploadRecording]);

  // Auto-join singing for non-host players
  useEffect(() => {
    if (!isHost && !micActive) {
      handleJoinSinging();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Process mic input — uses refs to avoid re-registering the callback on every tick
  useEffect(() => {
    setOnProcessing && setOnProcessing(msg => {
      const { freq, error } = msg.data;
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
      const td = live.frame.tickData;

      if (td.lyricRef) {
        live.notes = getAndSetHitNotesByPlayer(td, live.notes, freq, currentUserNameRef.current, videoTime);
      }

      // Record note telemetry for dataset accuracy evaluation
      micRecorderRef.current?.recordNote({ videoTime, freq, volume: msg.data.volume ?? 0 });

      const w = wssRef.current;
      if (w) {
        sendPlayerNote(w, { freq, videoTime });
      }
    });
  }, [setOnProcessing]);

  // Open WebSocket — depends only on partyId, NOT songId.
  // This connects once per party and stays connected across song transitions.
  useEffect(() => {
    if (!partyId || authLoading) return;

    let closed = false;
    let wsInstance;

    (async () => {
      wsInstance = await openWebSocket();
      if (closed) {
        wsInstance.close();
        return;
      }

      sendPartyJoin(wsInstance, { partyId, username: currentUserName, isShowingVideo: true, color: ownColor });

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
    // NO songId — WS is per-party. The account is read from the session cookie
    // on the upgrade, so signing in (or out) reconnects.
  }, [partyId, currentUserName, isHost, authLoading, authUser?.id]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!wss) return;
    const handler = msg => {
      // Binary messages: player:notes_batch (high-frequency pitch relay)
      if (msg.data instanceof ArrayBuffer) {
        const view = new DataView(msg.data);
        if (view.byteLength > 0 && view.getUint8(0) === BIN_NOTES_BATCH) {
          const { data } = parseBinaryBatch(msg.data);
          const remoteNotes = data.notes.filter(n => n.username !== currentUserNameRef.current);
          if (remoteNotes.length > 0) {
            live.notes = applyRemoteNotes(live.notes, remoteNotes);
          }
        }
        return;
      }

      const jsonObj = JSON.parse(msg.data);
      const td = live.frame.tickData;

      // v2 messages — batched note echoes from server (all other players' notes)
      // JSON fallback for notes_batch (in case server hasn't been updated yet)
      if (jsonObj.type === "player:notes_batch") {
        const remoteNotes = jsonObj.data.notes.filter(n => n.username !== currentUserNameRef.current);
        if (remoteNotes.length > 0) {
          live.notes = applyRemoteNotes(live.notes, remoteNotes);
        }
      }

      if (jsonObj.type === "party:queue_updated") {
        setQueue(jsonObj.data.queue ?? []);
      }

      // party:state is sent by the server on join — contains full state including currentSong
      if (jsonObj.type === "party:state") {
        const state = jsonObj.data;
        if (state.queue) setQueue(state.queue);
        if (state.players) learnPlayerColors(state.players);
        // If we're rejoining and don't have a song yet, pick up the current song
        if (state.currentSong?.songId && (!activeSongIdRef.current || activeSongIdRef.current === 'none')) {
          setActiveSongId(state.currentSong.songId);
        }
      }

      if (jsonObj.type === "player:color_changed") {
        const { username, color } = jsonObj.data;
        setPlayerColors(prev => ({ ...prev, [username]: color }));
      }

      if (jsonObj.type === "party:player_joined") {
        learnPlayerColors([jsonObj.data]);
      }

      if (jsonObj.type === "party:scores_updated") {
        const players = jsonObj.data.players ?? jsonObj.data.scores ?? [];
        const scoresMap = {};
        for (const p of players) {
          scoresMap[p.username] = { score: p.score ?? 0, cumulativeScore: p.cumulativeScore ?? 0 };
        }
        setServerScores(scoresMap);
        learnPlayerColors(players);
      }

      if (jsonObj.type === "party:song_started") {
        const s = jsonObj.data?.currentSong ?? jsonObj.data;
        if (s?.songId && s.songId !== activeSongIdRef.current) {
          // Update song in-place — NO navigate(), NO remount
          setSongEnded(false);
          live.resetNotes();
          setServerScores(null);
          setEndScores([]);
          setSimilarSongs([]);
          playerStateRef.current = -1;
          setActiveSongId(s.songId);
        }
      }

      if (jsonObj.type === "party:song_ended") {
        stopAndUploadRecording();

        const scores = jsonObj.data?.scores ?? [];
        setEndScores(scores.sort((a, b) => (b.cumulativeScore ?? b.score) - (a.cumulativeScore ?? a.score)));
        setNextSongInfo(jsonObj.data?.nextSong ?? null);
        setSongEnded(true);
        countdownStartRef.current = performance.now();
        setCountdownProgress(0);
        setCountdownCancelled(false);
      }

      // Host cancelled the countdown — joiners should show "Waiting for host"
      if (jsonObj.type === "party:countdown_cancelled" && !isHost) {
        countdownCancelledRef.current = true;
        countdownStartRef.current = null;
        setCountdownCancelled(true);
      }

      if (jsonObj.type === "video:time" && !isHost) {
        hostVideoTimeRef.current = jsonObj.data.videoTime ?? 0;
        hostVideoTimeReceivedAtRef.current = performance.now();
        hostIsPlayingRef.current = !!jsonObj.data.isPlaying;

        // Sync stem audio for non-host joiners
        syncStemsToTime(jsonObj.data.videoTime ?? 0, !!jsonObj.data.isPlaying);

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
        // If the server says the party doesn't exist (stale session after 5-min
        // timeout), clear the session and bounce home instead of getting stuck
        // on a "waiting for host" screen.
        const msg = jsonObj.data?.message ?? '';
        if (/party\s+\S+\s+not found/i.test(msg)) {
          clearPartySession();
          try { wss.close(); } catch { /* */ }
          navigate('/', { replace: true });
        }
      }
    };
    wss.onmessage = handler;
    return () => { wss.onmessage = null; };
  }, [wss, isHost, syncStemsToTime]);

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
    stopAndUploadRecording();

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

  // Host skips the current song: the next queued song (or a similar one when
  // the queue is empty) starts right away — no score screen, no points.
  const handleSkipSong = useCallback(() => {
    if (wss && isHost) sendSongSkip(wss);
  }, [wss, isHost]);

  // Smooth countdown — runs via rAF.
  // Host: mouse/touch cancels countdown, sends WS cancel to joiners, shows Next/Stay buttons.
  // Joiners: countdown runs in sync, but only the host can advance or cancel.
  //          When host cancels, joiners receive party:countdown_cancelled and show "Waiting for host."
  const COUNTDOWN_DURATION = 4000; // ms
  const [countdownCancelled, setCountdownCancelled] = useState(false);
  const countdownCancelledRef = useRef(false);
  useEffect(() => {
    if (!songEnded || !countdownStartRef.current) return;
    setCountdownCancelled(false);
    countdownCancelledRef.current = false;
    let rafId;
    const tick = () => {
      if (countdownCancelledRef.current || !countdownStartRef.current) return;
      const elapsed = performance.now() - countdownStartRef.current;
      const progress = Math.min(1, elapsed / COUNTDOWN_DURATION);
      setCountdownProgress(progress);
      if (progress >= 1) {
        if (countdownCancelledRef.current) return;
        if (isHost) {
          // Host: auto-advance to next song
          setSongEnded(false);
          if (wss) sendSongAdvance(wss);
        }
        // Joiners: stop the countdown circle but don't navigate —
        // the server will broadcast party:song_started when the host advances.
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // Only the host can cancel the countdown via mouse/touch
    let cancelCountdown;
    if (isHost) {
      cancelCountdown = () => {
        countdownCancelledRef.current = true;
        cancelAnimationFrame(rafId);
        countdownStartRef.current = null;
        setCountdownCancelled(true);
        // Notify joiners
        if (wss) sendCountdownCancel(wss);
      };
      window.addEventListener('mousemove', cancelCountdown);
      window.addEventListener('mousedown', cancelCountdown);
      window.addEventListener('touchstart', cancelCountdown);
    }

    return () => {
      countdownCancelledRef.current = true;
      cancelAnimationFrame(rafId);
      if (cancelCountdown) {
        window.removeEventListener('mousemove', cancelCountdown);
        window.removeEventListener('mousedown', cancelCountdown);
        window.removeEventListener('touchstart', cancelCountdown);
      }
    };
  }, [songEnded, wss, isHost]);

  // Leave party — clears session, closes WS, navigates home
  const handleLeaveParty = useCallback(() => {
    clearPartySession();
    document.title = 'singpro.app';
    if (wss) {
      try { wss.close(); } catch { /* */ }
    }
    navigate('/', { replace: true });
  }, [wss, navigate]);

  // Waiting for host to pick a song (non-host joined with no current song)
  // Or: host rejoined an existing party without an active song — offer to go pick one.
  if (!activeSongId || activeSongId === 'none') {
    if (isHost) {
      return (
        <div className="min-h-screen bg-gradient-to-b from-surface to-[#0a0a1a] flex flex-col items-center justify-center gap-4 px-6">
          <div className="text-neon-cyan font-mono text-lg">
            {t('party.pickASong')}
          </div>
          {partyId && (
            <div className="text-gray-500 text-sm">{t('party.partyLabel')} {partyId}</div>
          )}
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-6 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/20 transition-all text-sm font-semibold"
          >
            {t('party.browseSongs')}
          </button>
          <button
            onClick={handleLeaveParty}
            className="mt-2 px-6 py-2 rounded-lg bg-surface-light border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all text-sm"
          >
            {t('party.leaveParty')}
          </button>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-gradient-to-b from-surface to-[#0a0a1a] flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-neon-cyan font-mono text-lg animate-pulse">
          {t('party.waitingForHost')}
        </div>
        {partyId && (
          <div className="text-gray-500 text-sm">{t('party.partyLabel')} {partyId}</div>
        )}
        <button
          onClick={handleLeaveParty}
          className="mt-4 px-6 py-2 rounded-lg bg-surface-light border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all text-sm"
        >
          {t('party.leaveParty')}
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-dvh overflow-hidden">
      <BackgroundImage videoId={videoId} />

      <PartyBar
        partyId={partyId}
        songId={activeSongId}
        isHost={isHost}
        autoSkip={autoSkip}
        onToggleAutoSkip={toggleAutoSkip}
        isFixingTiming={isFixingTiming}
        onFixingTimingChange={setIsFixingTiming}
        gapData={{
          gap: liveGap,
          defaultGap: liveDefaultGap,
          setGap: gap => { if (Number.isFinite(gap)) gapRef.current = gap; },
        }}
        volume={volume}
        vocalsLevel={vocalsLevel}
        instrumentalLevel={instrumentalLevel}
        onVolumeChange={setVolume}
        onVocalsLevelChange={setVocalsLevel}
        onInstrumentalLevelChange={setInstrumentalLevel}
        hasStems={hasStems}
        volumeTooltip={volumeTooltip}
        stemsHint={stemsHint}
        onDismissStemsHint={dismissStemsHint}
        micActive={micActive}
        onJoinSinging={handleJoinSinging}
        onLeaveSinging={handleLeaveSinging}
        micStatsRef={micStatsRef}
        micDeviceId={micDeviceId}
        onMicDeviceChange={handleMicDeviceChange}
        ownColor={ownColor}
        onColorChange={handleColorChange}
        latencyMs={playerLatencies[currentUserName]}
        showVideo={showVideo}
        onToggleVideo={isHost ? undefined : toggleVideo}
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen(p => !p)}
        queueCount={queue.length}
        onFreeClick={togglePlayback}
      />

      {error && (
        <div className="relative z-20 text-center py-4 text-red-400 font-bold">
          {t('party.errorNoData')}
        </div>
      )}

      {/* The video is the background of the whole page, bar included; the
          bar, the note highway, the lyrics and the side panels float over it
          and together cover the whole player, so it never sees the pointer and
          its hover controls never appear. Clicking the free middle toggles
          playback; while the video is not playing a blurred, darkened overlay
          hides YouTube's own UI (title bar, controls, "more videos"). */}
      <div className="absolute inset-0 z-0">
        {showVideo && (
          <VideoPlayer videoId={videoId} onPlayerObject={handlePlayerReady} onStateChange={handleVideoStateChange} onEnd={handleVideoEnd} />
        )}
        {/* Vignette: lets the panels and text read on bright footage */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/45 via-transparent to-black/60" />
        {/* Covers YouTube's title/channel band for a moment after every start and seek */}
        <div aria-hidden="true" className={`absolute inset-x-0 top-0 h-16 pointer-events-none bg-black/90 backdrop-blur-md transition-opacity duration-500 ${titleCover ? 'opacity-100' : 'opacity-0'}`} />
        <div
          aria-hidden="true"
          data-video-state={videoState}
          className={`absolute inset-0 z-10 flex items-center justify-center pointer-events-none transition-colors ${videoState === 1 ? 'bg-transparent' : 'bg-black/80 backdrop-blur-xl'}`}
        >
          {(videoState === 2 || videoState === 0) && (
            <svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor" className="text-white/80">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          )}
          {(videoState === -1 || videoState === 3 || videoState === 5) && (
            <span className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white/80 animate-spin" />
          )}
        </div>
      </div>

      <div className="relative z-20 flex-1 min-h-0 flex flex-col lg:flex-row gap-4 px-4 pb-4 pt-14 overflow-y-auto lg:overflow-hidden">
        {/* Centre: the note highway floats in the middle of the video, the
            lyrics and the timeline sit at the bottom; the free space around
            them pauses / resumes on click */}
        <div className="flex-1 min-w-0 flex flex-col min-h-[60vh] lg:min-h-0">
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={videoState === 1 ? 'Pause' : 'Play'}
            className="flex-1 min-h-4 cursor-pointer bg-transparent"
          />

          {/* No box around the highway: its backdrop fades into the video on
              all sides, while the notes themselves only fade at the left and
              right (the top and bottom rows are real pitches — the lowest and
              highest of the line — and must stay fully visible). A click on
              it pauses / resumes too. */}
          <div className="relative flex-shrink-0 cursor-pointer">
            <div aria-hidden="true" className="absolute inset-0 bg-black/45 [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent),linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)] [mask-composite:intersect] [-webkit-mask-composite:source-in]" />
            <div className="relative [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
              <LiveMusicBars
                store={live}
                isHost={isHost}
                playerColors={playerColors}
                scores={serverScores}
                onClick={togglePlayback}
                gapDragEnabled={isFixingTiming}
                setGap={gap => { if (Number.isFinite(gap)) gapRef.current = gap; }}
              />
            </div>
            {hasDuetLyrics && (
              <button
                onClick={handleDuetToggle}
                className={`absolute top-2 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                  duetMode
                    ? 'bg-neon-purple/15 text-neon-purple border-neon-purple/50 hover:bg-neon-purple/25'
                    : 'bg-surface/60 text-gray-400 border-surface-lighter hover:text-white hover:border-gray-500'
                }`}
                title={duetMode ? t('party.switchSolo') : t('party.switchDuet')}
              >
                <DuetIcon />
                {duetMode ? t('party.duetOn') : t('party.duetOff')}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={togglePlayback}
            aria-label={videoState === 1 ? 'Pause' : 'Play'}
            className="flex-1 min-h-4 cursor-pointer bg-transparent"
          />

          {/* Skip Intro / Outro / Interruption — Netflix-style button above the lyrics.
              Label depends on SponsorBlock segment category. */}
          {activeSkipSegment && isHost && (
            <div className="flex justify-end pb-2">
              <button
                onClick={() => {
                  const player = iframePlayerRef.current;
                  if (player?.seekTo) {
                    player.seekTo(activeSkipSegment.end, true);
                    showTitleCover();
                  }
                  setActiveSkipSegment(null);
                }}
                className="px-5 py-2.5 bg-black/70 hover:bg-black/90 text-white text-sm font-semibold rounded border border-white/40 hover:border-white/70 backdrop-blur-sm transition-all shadow-lg cursor-pointer"
              >
                {activeSkipSegment.category === 'outro'
                  ? t('party.skipOutro')
                  : activeSkipSegment.category === 'music_offtopic'
                    ? t('party.skipInterruption')
                    : t('party.skipIntro')}
              </button>
            </div>
          )}

          <div className="relative flex-shrink-0 rounded-2xl overflow-hidden bg-black/55 backdrop-blur-sm ring-1 ring-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/60 to-transparent pointer-events-none" />
            {/* Lyrics (both singers' lines stacked in a duet) */}
            <LiveStageLyrics store={live} p1Label={t('party.duetP1')} p2Label={t('party.duetP2')} />

            {/* Song timeline: sung stretches marked per singer; the host can seek */}
            <SongTimeline
              store={live}
              regions={timelineRegions}
              duration={videoDuration}
              onSeek={isHost ? seekVideo : undefined}
              label={t('party.timeline')}
            />
          </div>
        </div>

      </div>

      {/* Queue + similar songs: a drawer under the top-right pill */}
      {queueOpen && (
        <div ref={queueDrawerRef} className="absolute top-14 right-4 bottom-4 z-40 w-[22rem] max-w-[calc(100%-2rem)] overflow-y-auto space-y-4">
          <QueuePanel
            queue={queue}
            isHost={isHost}
            currentUserName={currentUserName}
            onAdd={handleQueueAdd}
            onRemove={handleQueueRemove}
            onReorder={handleQueueReorder}
            onSkip={isHost && wss ? handleSkipSong : undefined}
          />

          {similarSongs.length > 0 && (
            <div className="bg-surface-light/80 rounded-lg border border-surface-lighter p-3 backdrop-blur-sm">
              <h3 className="text-white font-bold text-sm mb-2">{t('party.similarSongs')}</h3>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {similarSongs.slice(0, 8).map((song, i) => {
                  const local = song.localMatch;
                  return (
                    <div key={i} className="flex items-center gap-2 group">
                      {local?.videoId && (
                        <img
                          src={`https://i.ytimg.com/vi/${local.videoId}/default.jpg`}
                          alt=""
                          className="w-10 h-7.5 rounded object-cover flex-shrink-0"
                          loading="lazy"
                        />
                      )}
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
      )}

      {/* Song ended overlay */}
      {songEnded && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center"
        >
          <div className="max-w-lg w-full mx-4 text-center">
            {/* Title */}
            <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta leading-normal animate-slide-up drop-shadow-[0_0_30px_rgba(0,229,255,0.5)]">
              {t('party.songComplete')}
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
                  // Every song scores out of the same maximum, so the bar is absolute
                  const barWidth = Math.max(3, (player.score / MAX_SCORE) * 100);
                  const hasCumulative = player.cumulativeScore > player.score;
                  const isMe = player.username === currentUserName;

                  return (
                    <div
                      key={player.username}
                      className={`relative rounded-xl border bg-gradient-to-r ${colorClass} overflow-hidden animate-slide-up`}
                      style={{ animationDelay: `${(i + 1) * 150}ms` }}
                    >
                      {/* Score bar background, with the star thresholds marked */}
                      <div
                        className="absolute inset-y-0 left-0 bg-white/5 transition-all duration-1000 ease-out"
                        style={{ width: `${barWidth}%` }}
                      />
                      {STAR_THRESHOLDS.map(th => (
                        <div key={th} aria-hidden="true" className="absolute inset-y-0 w-px bg-white/10" style={{ left: `${(th / MAX_SCORE) * 100}%` }} />
                      ))}
                      <div className="relative flex items-center gap-3 px-4 py-3">
                        <span className="text-xl w-7 text-center flex-shrink-0">{medal}</span>
                        <div className="flex-1 text-left min-w-0">
                          <div className={`font-bold truncate ${rank === 0 ? "text-lg text-white" : "text-base text-gray-200"}`}>
                            {player.username}
                          </div>
                          {isMe && (player.newBest || player.previousBest != null) && (
                            <div className={`text-xs leading-tight mt-0.5 ${player.newBest ? "text-neon-magenta font-semibold" : "text-gray-400"}`}>
                              {player.newBest ? t('scores.newBest') : t('scores.yourBest', { score: player.previousBest.toLocaleString() })}
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`font-mono font-black ${rank === 0 ? "text-2xl" : "text-lg"} ${scoreColor} leading-tight`}>
                            {player.score.toLocaleString()}
                          </div>
                          <StarRating stars={player.stars ?? starsFor(player.score)} size={rank === 0 ? 15 : 12} className="mt-0.5" />
                          {hasCumulative && (
                            <div className="text-xs text-gray-400 font-mono leading-tight mt-0.5">
                              {t('party.total')} {player.cumulativeScore.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Friends' scores on this song (signed in), or the reason to sign in */}
            {authUser ? (
              songScores?.friends && (
                <div className="mb-6 text-left rounded-xl bg-surface-light/60 border border-surface-lighter px-4 py-3 animate-slide-up">
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">{t('scores.friendsOnSong')}</div>
                  {songScores.friends.every(f => f.username === authUser.username) ? (
                    <div className="text-sm text-gray-500">{t('scores.noFriendScores')}</div>
                  ) : (
                    <ul className="space-y-1">
                      {songScores.friends.slice(0, 6).map(f => {
                        const me = f.username === authUser.username;
                        return (
                          <li key={f.username} className={`flex items-center justify-between gap-3 text-sm ${me ? "text-neon-cyan" : "text-gray-200"}`}>
                            <a href={`/u/${encodeURIComponent(f.username)}`} target="_blank" rel="noopener" className="truncate hover:text-neon-magenta">
                              {me ? t('scores.you') : f.username}
                            </a>
                            <span className="flex items-center gap-2 font-mono flex-shrink-0">
                              <StarRating stars={f.stars} size={11} />
                              {f.score.toLocaleString()}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {mateSuggestions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t('profile.suggestions')}</div>
                      <ul className="space-y-1">
                        {mateSuggestions.slice(0, 4).map(s => (
                          <li key={s.username} className="flex items-center justify-between gap-3 text-sm text-gray-200">
                            <span className="truncate">{s.username}</span>
                            <button
                              type="button"
                              onClick={() => requestFriend(s.username).then(() => setMateSuggestions(m => m.filter(x => x.username !== s.username))).catch(() => {})}
                              className="px-2 py-0.5 rounded border border-neon-cyan/40 text-neon-cyan text-xs font-semibold hover:bg-neon-cyan/10 cursor-pointer flex-shrink-0"
                            >
                              + {t('friends.add')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="mb-6 text-sm">
                <a
                  href={`/login?next=${encodeURIComponent(`/sing/${activeSongId}`)}`}
                  target="_blank"
                  rel="noopener"
                  className="text-gray-400 hover:text-neon-cyan transition-colors"
                >
                  ★ {t('scores.signInToSave')}
                </a>
              </div>
            )}

            {/* Next up + countdown */}
            <div className="flex flex-col items-center gap-4">
              {/* What plays next. With songs in the queue (or for joiners) a
                  line; with an empty queue the host gets tiles: the automatic
                  pick first and highlighted, then more similar songs. */}
              {(() => {
                const next = queue.length > 0 ? queue[0] : nextSongInfo;
                const locals = similarSongs.map(s => s.localMatch).filter(Boolean);
                const choosing = isHost && queue.length === 0 && (next?.songId || locals.length > 0);
                if (!choosing) {
                  if (next?.title) {
                    return (
                      <div className="text-gray-400">
                        {t('party.upNext')} <span className="text-neon-magenta font-semibold">{next.title}</span>
                        <span className="text-gray-500"> - {next.artist}</span>
                      </div>
                    );
                  }
                  return <div className="text-gray-500">{t('party.noMoreSongs')}</div>;
                }
                const tiles = [
                  ...(next?.songId ? [next] : []),
                  ...locals.filter(l => l.songId !== next?.songId),
                ].slice(0, 6);
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full">
                    {tiles.map((song, i) => {
                      const isPick = i === 0 && song.songId === next?.songId;
                      return (
                        <button
                          key={song.songId}
                          type="button"
                          onClick={() => {
                            handleQueueAdd(song);
                            setSongEnded(false);
                            if (wss) sendSongAdvance(wss);
                          }}
                          className={`text-left rounded-lg overflow-hidden border transition-colors cursor-pointer ${
                            isPick
                              ? 'bg-neon-magenta/15 border-neon-magenta ring-2 ring-neon-magenta/50 shadow-[0_0_24px_rgba(255,0,170,0.35)]'
                              : 'bg-surface-light/80 border-surface-lighter hover:border-neon-cyan/60 hover:bg-surface-lighter'
                          }`}
                        >
                          {song.videoId && (
                            <img src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`} alt="" className="w-full aspect-video object-cover" loading="lazy" />
                          )}
                          <div className="p-2">
                            <div className={`text-sm truncate ${isPick ? 'text-neon-magenta font-semibold' : 'text-white'}`}>{song.title}</div>
                            <div className="text-xs text-gray-400 truncate">{song.artist}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="flex items-center gap-4">
                {/* Share score image */}
                <ShareCard songInfo={songInfoRef.current} scores={endScores} currentUserName={currentUserName} songId={activeSongId} />

                {isHost ? (
                  <>
                    {/* Stay here button — host only */}
                    <button
                      onClick={() => {
                        setSongEnded(false);
                        countdownCancelledRef.current = true;
                        countdownStartRef.current = null;
                      }}
                      className="px-4 py-2 rounded-lg bg-surface-lighter/80 text-gray-300 hover:bg-surface-lighter hover:text-white border border-surface-lighter hover:border-gray-500 transition-all text-sm"
                    >
                      {t('party.stayHere')}
                    </button>

                    {/* Next Song button — host only, appears when countdown is cancelled */}
                    {countdownCancelled && (
                      <button
                        onClick={() => {
                          setSongEnded(false);
                          if (wss) sendSongAdvance(wss);
                        }}
                        className="px-5 py-2 rounded-lg bg-gradient-to-r from-neon-cyan/20 to-neon-magenta/20 text-white hover:from-neon-cyan/30 hover:to-neon-magenta/30 border border-neon-cyan/40 hover:border-neon-cyan/60 transition-all text-sm font-semibold"
                      >
                        {t('party.nextSong')}
                      </button>
                    )}
                  </>
                ) : (
                  /* Joiner: show "Waiting for host" when countdown is cancelled */
                  countdownCancelled && (
                    <div className="text-gray-400 text-sm italic">{t('party.waitingForHostAction')}</div>
                  )
                )}

                {/* Countdown circle — visible while countdown is running */}
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
