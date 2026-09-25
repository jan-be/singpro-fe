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
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import MyIcon from "../icon.svg?react";
import { initMicInput } from "../logic/MicrophoneInput";
import { isPitchGpuEnabled } from "../logic/pitchGpuFlag";
import { getGapOverride, setGapOverride, clearGapOverride } from "../logic/gapOverrides";
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
  sendSongLyrics, sendSongGap, sendPartyLeave, sendHostAway, sendPartyClose,
  sendQueueAdd,
  sendQueueRemove,
  sendQueueReorder,
  sendPingReply,
  sendPlayerColor,
  BIN_NOTES_BATCH,
  BIN_NOTES_BATCH_V2,
  BIN_STANDING,
  parseStanding,
  parseBinaryBatch,
} from "../logic/WebsocketHandling";
import QueuePanel from "../components/QueuePanel";
import { defaultHue } from "../logic/playerColor";
import ShareCard from "../components/ShareCard";
import StarRating from "../components/StarRating";
import { useAuth } from "../logic/AuthContext";
import { getSongScores, getSuggestions, requestFriend } from "../logic/authApi";
import { starsFor, MAX_SCORE, STAR_THRESHOLDS } from "../logic/scoreScale";
import { DuetIcon, SpeakerIcon } from "../components/Icons";
import { getSessionId } from "../logic/sessionId";
import { exitFullscreen, toggleFullscreen } from "../logic/fullscreen";
import { getReferrer } from "../logic/referrer";
import { silentReason } from "../logic/silentPlayback";
import { StemPlayer, silentWavUrl } from "../logic/stemPlayer";
import { debugLog, debugError, isDebugEnabled } from "../logic/debugLog";
import DebugOverlay from "../components/DebugOverlay";

// --- Session persistence helpers ---
// Party session is stored in sessionStorage so page reloads / back-navigation
// don't lose the partyId, username, or host status.
const SESSION_KEY = 'singpro_party';

// Stems need Web Audio (GainNodes on <audio> sources). Without it we simply
// keep playing the YouTube audio.
const WEB_AUDIO_SUPPORTED = typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);

// The stems are restarted at the video's time when they are further off than
// this (see alignStems); a start or a drag on the timeline tolerates less.
const MAX_DRIFT = 0.15;
const IMMEDIATE_DRIFT = 0.03;

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
      // Joiners see the video too unless they switched it off (to save data
      // while looking at the big screen); the bar points that switch out once
      return localStorage.getItem('singpro_show_video') !== 'false';
    } catch { return true; }
  });

  // One-time callout for joiners: where to hide the video
  const [videoHint, setVideoHint] = useState(false);
  const dismissVideoHint = useCallback(() => {
    setVideoHint(false);
    try { localStorage.setItem('singpro_video_hint_seen', '1'); } catch { /* */ }
  }, []);
  useEffect(() => {
    if (isHost || !showVideo || !activeSongId || activeSongId === 'none') return;
    try { if (localStorage.getItem('singpro_video_hint_seen') === '1') return; } catch { /* */ }
    setVideoHint(true);
    const id = setTimeout(dismissVideoHint, 15_000);
    return () => clearTimeout(id);
  }, [isHost, showVideo, activeSongId, dismissVideoHint]);

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
    } else if (!isHost && !joinerSoundRef.current) {
      // Joiners start muted: the host's speakers carry the sound, and muted
      // playback is allowed everywhere without a tap (a phone that reopened
      // the tab would otherwise sit on a spinner). "Tap for sound" turns it on.
      try { playerObj.mute(); } catch { /* */ }
      mutedFallbackRef.current = true;
      setStalled('unmute');
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

  // null | 'notFound' (the API answered, there is no such song — a stale or
  // miscased link) | 'unreachable' (we never got an answer). They need
  // different words: one is a dead link, the other is worth retrying.
  const [error, setError] = useState(null);
  const [setOnProcessing, setSetOnProcessing] = useState();
  const [wss, setWss] = useState();
  // Joiners: the host's socket state ({ connected, away }); null for hosts
  const [hostStatus, setHostStatus] = useState(null);
  const [micActive, setMicActive] = useState(false);
  const micActiveRef = useRef(micActive);
  micActiveRef.current = micActive;
  const stopMicRef = useRef(null);
  const micRecorderRef = useRef(null);
  // Pauses / resumes mic processing (pitch detection, recording) with the song
  const micSetActiveRef = useRef(null);

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
  const stemsUnplayableRef = useRef(false); // a stem failed to load or decode: no stems for the rest of the session
  const stemsLoadRef = useRef(null); // { state: 'loading' | 'memory' | 'streaming', ms } for the current song's stems
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
  const stemPlayerRef = useRef(null);    // StemPlayer: both stems decoded, played on the context's clock
  const karaokeGainRef = useRef(null);   // GainNode for instrumental
  const vocalsGainRef = useRef(null);    // GainNode for vocals
  const audioCtxRef = useRef(null);      // shared AudioContext
  const sessionKeeperRef = useRef(null); // silent <audio> looping while the stems play (see keepAudioSession)

  hasStemsRef.current = hasStems;

  // Push volume + vocals level into the stem GainNodes. A slider change is a
  // user gesture, so this is also where a suspended AudioContext (WebKit
  // autoplay policy) gets resumed.
  const applyStemGains = useCallback(() => {
    const master = volumeRef.current / 100;
    if (karaokeGainRef.current) karaokeGainRef.current.gain.value = master * (instrumentalLevelRef.current / 100);
    if (vocalsGainRef.current) vocalsGainRef.current.gain.value = master * (vocalsLevelRef.current / 100);
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(e => debugLog('stems', 'resume() rejected:', e));
  }, []);

  // ── Load and play the stems when they become available ──
  useEffect(() => {
    stemPlayerRef.current?.dispose();
    stemPlayerRef.current = null;
    if (!hasStems || !activeSongId || activeSongId === 'none') {
      stemsLoadRef.current = null;
      return;
    }

    // Mute YouTube — we're serving both stems ourselves
    try { iframePlayerRef.current?.mute(); } catch { /* */ }

    // No usable Web Audio, or stems that do not load or decode: undo the
    // stems setup and let YouTube carry the sound. Otherwise the iframe
    // stays muted for stems that never start, and the phone is silent for
    // every song with nothing to tap. The next song would fail the same
    // way, so stems stay off for the rest of the session.
    const fallBackToYouTube = (why) => {
      debugError('stems', `${why}: using YouTube audio`);
      stemsUnplayableRef.current = true;
      stemsLoadRef.current = null;
      try { iframePlayerRef.current?.unMute(); iframePlayerRef.current?.setVolume(volumeRef.current); } catch { /* */ }
      setHasStems(false);
    };

    // Set up AudioContext + GainNodes (reuse context across songs, recreate if closed)
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        fallBackToYouTube(`Web Audio unavailable (${e.message})`);
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
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    applyStemGains();

    // ?format=caf: Apple's own container for Opus, remuxed for a few songs
    // (an experiment: whether Safari decodes the Ogg file at all); the
    // server answers with the Ogg file where it has no CAF one.
    const format = document.createElement('audio').canPlayType('audio/x-caf; codecs="opus"') ? '?format=caf' : '';
    debugLog('stems', `loading stems for ${activeSongId}${format ? ', asking for caf' : ''}`);

    // Both files are fetched and decoded while the player starts up (see
    // stemPlayer.js); until both are in, the stems cannot start, and
    // silentReason knows a loading stem is not a silent one. Whatever is
    // playing by then, the stems join it at its time.
    const player = new StemPlayer(ctx, { karaoke: karaokeGainRef.current, vocals: vocalsGainRef.current });
    stemPlayerRef.current = player;
    const loadStartedAt = performance.now();
    stemsLoadRef.current = { state: 'loading', startedAt: loadStartedAt };
    player.load({
      karaoke: `${apiUrl}/songs/${activeSongId}/karaoke${format}`,
      vocals: `${apiUrl}/songs/${activeSongId}/vocals${format}`,
    }, { log: (line) => debugLog('stems', line) }).then(() => {
      if (stemPlayerRef.current !== player) return; // the song changed meanwhile
      stemsLoadRef.current = { state: 'memory', ms: Math.round(performance.now() - loadStartedAt) };
      let time = null;
      try {
        if (!isHostRef.current) { if (hostIsPlayingRef.current) time = getHostVideoTime(); }
        else if (iframePlayerRef.current?.getPlayerState?.() === 1) time = iframePlayerRef.current.getCurrentTime?.() ?? 0;
      } catch { /* */ }
      if (time !== null) startStems(time);
    }, (e) => {
      if (stemPlayerRef.current !== player) return;
      fallBackToYouTube(`stems failed to load (${e.message})`);
    });

    return () => {
      player.dispose();
      if (stemPlayerRef.current === player) stemPlayerRef.current = null;
      sessionKeeperRef.current?.pause();
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

  // The stems follow the video: beyond the tolerance they are restarted at
  // the video's time (at once, crossfaded — see stemPlayer.js). `immediate`
  // is a start or a drag on the timeline, where any difference counts.
  const stemSyncRef = useRef({ seeks: 0, drift: 0, lastStartAt: -Infinity });
  const alignStems = useCallback((targetTime, immediate = false) => {
    const player = stemPlayerRef.current;
    if (!player?.loaded) return;
    if (!player.playing) { if (immediate) player.seek(targetTime); return; }
    const st = stemSyncRef.current;
    st.drift = targetTime - player.currentTime;
    if (Math.abs(st.drift) <= (immediate ? IMMEDIATE_DRIFT : MAX_DRIFT)) return;
    // YouTube's clock wobbles for a moment after a start; a restart on every
    // wobble is two audible jumps in a row, so the first second lets it settle
    if (!immediate && performance.now() / 1000 - st.lastStartAt < 1 && Math.abs(st.drift) < 0.5) return;
    player.seek(targetTime);
    st.seeks += 1;
    debugLog('sync', `stems ${st.drift > 0 ? 'behind' : 'ahead'} by ${Math.abs(st.drift).toFixed(2)}s${immediate ? ' (seek)' : ''}: restarted at ${targetTime.toFixed(2)}`);
  }, []);

  // iOS plays Web Audio through the "ambient" audio session, which the
  // ring/silent switch mutes, unless a media element is playing. The stems
  // no longer are one, so a silent one loops while they play (the trick
  // unmute.js uses). Started from startStems, i.e. inside the tap on a phone.
  const keepAudioSession = useCallback(() => {
    let keeper = sessionKeeperRef.current;
    if (!keeper) {
      keeper = new Audio(silentWavUrl());
      keeper.loop = true;
      sessionKeeperRef.current = keeper;
    }
    if (keeper.paused) keeper.play().catch(e => debugLog('stems', 'session keeper play() rejected:', e));
  }, []);

  // Start (or catch up) both stems at a song time. The AudioContext is
  // resumed here too: the browsers that suspend it only let a user gesture
  // resume it, and every gesture that concerns the stems (the "tap for
  // sound", a slider) ends up here; the watchdog below turns a context that
  // stays suspended into the "tap for sound" prompt rather than silence.
  const startStems = useCallback((time) => {
    const player = stemPlayerRef.current;
    if (!player?.loaded) return;
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'running') ctx.resume().catch(e => debugLog('stems', 'resume() rejected:', e));
    keepAudioSession();
    if (player.playing) alignStems(time);
    else {
      player.play(time);
      stemSyncRef.current.lastStartAt = performance.now() / 1000;
      debugLog('sync', `stems started at ${time.toFixed(2)}`);
    }
  }, [alignStems, keepAudioSession]);

  const pauseStems = useCallback(() => {
    stemPlayerRef.current?.pause();
    sessionKeeperRef.current?.pause();
  }, []);

  // Periodic sync: keep the stems on the video's time during playback
  useEffect(() => {
    if (!hasStems) return;
    const id = setInterval(() => {
      if (!stemPlayerRef.current?.playing) return;
      alignStems(isHost ? (iframePlayerRef.current?.getCurrentTime?.() ?? 0) : getHostVideoTime());
    }, 500);
    return () => clearInterval(id);
  }, [hasStems, isHost, alignStems]); // eslint-disable-line react-hooks/exhaustive-deps

  // For non-host joiners: sync stem audio with host time on video:time messages.
  const syncStemsToTime = useCallback((time, playing) => {
    if (playing) startStems(time);
    else pauseStems();
  }, [startStems, pauseStems]);

  // Clean up AudioContext on unmount
  useEffect(() => {
    return () => {
      stemPlayerRef.current?.dispose();
      sessionKeeperRef.current?.pause();
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
  // Joiners: the timing the host announced for the current song (party:gap)
  const hostGapRef = useRef(null);
  // Host: announce timing changes to the party (server scoring + joiners), debounced
  const gapSyncTimerRef = useRef(null);
  const syncGapToParty = useCallback((gap) => {
    if (!isHostRef.current) return;
    clearTimeout(gapSyncTimerRef.current);
    gapSyncTimerRef.current = setTimeout(() => {
      const w = wssRef.current;
      if (w && w.readyState === WebSocket.OPEN) sendSongGap(w, { gap });
    }, 250);
  }, []);

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
  const lastPlayRequestRef = useRef(0); // joiner: when playVideo() was last asked for

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
    alignStems(seconds, true); // the stems jump with it, not at the next sync
    showTitleCover();
  }, [showTitleCover, alignStems]);
  const togglePlayback = useCallback(() => {
    if (popoverJustClosed()) return; // that click only dismissed a popover
    const player = iframePlayerRef.current;
    if (!player) return;
    try { if (player.getPlayerState?.() === 1) player.pauseVideo?.(); else player.playVideo?.(); } catch { /* */ }
  }, []);

  // The free stage pauses on a click and toggles fullscreen on a double one,
  // the way a video player does. Counting the clicks here rather than pairing
  // onClick with onDoubleClick keeps it working for the call sites that pass
  // no event (the bar's free area, the note highway's canvas), and means a
  // double click never pauses on its way to fullscreen — the price is that
  // the pause waits out the double-click window.
  const DOUBLE_CLICK_MS = 250;
  const clickTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(clickTimerRef.current), []);
  const handleStageClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      if (!popoverJustClosed()) toggleFullscreen();
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      togglePlayback();
    }, DOUBLE_CLICK_MS);
  }, [togglePlayback]);

  const handleVideoStateChange = useCallback((state) => {
    if (!isHost) {
      playerStateRef.current = state;
    }
    setVideoState(state);
    if (state === 1) showTitleCover();
    // The host's own player is the song's clock: no pitch detection or
    // recording while it stands still (paused, buffering, ended, not started)
    if (isHost) micSetActiveRef.current?.(state === 1);
    try { const d = iframePlayerRef.current?.getDuration?.(); if (d > 0) setVideoDuration(prev => (Math.abs(prev - d) > 0.5 ? d : prev)); } catch { /* */ }

    // Sync stem audio with YouTube player state
    if (!hasStemsRef.current) return;
    if (state === 1) { // playing
      const player = iframePlayerRef.current;
      if (player) startStems(player.getCurrentTime?.() ?? 0);
    } else if (state === 2 || state === 0) { // paused, ended
      pauseStems();
    }
  }, [isHost, startStems, pauseStems]);

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

  // ── Playback that never starts ──
  // Browsers refuse to start a video with sound until the page has been
  // tapped (after a reload, or on a phone). When the player sits in
  // unstarted / cued while it should be playing, joiners fall back to muted
  // playback (always allowed) and get a button to turn the sound on; if even
  // that does not start, or for the host, the button starts playback — its
  // click is the gesture the browser wants.
  // 'video': our overlays step aside so YouTube's own play button can be
  // tapped — the one gesture every platform accepts — after a tap of ours
  // did not help
  const [stalled, setStalled] = useState(null); // null | 'tap' | 'unmute' | 'video'
  // YouTube refused the video outright (embedding disabled, removed, player
  // error). Nothing a tap can fix, so it replaces the stall prompts.
  const [videoError, setVideoError] = useState(null);
  const [stallRetry, setStallRetry] = useState(0); // a tap that did not help re-arms the watch below
  const tapCountRef = useRef(0);
  const stalledRef = useRef(null);
  stalledRef.current = stalled;
  const mutedFallbackRef = useRef(false); // the iframe is muted by us (joiner start, or the fallback)
  const mutedAtRef = useRef(0);
  const notPlayingSinceRef = useRef(0); // survives the state flapping a blocked player does on every play request
  const joinerSoundRef = useRef((() => { try { return localStorage.getItem('singpro_joiner_sound') === '1'; } catch { return false; } })());
  useEffect(() => {
    if (!showVideo) { setStalled(null); mutedFallbackRef.current = false; return; } // no player, nothing to tap for
    if (videoError !== null) { setStalled(null); return; } // the video will not start, whatever we tap
    if (videoState === 1) {
      notPlayingSinceRef.current = 0;
      mutedAtRef.current = 0;
      tapCountRef.current = 0;
      if (stalledRef.current === 'tap' || stalledRef.current === 'video') setStalled(mutedFallbackRef.current ? 'unmute' : null);
      return;
    }
    if (videoState !== -1 && videoState !== 5 && videoState !== 3) { notPlayingSinceRef.current = 0; setStalled(null); return; } // paused / ended: on purpose
    // The state stays -1 from before the player exists, so poll: the clock
    // starts once there is a player (and, for joiners, something to play)
    const limit = videoState === 3 ? 8000 : 2000; // buffering is normal for a while
    const id = setInterval(() => {
      const player = iframePlayerRef.current;
      if (!player) return;
      if (!isHost && !hostIsPlayingRef.current) { notPlayingSinceRef.current = 0; return; } // nothing to play yet
      if (!notPlayingSinceRef.current) notPlayingSinceRef.current = performance.now();
      if (performance.now() - notPlayingSinceRef.current < limit) return;
      if (!isHost && !mutedFallbackRef.current && !hasStemsRef.current) {
        mutedFallbackRef.current = true;
        mutedAtRef.current = performance.now();
        try { player.mute(); player.playVideo(); } catch { /* */ }
        setStalled('unmute');
        return;
      }
      if (mutedAtRef.current && performance.now() - mutedAtRef.current < 1500) return; // give the muted attempt a moment
      setStalled(tapCountRef.current > 0 ? 'video' : 'tap');
      clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [videoState, showVideo, isHost, stallRetry, videoError]);

  const handleStalledTap = useCallback(() => {
    const player = iframePlayerRef.current;
    debugLog('tap', `tap for ${stalledRef.current}, stems=${hasStemsRef.current}`);
    try {
      if (hasStemsRef.current) {
        // Inside the tap: the one place a phone lets the stems start. A
        // joiner may have hidden the video, so this does not need a player.
        startStems(isHostRef.current ? (player?.getCurrentTime?.() ?? 0) : getHostVideoTime());
      } else if (mutedFallbackRef.current && player) {
        player.unMute();
        player.setVolume(volumeRef.current);
        joinerSoundRef.current = true; // next time start with sound
        try { localStorage.setItem('singpro_joiner_sound', '1'); } catch { /* */ }
      }
      if (player && player.getPlayerState?.() !== 1) player.playVideo();
    } catch { /* */ }
    mutedFallbackRef.current = false;
    tapCountRef.current += 1;
    setStalled(null);
    setStallRetry(n => n + 1);
  }, [startStems]);

  // ── Sound that never starts ──
  // The video can be running while nothing is heard (see silentReason):
  // the stems could not start without a gesture, or YouTube muted itself
  // when the browser blocked autoplay with sound. Its own unmute button is
  // under our overlays, so the page offers "tap for sound" instead, once
  // the silence has lasted two checks (a stem that is merely about to start
  // is not silence).
  const silentChecksRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (stalledRef.current) return; // already asking for a tap
      const player = iframePlayerRef.current;
      let playing = false;
      let iframeMuted = false;
      try {
        playing = isHostRef.current ? player?.getPlayerState?.() === 1 : hostIsPlayingRef.current;
        iframeMuted = !!player?.isMuted?.();
      } catch { return; }
      const sp = stemPlayerRef.current;
      const reason = silentReason({
        playing,
        hasStems: hasStemsRef.current,
        stem: sp ? { paused: !sp.playing, failed: false, ended: sp.ended, loading: !sp.loaded } : null,
        ctxState: audioCtxRef.current?.state,
        iframeMuted,
        mutedByUs: mutedFallbackRef.current,
        volume: volumeRef.current,
      });
      silentChecksRef.current = reason ? silentChecksRef.current + 1 : 0;
      if (silentChecksRef.current < 2) return;
      silentChecksRef.current = 0;
      if (reason === 'iframe') mutedFallbackRef.current = true; // the tap unmutes it
      debugLog('watchdog', `silent: ${reason}`);
      setStalled('unmute');
    }, 500);
    return () => clearInterval(id);
  }, []); // stable — reads refs, not state

  // Countdown start time for the score screen
  const countdownStartRef = useRef(null);

  // Fetch song data and start animation loop
  useEffect(() => {
    if (!activeSongId || activeSongId === 'none') return;

    let rafId;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const resp = await fetch(`${apiUrl}/songs/${activeSongId}`);
        if (!resp.ok && resp.status !== 404) throw new Error(`songs/${activeSongId}: HTTP ${resp.status}`);
        const jsonObj = resp.status === 404 ? { data: null } : await resp.json();

        if (cancelled) return;

        if (!jsonObj.data) {
          console.error("Song API returned no data for", activeSongId);
          setError('notFound');
          return;
        }

        // The server resolves a miscased ID to the real song, so the one we
        // asked for is not always the one we got. Adopt the canonical ID
        // before anything downstream keys off it — the party, the scores,
        // the recordings and the share links all use this string. Setting
        // the state re-runs this effect, which then hits the exact match.
        const canonicalId = jsonObj.data.songId;
        if (canonicalId && canonicalId !== activeSongId) {
          setActiveSongId(canonicalId);
          return;
        }

        // Update URL cosmetically (no navigation / remount)
        if (activeSongId) {
          window.history.replaceState(null, '', `/sing/${activeSongId}${window.location.search}`);
        }

        songInfoRef.current = jsonObj.data;
        skipSegmentsRef.current = jsonObj.data.skipSegments ?? [];
        setActiveSkipSegment(null);
        setHasStems(Boolean(jsonObj.data.hasStems) && WEB_AUDIO_SUPPORTED && !stemsUnplayableRef.current);

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

          // Timing priority: saved on this device (host) > shared correction > the
          // file's #GAP; joiners follow whatever the host announced for this song
          const localGap = isHostRef.current ? getGapOverride(activeSongId) : null;
          if (localGap != null) {
            lyricData.gap = localGap;
          } else if (jsonObj.data.gap) {
            lyricData.gap = Number(jsonObj.data.gap);
          }
          if (!isHostRef.current && hostGapRef.current?.songId === activeSongId) {
            lyricData.gap = hostGapRef.current.gap;
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
          setVideoError(null);

          // Record listen
          const sessionId = getSessionId();
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
              referrer: getReferrer(),
            }),
          }).catch(() => {});

          // Start audio recording for the active song if microphone is active
          startRecordingIfActive(activeSongId, jsonObj.data, lyricData);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError('unreachable');
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
    const sessionId = getSessionId();
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

  // Going to the menu: a host keeps the party (joiners wait; the server is
  // told so it does not take this for a lost host), a joiner leaves it for
  // good (a closed socket alone reads as a reload and keeps the seat).
  const handleGoToMenu = useCallback(() => {
    exitFullscreen(); // the menu is not worth a full screen, and a TV has no easy way out of one
    const w = wssRef.current;
    const open = w && w.readyState === WebSocket.OPEN;
    if (isHostRef.current) {
      if (open) sendHostAway(w);
    } else {
      if (open) sendPartyLeave(w);
      clearPartySession();
    }
  }, []);

  // The host ends the party: everyone is sent home
  const handleEndParty = useCallback(() => {
    exitFullscreen();
    const w = wssRef.current;
    if (w && w.readyState === WebSocket.OPEN) sendPartyClose(w);
    clearPartySession();
    document.title = 'singpro.app';
    navigate('/', { replace: true, state: { partyNotice: 'ended' } });
  }, [navigate]);

  // Join singing — init microphone on demand
  const micStatsRef = useRef(null);

  // What ?debug shows (DebugOverlay): everything that can leave a phone
  // silent, then the mic pipeline. Read from refs, so the callback is stable.
  const [debugEnabled] = useState(isDebugEnabled);
  const debugStateRef = useRef({});
  debugStateRef.current = { activeSongId, isHost, showVideo, videoState, stalled, hasStems, volume, vocalsLevel, instrumentalLevel };
  const debugSnapshot = useCallback(() => {
    const s = debugStateRef.current;
    const lines = [`song=${s.activeSongId} host=${s.isHost} video=${s.showVideo ? s.videoState : 'hidden'} stalled=${s.stalled} stems=${s.hasStems}${stemsUnplayableRef.current ? ' (unplayable)' : ''} vol=${s.volume} vocals=${s.vocalsLevel} instr=${s.instrumentalLevel}`];
    const player = iframePlayerRef.current;
    let yt = 'none';
    try {
      if (player) yt = `state=${player.getPlayerState?.()} muted=${player.isMuted?.()} vol=${player.getVolume?.()} t=${player.getCurrentTime?.()?.toFixed?.(1)}`;
    } catch (e) { yt = `error: ${e.message}`; }
    lines.push(`youtube: ${yt}`);
    const ctx = audioCtxRef.current;
    lines.push(`audioCtx: ${ctx ? `${ctx.state} ${ctx.sampleRate}Hz` : 'none'} gain k=${karaokeGainRef.current?.gain.value.toFixed(2) ?? '-'} v=${vocalsGainRef.current?.gain.value.toFixed(2) ?? '-'}`);
    const sp = stemPlayerRef.current;
    const keeper = sessionKeeperRef.current;
    lines.push(sp
      ? `stems: ${!sp.loaded ? 'loading' : sp.playing ? 'playing' : 'paused'} t=${sp.currentTime.toFixed(2)} dur=${sp.duration.toFixed(0)}${sp.ended ? ' ended' : ''} keeper=${keeper ? (keeper.paused ? 'paused' : 'playing') : 'none'}`
      : 'stems: none');
    const st = stemSyncRef.current;
    const load = stemsLoadRef.current;
    lines.push(`sync: video-stems=${st.drift.toFixed(2)}s seeks=${st.seeks} load=${load ? `${load.state}${load.ms ? ` ${load.ms}ms` : ''}` : 'none'}`);
    const probe = document.createElement('audio');
    lines.push(`canPlay: ogg/opus="${probe.canPlayType('audio/ogg; codecs="opus"')}" opus="${probe.canPlayType('audio/opus')}" webm/opus="${probe.canPlayType('audio/webm; codecs="opus"')}" mp4/aac="${probe.canPlayType('audio/mp4; codecs="mp4a.40.2"')}"`);
    lines.push(`audioSession=${navigator.audioSession?.type ?? 'n/a'} visible=${document.visibilityState} online=${navigator.onLine}`);
    const m = micStatsRef.current;
    lines.push(m
      ? `mic: ${m.active === false ? 'idle' : 'active'} ${m.provider ?? 'wasm'} chunks=${m.totalChunks} (${m.chunksPerSec}/s) notes=${m.totalNotes} (${m.notesPerSec}/s) gated=${m.gatedChunks} infer=${(m.inferMs ?? 0).toFixed(1)}ms${m.inferErrors ? ` errors=${m.inferErrors}` : ''} floor=${m.noiseFloor?.toFixed(5)} last=${m.lastNote} vol=${m.lastVolume?.toFixed(4)}`
      : 'mic: not active');
    lines.push(navigator.userAgent);
    return lines.join('\n');
  }, []);
  // Input device for singing (chosen in the microphone panel); remembered across sessions
  const [micDeviceId, setMicDeviceId] = useState(() => {
    try { return localStorage.getItem('singpro_mic_device') || null; } catch { return null; }
  });
  // Whether the song is running right now: the host asks its own player,
  // joiners follow the host's clock (their own player may be muted, hidden,
  // still loading or waiting for a tap, none of which should silence them)
  const isSongPlaying = useCallback(() => {
    if (!isHostRef.current) return hostIsPlayingRef.current;
    try { return iframePlayerRef.current?.getPlayerState?.() === 1; } catch { return false; }
  }, []);
  const joinSingingWith = useCallback(async (deviceId) => {
    if (stopMicRef.current) return; // already singing
    try {
      const result = await initMicInput({ deviceId: deviceId || undefined, gpu: isPitchGpuEnabled() });
      stopMicRef.current = result.stopMicInput;
      micStatsRef.current = result.stats;
      micRecorderRef.current = result.recorder;
      micSetActiveRef.current = result.setActive;
      result.setActive(isSongPlaying());
      try { localStorage.setItem('singpro_mic_on', '1'); } catch { /* */ }
      micActiveRef.current = true;
      setSetOnProcessing(() => result.setOnProcessing);
      setMicActive(true);
      startRecordingIfActive(activeSongIdRef.current, songInfoRef.current, lyricDataRef.current, result.recorder);
    } catch (e) {
      console.warn("Microphone access denied or unavailable:", e.message);
    }
  }, [startRecordingIfActive, isSongPlaying]);
  const handleJoinSinging = useCallback(() => joinSingingWith(micDeviceId), [joinSingingWith, micDeviceId]);

  // Leave singing — stop microphone
  const handleLeaveSinging = useCallback(() => {
    try { localStorage.setItem('singpro_mic_on', '0'); } catch { /* */ }
    stopAndUploadRecording();
    stopMicRef.current?.();
    stopMicRef.current = null;
    micRecorderRef.current = null;
    micSetActiveRef.current = null;
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

  // The microphone comes back the way it was for the previous song: joiners
  // start singing unless they switched the mic off before, hosts only once
  // they joined singing before
  useEffect(() => {
    let remembered = null;
    try { remembered = localStorage.getItem('singpro_mic_on'); } catch { /* */ }
    const wantMic = remembered == null ? !isHost : remembered === '1';
    if (wantMic && !micActive) {
      handleJoinSinging();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Process mic input — uses refs to avoid re-registering the callback on every tick
  useEffect(() => {
    setOnProcessing && setOnProcessing(msg => {
      const { freq, error } = msg.data;
      if (error) { console.error("[pitch worklet]", error); return; }

      // The mic pipeline idles while the song is paused (micSetActiveRef);
      // this drops whatever was still in flight when it stopped.
      if (!isSongPlaying()) return;
      const player = iframePlayerRef.current;

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
  }, [setOnProcessing, isSongPlaying]);

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
        const kind = view.byteLength > 0 ? view.getUint8(0) : 0;
        if (kind === BIN_NOTES_BATCH || kind === BIN_NOTES_BATCH_V2) {
          const { data } = parseBinaryBatch(msg.data);
          const remoteNotes = data.notes.filter(n => n.username !== currentUserNameRef.current);
          if (remoteNotes.length > 0) {
            live.notes = applyRemoteNotes(live.notes, remoteNotes);
          }
          // Each note carries its singer's score (own notes included: the
          // server's number is the one on the board). Into the live store, not
          // React state -- MusicBars reads it per frame, and twenty batches a
          // second must not reconcile the whole page.
          for (const n of data.notes) if (n.score !== undefined) live.scores[n.username] = n.score;
        } else if (kind === BIN_STANDING) {
          live.standing = parseStanding(msg.data); // own rank in a crowd that does not fit on screen
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

      // Who the big screen shows once the party outgrew its lanes; null while everyone fits
      if (jsonObj.type === "party:lanes") {
        const { pinned, spotlight } = jsonObj.data ?? {};
        live.lanes = pinned ? { pinned, spotlight: spotlight ?? [] } : null;
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
        const removed = jsonObj.data.removed ?? [];
        const entries = {};
        for (const p of players) {
          entries[p.username] = { score: p.score ?? 0, cumulativeScore: p.cumulativeScore ?? 0 };
        }
        if (jsonObj.data.partial) {
          // one singer appeared or left; the rest of the board stands
          setServerScores(prev => {
            const next = { ...(prev ?? {}), ...entries };
            for (const u of removed) delete next[u];
            return next;
          });
          for (const u of [...removed, ...Object.keys(entries)]) delete live.scores[u];
        } else {
          setServerScores(entries);
          live.resetScores(); // in order on the socket, so this board is newer than any score that rode on a note
        }
        learnPlayerColors(players);
      }

      if (jsonObj.type === "party:song_started") {
        const s = jsonObj.data?.currentSong ?? jsonObj.data;
        if (s?.songId && s.songId !== activeSongIdRef.current) {
          // Update song in-place — NO navigate(), NO remount
          setSongEnded(false);
          live.resetNotes();
          live.resetScores();
          live.resetLanes();
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
        micSetActiveRef.current?.(hostIsPlayingRef.current);

        // Sync stem audio for non-host joiners
        syncStemsToTime(jsonObj.data.videoTime ?? 0, !!jsonObj.data.isPlaying);

        const player = iframePlayerRef.current;
        if (player) {
          let st;
          try { st = player.getPlayerState?.(); } catch { st = undefined; }
          if (jsonObj.data.isPlaying) {
            // Ask once in a while, not three times a second: a player whose
            // start is blocked flaps between states on every request and never settles
            const now = performance.now();
            if (st !== 1 && st !== 3 && now - lastPlayRequestRef.current > 1500) {
              lastPlayRequestRef.current = now;
              player.playVideo?.();
            }
          } else if (st === 1 || st === 3) {
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

      // The host's timing for the current song (party:gap, also carried by song:lyrics_loaded)
      if ((jsonObj.type === "party:gap" || jsonObj.type === "song:lyrics_loaded") && !isHost && Number.isFinite(Number(jsonObj.data?.gap))) {
        const gap = Number(jsonObj.data.gap);
        hostGapRef.current = { songId: jsonObj.data.songId ?? activeSongIdRef.current, gap };
        if (!jsonObj.data.songId || jsonObj.data.songId === activeSongIdRef.current) gapRef.current = gap;
      }

      // The host's socket state: joiners wait while the host is at the menu or
      // reconnecting, and are sent home once the party is closed
      if (!isHost && jsonObj.type === "party:state" && jsonObj.data) {
        setHostStatus({ connected: jsonObj.data.hostConnected !== false, away: !!jsonObj.data.hostAway });
      }
      if (!isHost && jsonObj.type === "party:host_status") {
        const status = { connected: !!jsonObj.data?.connected, away: !!jsonObj.data?.away };
        setHostStatus(status);
        if (!status.connected) {
          // nothing plays without the host: idle the mic, pause our copy of the video
          hostIsPlayingRef.current = false;
          micSetActiveRef.current?.(false);
          try { iframePlayerRef.current?.pauseVideo?.(); } catch { /* */ }
        }
      }
      if (jsonObj.type === "party:closed") {
        clearPartySession();
        document.title = 'singpro.app';
        navigate('/', { replace: true, state: { partyNotice: jsonObj.data?.reason === 'ended' ? 'ended' : 'host_left' } });
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
    // Whatever arrived between opening the socket and this render (the
    // party:state answer to our join, usually) is handled now
    for (const e of wss.backlog?.splice(0) ?? []) handler(e);
    return () => { wss.onmessage = null; };
  }, [wss, isHost, syncStemsToTime]);

  // Queue handlers
  // `source` (queue-search | queue-similar) and the search session go along for the admin statistics
  const handleQueueAdd = useCallback((song, source = 'queue-search', searchId) => {
    if (wss) sendQueueAdd(wss, { songId: song.songId, artist: song.artist, title: song.title, videoId: song.videoId, source, searchId });
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
    handleGoToMenu();
    clearPartySession();
    document.title = 'singpro.app';
    if (wss) {
      try { wss.close(); } catch { /* */ }
    }
    navigate('/', { replace: true });
  }, [wss, navigate, handleGoToMenu]);

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
            onClick={() => { handleGoToMenu(); navigate('/'); }}
            className="mt-4 px-6 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/20 transition-all text-sm font-semibold"
          >
            {t('party.browseSongs')}
          </button>
          <button
            onClick={handleEndParty}
            className="mt-2 px-6 py-2 rounded-lg bg-surface-light border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all text-sm"
          >
            {t('party.endParty')}
          </button>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-gradient-to-b from-surface to-[#0a0a1a] flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-neon-cyan font-mono text-lg animate-pulse">
          {t('party.waitingForHost')}
        </div>
        {hostStatus && !hostStatus.connected && (
          <div className="text-gray-400 text-sm text-center">{hostStatus.away ? t('party.hostAway') : t('party.hostDisconnected')}</div>
        )}
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
        onGoToMenu={handleGoToMenu}
        onEndParty={handleEndParty}
        onLeaveParty={handleLeaveParty}
        autoSkip={autoSkip}
        onToggleAutoSkip={toggleAutoSkip}
        isFixingTiming={isFixingTiming}
        onFixingTimingChange={setIsFixingTiming}
        gapData={{
          gap: liveGap,
          defaultGap: liveDefaultGap,
          setGap: gap => { if (Number.isFinite(gap)) { gapRef.current = gap; syncGapToParty(gap); } },
          saveLocal: gap => setGapOverride(activeSongIdRef.current, gap),
          onSubmitted: () => clearGapOverride(activeSongIdRef.current),
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
        videoHint={videoHint}
        onDismissVideoHint={dismissVideoHint}
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen(p => !p)}
        queueCount={queue.length}
        onFreeClick={handleStageClick}
      />

      {error && (
        <div className="relative z-20 text-center py-6 px-6 flex flex-col items-center gap-3">
          <div className="text-red-400 font-bold">
            {error === 'notFound' ? t('party.songNotFound') : t('party.apiUnreachable')}
          </div>
          <div className="text-gray-400 text-sm max-w-md">
            {error === 'notFound' ? t('party.songNotFoundHint') : t('party.apiUnreachableHint')}
          </div>
          {error === 'notFound' ? (
            <Link to="/" onClick={handleGoToMenu} className="px-6 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/20 transition-all text-sm font-semibold no-underline">
              {t('party.browseSongs')}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/20 transition-all text-sm font-semibold cursor-pointer"
            >
              {t('party.retry')}
            </button>
          )}
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
          <VideoPlayer videoId={videoId} onPlayerObject={handlePlayerReady} onStateChange={handleVideoStateChange} onEnd={handleVideoEnd} onError={setVideoError} />
        )}
        {/* Vignette: lets the panels and text read on bright footage */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/45 via-transparent to-black/60" />
        {/* Covers YouTube's title/channel band for a moment after every start and seek */}
        {showVideo && (
          <div aria-hidden="true" className={`absolute inset-x-0 top-0 h-16 pointer-events-none bg-black/90 backdrop-blur-md transition-opacity duration-500 ${titleCover && stalled !== 'video' ? 'opacity-100' : 'opacity-0'}`} />
        )}
        {/* Player state (only with a player: without one there is nothing to wait for) */}
        {showVideo && (
          <div
            aria-hidden="true"
            data-video-state={videoState}
            data-stalled={stalled ?? undefined}
            className={`absolute inset-0 z-10 flex items-center justify-center pointer-events-none transition-colors ${videoState === 1 || stalled === 'video' ? 'bg-transparent' : 'bg-black/80 backdrop-blur-xl'}`}
          >
            {stalled !== 'video' && (videoState === 2 || videoState === 0) && (
              <svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor" className="text-white/80">
                <polygon points="6 3 20 12 6 21 6 3" />
              </svg>
            )}
            {stalled !== 'video' && (videoState === -1 || videoState === 3 || videoState === 5) && (
              <span className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white/80 animate-spin" />
            )}
          </div>
        )}
      </div>

      {videoError !== null && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none px-6">
          <div className="max-w-sm px-5 py-3 rounded-2xl bg-black/75 backdrop-blur-md border border-white/25 text-white text-center text-sm shadow-lg animate-slide-up">
            {t('party.videoError', { code: videoError })}
          </div>
        </div>
      )}

      {/* Playback needs a tap (autoplay blocked), or plays muted and needs one for sound */}
      {stalled === 'video' && (
        <div className="absolute inset-x-0 top-16 z-30 flex justify-center pointer-events-none">
          <div className="px-4 py-2 rounded-full bg-black/70 backdrop-blur-md border border-white/25 text-white text-sm font-semibold shadow-lg animate-slide-up">
            {t('party.tapVideo')}
          </div>
        </div>
      )}
      {stalled && stalled !== 'video' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <button
            type="button"
            onClick={handleStalledTap}
            className="pointer-events-auto flex items-center gap-3 px-6 py-3 rounded-full bg-black/70 backdrop-blur-md border border-white/25 text-white text-lg font-semibold shadow-[0_0_30px_rgba(0,229,255,0.25)] hover:bg-black/85 hover:border-neon-cyan/60 transition-all cursor-pointer animate-slide-up"
          >
            {stalled === 'unmute'
              ? <SpeakerIcon level={0} size={22} />
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg>}
            {stalled === 'unmute' ? t('party.tapForSound') : t('party.tapToPlay')}
          </button>
        </div>
      )}

      {!isHost && hostStatus && !hostStatus.connected && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <div className="text-white text-lg font-semibold animate-pulse">{hostStatus.away ? t('party.hostAway') : t('party.hostDisconnected')}</div>
            <button
              type="button"
              onClick={handleLeaveParty}
              className="px-6 py-2 rounded-lg bg-surface-light border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all text-sm cursor-pointer"
            >
              {t('party.leaveParty')}
            </button>
          </div>
        </div>
      )}

      <div className={`relative z-20 flex-1 min-h-0 flex flex-col lg:flex-row gap-4 px-4 pb-4 pt-14 overflow-y-auto lg:overflow-hidden ${stalled === 'video' ? 'pointer-events-none' : ''}`}>
        {/* Centre: the note highway floats in the middle of the video, the
            lyrics and the timeline sit at the bottom; the free space around
            them pauses / resumes on click */}
        <div className="flex-1 min-w-0 flex flex-col min-h-[60vh] lg:min-h-0">
          <button
            type="button"
            onClick={handleStageClick}
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
                onClick={handleStageClick}
                gapDragEnabled={isFixingTiming}
                setGap={gap => { if (Number.isFinite(gap)) { gapRef.current = gap; syncGapToParty(gap); } }}
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
            onClick={handleStageClick}
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
                          onClick={() => handleQueueAdd(local, 'queue-similar')}
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
        // Scrolls when the content is taller than the screen (phones in
        // landscape); centred otherwise
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md overflow-y-auto">
          {/* singpro.app: back to the menu (a host keeps the party, a joiner leaves it) */}
          <Link to="/" onClick={handleGoToMenu} className="fixed top-2 left-2 sm:top-3 sm:left-4 z-10 flex items-center gap-2 no-underline transition-colors rounded-lg px-2 py-1 bg-surface-light/70 backdrop-blur-sm hover:bg-surface-light">
            <MyIcon width="16" height="16" />
            <span className="font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent leading-normal">singpro.app</span>
          </Link>
          <div className="min-h-full flex p-4 pt-12 short:p-2 short:pt-10">
          <div className="m-auto w-full max-w-lg text-center">
            {/* Title */}
            <h2 className="text-3xl sm:text-4xl md:text-5xl short:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta leading-normal animate-slide-up drop-shadow-[0_0_30px_rgba(0,229,255,0.5)]">
              {t('party.songComplete')}
            </h2>

            {/* Leaderboard */}
            {endScores.length > 0 && (
              <div className="space-y-3 short:space-y-1.5 mb-8 short:mb-3">
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
                      <div className="relative flex items-center gap-3 px-4 py-3 short:py-1.5">
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
                <div className="mb-6 short:mb-3 text-left rounded-xl bg-surface-light/60 border border-surface-lighter px-4 py-3 short:py-2 animate-slide-up">
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
              <div className="mb-6 short:mb-3 text-sm">
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
            <div className="flex flex-col items-center gap-4 short:gap-2">
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
                  <div className="grid grid-cols-3 gap-2 w-full">
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
                          className={`text-left rounded-lg overflow-hidden border transition-colors cursor-pointer ${i >= 3 ? 'short:hidden' : ''} ${
                            isPick
                              ? 'bg-neon-magenta/15 border-neon-magenta ring-2 ring-neon-magenta/50 shadow-[0_0_24px_rgba(255,0,170,0.35)]'
                              : 'bg-surface-light/80 border-surface-lighter hover:border-neon-cyan/60 hover:bg-surface-lighter'
                          }`}
                        >
                          {song.videoId && (
                            <img src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`} alt="" className="w-full aspect-video object-cover" loading="lazy" />
                          )}
                          <div className="p-1.5 sm:p-2">
                            <div className={`text-xs sm:text-sm truncate ${isPick ? 'text-neon-magenta font-semibold' : 'text-white'}`}>{song.title}</div>
                            <div className="text-[11px] sm:text-xs text-gray-400 truncate">{song.artist}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
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
                      className="px-4 py-2 rounded-lg bg-surface-lighter/80 text-gray-300 hover:bg-surface-lighter hover:text-white border border-surface-lighter hover:border-gray-500 transition-all text-sm whitespace-nowrap"
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
                        className="px-5 py-2 rounded-lg bg-gradient-to-r from-neon-cyan/20 to-neon-magenta/20 text-white hover:from-neon-cyan/30 hover:to-neon-magenta/30 border border-neon-cyan/40 hover:border-neon-cyan/60 transition-all text-sm font-semibold whitespace-nowrap"
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
        </div>
      )}

      {debugEnabled && <DebugOverlay snapshot={debugSnapshot} />}
    </div>
  );
};

export default PartyPage;
