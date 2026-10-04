import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";
import BackgroundImage from "../components/BackgroundImage";
import { LiveStageLyrics, LiveMusicBars } from "../components/LiveView";
import SongTimeline from "../components/SongTimeline";
import { songRegions } from "../logic/songRegions";
import { popoverJustClosed, markPopoverClosed } from "../logic/popoverGuard";
import { createLiveStore, useLiveValue } from "../logic/liveStore";
import { createValueStore } from "../logic/valueStore";
import { getTickData, readTextFile, getP2TickData } from "../logic/LyricsParser";
import { scriptChoice, parseShown, loadScriptChoices, saveScriptChoice, songNames, SCRIPT_LABELS, SCRIPT_LANG } from "../logic/lyricsScripts";
import VideoPlayer from "../components/VideoPlayer";
import PartyBar from "../components/PartyBar";
import { shuffle } from "../logic/RandomUtility";
import { apiUrl } from "../GlobalConsts";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Wordmark from "../components/Wordmark";
import { initMicInput, micErrorKind } from "../logic/MicrophoneInput";
import { micAction, micPermission } from "../logic/micStandby";
import { createBleedController, FALLBACK_DELAY } from "../logic/bleedController";
import { isPitchGpuEnabled } from "../logic/pitchGpuFlag";
import { getGapOverride, setGapOverride, clearGapOverride } from "../logic/gapOverrides";
import { carryGap } from "../logic/gapFrame";
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
  sendPlayerPart,
  sendPingReply,
  sendPlayerColor,
  BIN_NOTES_BATCH,
  BIN_NOTES_BATCH_V2,
  BIN_STANDING,
  parseStanding,
  parseBinaryBatch,
} from "../logic/WebsocketHandling";
import QueuePanel from "../components/QueuePanel";
import QueueWindow, { PopOutButton } from "../components/QueueWindow";
import SimilarSongs from "../components/SimilarSongs";
import { handlePartyMessage, usePartyChartJobs, firstPlayable } from "../logic/partyChartJobs";
import { canPopOut, usePopout } from "../logic/popoutWindow";
import { defaultHue } from "../logic/playerColor";
import ShareCard from "../components/ShareCard";
import StarRating from "../components/StarRating";
import { useAuth } from "../logic/AuthContext";
import { getSongScores, getSuggestions, requestFriend } from "../logic/authApi";
import { starsFor, MAX_SCORE, STAR_THRESHOLDS } from "../logic/scoreScale";
import { achievementInfo, creditLine, mergeEndAchievements, scoreCardChips } from "../logic/achievements";
import { DuetIcon, SpeakerIcon } from "../components/Icons";
import { getSessionId } from "../logic/sessionId";
import { exitFullscreen, toggleFullscreen } from "../logic/fullscreen";
import { getReferrer, getArrival } from "../logic/referrer";
import { platformHints } from "../logic/platformHints";
import { loadJoinerSound, saveJoinerSound } from "../logic/joinerSound";
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

// The stage's live parts follow the live store by themselves; from the page
// they need a render only when their own props change, not on every queue,
// score or player message or slider step the page re-renders for (PartyBar
// and VideoPlayer are memoised the same way)
const StageMusicBars = React.memo(LiveMusicBars);
const StageLyrics = React.memo(LiveStageLyrics);
const StageTimeline = React.memo(SongTimeline);

/**
 * The score screen's countdown to the next song: a ring that empties over
 * `duration` from `startRef.current` (performance.now()) and the seconds left.
 * It animates itself through refs, so the page does not re-render every frame
 * for it; PartyPage's own loop decides when the time is up.
 */
const RING = 2 * Math.PI * 24;
const CountdownRing = ({ startRef, duration }) => {
  const arcRef = useRef(null);
  const digitRef = useRef(null);
  useEffect(() => {
    let rafId;
    const draw = () => {
      const start = startRef.current;
      const progress = start == null ? 0 : Math.min(1, (performance.now() - start) / duration);
      if (arcRef.current) arcRef.current.setAttribute('stroke-dashoffset', String(RING * progress));
      const digit = String(Math.ceil((1 - progress) * duration / 1000)); // whole seconds left
      if (digitRef.current && digitRef.current.textContent !== digit) digitRef.current.textContent = digit;
      if (progress < 1) rafId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafId);
  }, [startRef, duration]);
  return (
    <div className="relative w-14 h-14 flex-shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
        <circle
          ref={arcRef}
          cx="28" cy="28" r="24" fill="none"
          stroke="url(#countdownGradient)" strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={0}
        />
        <defs>
          <linearGradient id="countdownGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="100%" stopColor="#d500f9" />
          </linearGradient>
        </defs>
      </svg>
      <span ref={digitRef} className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg">{Math.round(duration / 1000)}</span>
    </div>
  );
};

const PartyPage = () => {
  const { t, i18n } = useTranslation();
  const namesOf = useSongNames(); // re-read on every render: follows the lyrics pill
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
    } else if (!isHost && !joinerSoundOnRef.current) {
      // The joiner's sound is off: muted playback, nothing to offer (the
      // volume control turns it on). The level is set for when it is.
      try { playerObj.setVolume(volumeSettingRef.current); playerObj.mute(); } catch { /* */ }
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
  // How late this device's singing reaches the scoring, measured from the
  // music the mic picks up (bleedController.js); taken off every sung note
  const bleedRef = useRef(null);
  const bleedSongRef = useRef(null); // the song it is measuring
  // Points the measurement at `songId`: a fresh start for a new song, and the
  // song's instrumental as soon as its stems are in memory (without stems the
  // fixed delay stays)
  const syncBleedSong = useCallback((songId) => {
    const bleed = bleedRef.current;
    if (!bleed || !songId || songId === 'none') return;
    if (bleedSongRef.current !== songId) {
      bleedSongRef.current = songId;
      bleed.startSong();
    }
    const sp = stemPlayerRef.current;
    if (sp?.loaded && sp.songId === songId && bleed.state().reference === 'none') bleed.setReference(sp.buffers.karaoke);
  }, []);

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
  const [activeSkipSegment, setActiveSkipSegmentState] = useState(null); // current skippable segment or null
  // The frame loop asks every frame; only a different segment is a state change
  const activeSkipRef = useRef(null);
  const setActiveSkipSegment = useCallback((seg) => {
    if (activeSkipRef.current === seg) return;
    activeSkipRef.current = seg;
    setActiveSkipSegmentState(seg);
  }, []);
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
  const [volumeSetting, setVolumeSetting] = useState(() => {
    try {
      const v = localStorage.getItem('singpro_volume') ?? localStorage.getItem('singpro_music_vol');
      return v !== null ? Math.max(0, Math.min(100, Number(v))) : 100;
    } catch { return 100; }
  });
  // A joiner's sound switch: off unless they came by the copied party link,
  // since in the room the host's speakers carry the song (joinerSound.js).
  // Off is volume 0 for everything below; the level they set stays for when
  // it is back on. Always on for the host.
  const [joinerSoundOn, setJoinerSoundOn] = useState(() => isHost || loadJoinerSound(partyId, getArrival()));
  const joinerSoundOnRef = useRef(joinerSoundOn);
  joinerSoundOnRef.current = joinerSoundOn;
  const volume = joinerSoundOn ? volumeSetting : 0;
  const volumeSettingRef = useRef(volumeSetting);
  volumeSettingRef.current = volumeSetting;
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
    if (!hasStems || !joinerSoundOn) return; // nothing to explain while the sound is off
    try { if (localStorage.getItem('singpro_stems_hint_seen') === '1') return; } catch { /* */ }
    setStemsHint(true);
    const id = setTimeout(dismissStemsHint, 20_000);
    return () => clearTimeout(id);
  }, [hasStems, joinerSoundOn, dismissStemsHint]);
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
    player.songId = activeSongId; // whose stems these are (the singing delay measures against the instrumental)
    stemPlayerRef.current = player;
    const loadStartedAt = performance.now();
    stemsLoadRef.current = { state: 'loading', startedAt: loadStartedAt };
    player.load({
      karaoke: `${apiUrl}/songs/${activeSongId}/karaoke${format}`,
      vocals: `${apiUrl}/songs/${activeSongId}/vocals${format}`,
    }, { log: (line) => debugLog('stems', line) }).then(() => {
      if (stemPlayerRef.current !== player) return; // the song changed meanwhile
      stemsLoadRef.current = { state: 'memory', ms: Math.round(performance.now() - loadStartedAt) };
      syncBleedSong(activeSongId);
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

  // Master volume → stem GainNodes (stems) or YouTube volume (no stems) + persist.
  // A joiner's sound off mutes YouTube, as at their start (muted playback needs
  // no tap); switching it back on unmutes it inside the tap (handleVolumeChange).
  useEffect(() => {
    applyStemGains();
    if (!hasStemsRef.current) {
      try {
        if (joinerSoundOn) iframePlayerRef.current?.setVolume(volumeSetting);
        else iframePlayerRef.current?.mute();
      } catch { /* */ }
    }
    try { localStorage.setItem('singpro_volume', String(volumeSetting)); } catch { /* */ }
  }, [volumeSetting, joinerSoundOn, applyStemGains]);

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
  // ourselves), without stems YouTube carries the sound at the master volume
  // (unless a joiner's sound is off).
  const lastStemsSongRef = useRef(null);
  useEffect(() => {
    if (activeSongId === lastStemsSongRef.current) return;
    lastStemsSongRef.current = activeSongId;
    try {
      if (hasStems || !joinerSoundOnRef.current) {
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
        setVolumeSetting(prev => (Math.abs(prev - ytVol) > 2 ? ytVol : prev));
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
    // A joiner's sound is off: switching it on starts them (the singing delay
    // measures against the decoded instrumental, not against playback)
    if (!joinerSoundOnRef.current) return;
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

  // Periodic sync: keep the stems on the video's time during playback.
  // A joiner follows the host's clock only while the host plays. When the host
  // went to the menu, the stems of a joiner whose own video was hidden or had
  // never started (nothing paused there to pause them) chased the stopped
  // clock: restarted at its last time every half second, a loop of the song.
  useEffect(() => {
    if (!hasStems) return;
    const id = setInterval(() => {
      if (!stemPlayerRef.current?.playing) return;
      if (!isHost && !hostIsPlayingRef.current) { pauseStems(); return; }
      alignStems(isHost ? (iframePlayerRef.current?.getCurrentTime?.() ?? 0) : getHostVideoTime());
    }, 500);
    return () => clearInterval(id);
  }, [hasStems, isHost, alignStems, pauseStems]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // The base gap of the chart on stage (its #GAP plus video offset: the API's
  // defaultGap, or duetGap for the twin) and of the song's main chart. A
  // correction or a drag is the distance from the base; it is carried across
  // the solo/duet switch and stored in the main chart's frame (gapFrame.js)
  const baseGapRef = useRef(undefined);
  const soloBaseRef = useRef(undefined);
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
  // The same, as state: the popped-out queue window shows what is playing
  const [songMeta, setSongMeta] = useState(null);
  const partyIdRef = useRef(partyId);
  partyIdRef.current = partyId;
  const currentUserNameRef = useRef(currentUserName);
  currentUserNameRef.current = currentUserName;


  // Store raw lyrics text + gap so we can send them to the server when WS connects
  const lyricsPayloadRef = useRef(null);

  // Duet/solo toggle: lyricDataRef holds the active parsed lyrics so the animate
  // loop picks up changes immediately when the user toggles duet mode.
  const lyricDataRef = useRef(null);
  const songRawRef = useRef(null); // { lyrics, duetLyrics, gap, defaultGap, duetGap, lyricsScripts } from API
  // The chart in its own script (晴天 for "Qing Tian"), per viewer: { tag, on } (logic/lyricsScripts.js)
  const [lyricsScript, setLyricsScript] = useState({ tag: null, on: false });
  const lyricsScriptRef = useRef(lyricsScript);
  const [duetMode, setDuetMode] = useState(false);
  const duetModeRef = useRef(false);
  const [hasDuetLyrics, setHasDuetLyrics] = useState(false);
  // Which of the two parts I sing (1 or 2) once the stage shows both: my own
  // notes are judged against it here and on the server (player:part); every
  // player's choice is kept for the stage tags. The host's duet switch is the
  // party's: joiners follow it (song:lyrics_loaded / party:state carry it).
  const [myPart, setMyPart] = useState(1);
  const myPartRef = useRef(1);
  const [playerParts, setPlayerParts] = useState({});
  const [partPrompt, setPartPrompt] = useState(false);
  const hostDuetRef = useRef(false); // joiners: what the host's stage shows, applied once our song is loaded

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

  // This player's latency for the mic panel (party:latency_updated, every 5 s).
  // A store rather than state: as state it re-rendered the whole stage every
  // 5 s for a number only the open panel shows (see valueStore.js)
  const latencyStoreRef = useRef(null);
  if (!latencyStoreRef.current) latencyStoreRef.current = createValueStore(undefined);
  const latencyStore = latencyStoreRef.current;

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

  // The queue can move into a window of its own (a laptop screen while this
  // page plays fullscreen on the TV), like a presenter view. It is rendered
  // from here through a portal: same state, same socket, no second player.
  // Only where a second window makes sense (see canPopOut).
  const [popOutSupported] = useState(canPopOut);
  const [queuePopout, queuePopoutCtl] = usePopout({ name: 'singpro-queue', title: t('queue.title'), sizeKey: 'singpro_queue_window' });
  // Straight from the click: browsers only allow pop-ups on a user gesture.
  // Blocked, the drawer stays open and says so.
  const popOutQueue = useCallback(() => {
    if (queuePopoutCtl.open() !== 'blocked') setQueueOpen(false);
  }, [queuePopoutCtl]);
  // "Pop in" in the window: close it and show the queue here again
  const popInQueue = useCallback(() => {
    queuePopoutCtl.close();
    setQueueOpen(true);
    try { window.focus(); } catch { /* */ }
  }, [queuePopoutCtl]);
  useEffect(() => { if (!queueOpen) queuePopoutCtl.dismissBlocked(); }, [queueOpen, queuePopoutCtl]);
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
    if (isHost) { micSetActiveRef.current?.(state === 1); checkMicRef.current?.(); }
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
      if (!isHost && !mutedFallbackRef.current && !hasStemsRef.current && joinerSoundOnRef.current) {
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

  // The volume control. For a joiner 0 is the sound switched off (the level
  // stays for later), and switching it on is a tap: the gesture a phone wants
  // before it plays sound, so the stems or YouTube are started right here.
  const handleVolumeChange = useCallback((v) => {
    if (isHostRef.current) { setVolumeSetting(v); return; }
    const on = v > 0;
    if (on) setVolumeSetting(v);
    if (on === joinerSoundOnRef.current && !(on && mutedFallbackRef.current)) return; // only the level changed
    joinerSoundOnRef.current = on;
    setJoinerSoundOn(on);
    saveJoinerSound(partyIdRef.current, on);
    if (!on) { pauseStems(); return; }
    volumeRef.current = v;
    try {
      if (hasStemsRef.current) {
        applyStemGains(); // resumes the context
        if (hostIsPlayingRef.current) startStems(getHostVideoTime());
      } else {
        iframePlayerRef.current?.unMute();
        iframePlayerRef.current?.setVolume(v);
      }
    } catch { /* */ }
    mutedFallbackRef.current = false;
    if (stalledRef.current === 'unmute') setStalled(null);
  }, [applyStemGains, startStems, pauseStems]);

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
        setSongMeta({
          songId: activeSongId, artist: jsonObj.data.artist, title: jsonObj.data.title, videoId: jsonObj.data.videoId,
          titles: jsonObj.data.titles, language: jsonObj.data.language,
        });
        skipSegmentsRef.current = jsonObj.data.skipSegments ?? [];
        setActiveSkipSegment(null);
        setHasStems(Boolean(jsonObj.data.hasStems) && WEB_AUDIO_SUPPORTED && !stemsUnplayableRef.current);

        const { artist, title } = jsonObj.data;

        // Update browser tab title (in the song's own script when this viewer reads it so)
        if (artist && title) {
          const names = songNames(jsonObj.data, { locale: i18n.language });
          document.title = `${names.artist} - ${names.title} | singpro.app`;
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
            defaultGap: jsonObj.data.defaultGap,
            duetGap: jsonObj.data.duetGap,
            lyricsScripts: jsonObj.data.lyricsScripts ?? null,
          };
          setHasDuetLyrics(!!jsonObj.data.duetLyrics);
          const script = scriptChoice(jsonObj.data.lyricsScripts, {
            locale: i18n.language, language: jsonObj.data.language, saved: loadScriptChoices(),
          });
          lyricsScriptRef.current = script;
          setLyricsScript(script);

          // Reset duet mode for new songs (default to solo); the part is asked again with the next duet
          duetModeRef.current = false;
          setDuetMode(false);
          myPartRef.current = 1;
          setMyPart(1);
          setPartPrompt(false);

          const lyricData = await parseShown(jsonObj.data.lyrics, jsonObj.data.lyricsScripts, script);

          if (cancelled) return;

          // What the chart plays at by itself: the API's defaultGap carries the
          // video offset (#VIDEOGAP) that the file's #GAP alone does not
          if (Number.isFinite(Number(jsonObj.data.defaultGap))) lyricData.defaultGap = Number(jsonObj.data.defaultGap);
          soloBaseRef.current = baseGapRef.current = lyricData.defaultGap;

          // Timing priority: saved on this device (host) > the API's gap (a shared
          // correction, else the base) > the file's #GAP; joiners follow whatever
          // the host announced for this song
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

          // A chart that is a duet by itself (a "[DUET]" song) puts two parts on
          // stage right away: everyone is asked which one they sing
          if (lyricData.isDuet) {
            duetModeRef.current = true;
            setDuetMode(true);
            setPartPrompt(true);
          } else if (!isHostRef.current && hostDuetRef.current && jsonObj.data.duetLyrics) {
            // A joiner arriving while the host's stage already shows the duet twin follows it now
            applyDuetMode(true, { send: false });
          }

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
          const listen = {
            sessionId,
            artist,
            title,
            songId: activeSongId,
            videoId: jsonObj.data.videoId,
            nickname: currentUserNameRef.current,
            partyId: partyIdRef.current ?? null,
            referrer: getReferrer(),
            arrival: getArrival(), // by the party QR code, a party or invite link (logic/referrer.js)
          };
          // with the system version the user agent no longer tells (logic/platformHints.js)
          platformHints().then(platform => fetch(`${apiUrl}/listens`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...listen, platform }),
          })).catch(() => {});

          // Start audio recording for the active song if microphone is active
          startRecordingIfActive(activeSongId, jsonObj.data, lyricData);
          syncBleedSong(activeSongId);
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

  // Switch the stage between solo and duet lyrics: re-parse, redraw, and (the
  // host) re-send the lyrics so the server scores by them and tells the
  // joiners, who apply the same switch without sending. Two parts on stage
  // means everyone is asked which one they sing.
  const applyDuetMode = useCallback(async (newMode, { send = true } = {}) => {
    const raw = songRawRef.current;
    if (!raw?.duetLyrics) return;

    duetModeRef.current = newMode;
    setDuetMode(newMode);

    const rawText = newMode ? raw.duetLyrics : raw.lyrics;
    const ld = newMode ? await readTextFile(rawText) : await parseShown(rawText, raw.lyricsScripts, lyricsScriptRef.current);
    // Each chart plays at its own base gap (the twin was timed on its own, often
    // against another recording); a correction or a drag is the distance from
    // the base and comes along. Joiners take the host's gap for what is on stage.
    const apiBase = Number(newMode ? raw.duetGap : raw.defaultGap);
    const toBase = Number.isFinite(apiBase) ? apiBase : ld.gap;
    ld.defaultGap = toBase;
    ld.gap = !isHostRef.current && hostGapRef.current?.songId === activeSongIdRef.current
      ? hostGapRef.current.gap
      : carryGap(gapRef.current, baseGapRef.current, toBase);
    baseGapRef.current = toBase;
    gapRef.current = ld.gap;
    lyricDataRef.current = ld;
    setTimelineRegions(songRegions(ld));

    // Update display immediately
    live.setFrame(getTickData(ld, 0), getP2TickData(ld, 0));

    // Re-send lyrics to server for scoring
    lyricsPayloadRef.current = { lyrics: rawText, gap: ld.gap };
    const w = wssRef.current;
    if (send && w && w.readyState === WebSocket.OPEN && isHostRef.current) {
      sendSongLyrics(w, lyricsPayloadRef.current);
    }

    setPartPrompt(newMode);
    if (!newMode) { myPartRef.current = 1; setMyPart(1); }
  }, []);

  const handleDuetToggle = useCallback(() => applyDuetMode(!duetModeRef.current), [applyDuetMode]);

  // Switch the lyrics between the chart's romanised text and its own script.
  // Only the text on this screen changes (the same notes, timing and scoring),
  // so nothing is sent; the choice is kept for the next song in that script.
  const handleScriptToggle = useCallback(async () => {
    const raw = songRawRef.current;
    const next = { ...lyricsScriptRef.current, on: !lyricsScriptRef.current.on };
    if (!raw || !next.tag) return;
    lyricsScriptRef.current = next;
    setLyricsScript(next);
    saveScriptChoice(next.tag, next.on);
    if (duetModeRef.current && raw.duetLyrics) return; // the duet twin is on stage: back to solo applies it
    const ld = await parseShown(raw.lyrics, raw.lyricsScripts, next);
    if (songRawRef.current !== raw || duetModeRef.current && raw.duetLyrics) return; // the song or stage changed meanwhile
    const prev = lyricDataRef.current;
    if (prev) { ld.gap = prev.gap; ld.defaultGap = prev.defaultGap; }
    lyricDataRef.current = ld;
  }, []);

  const choosePart = useCallback((part) => {
    myPartRef.current = part;
    setMyPart(part);
    setPartPrompt(false);
    setPlayerParts(prev => ({ ...prev, [currentUserNameRef.current]: part }));
    const w = wssRef.current;
    if (w && w.readyState === WebSocket.OPEN) sendPlayerPart(w, part);
  }, []);

  /** "Player 2 · Kiki Dee · you": the part's label on the stage. */
  const partLabel = (part) => {
    const name = lyricDataRef.current?.duetSingers?.[part === 1 ? 'p1' : 'p2'];
    const base = part === 1 ? t('party.duetP1') : t('party.duetP2');
    return `${base}${name ? ` · ${name}` : ''}${duetMode && myPart === part ? ` · ${t('party.you')}` : ''}`;
  };

  // Audio recording helpers for pitch accuracy dataset collection
  const stopAndUploadRecording = useCallback(() => {
    const name = currentUserNameRef.current;
    // score: this browser's own estimate (MicInputToTick); serverScore: what the
    // server scored, as it last rode on a note (the scoreboard's number)
    micRecorderRef.current?.stopAndUpload({
      score: live.notes[name]?.score,
      serverScore: live.scores[name],
      part: myPartRef.current ?? null,             // which part of a duet was sung (scored against)
      gapAtEnd: lyricDataRef.current?.gap ?? null, // the host may correct the timing while the song runs
    });
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
      // the host's notes are stamped with its own player's time, a joiner's
      // with the host's time as it heard it last (getHostVideoTime)
      isHost: !!isHostRef.current,
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
    const bl = bleedRef.current?.state();
    lines.push(bl
      ? `delay: ${Math.round(bl.applied * 1000)} ms (${bl.source}${bl.z != null ? ` z=${bl.z.toFixed(1)}` : ''} chunks=${bl.chunks} target=${Math.round(bl.target * 1000)} ref=${bl.reference}${bl.worker ? '' : ' no-worker'})`
      : `delay: ${Math.round(FALLBACK_DELAY * 1000)} ms (not singing)`);
    const probe = document.createElement('audio');
    lines.push(`canPlay: ogg/opus="${probe.canPlayType('audio/ogg; codecs="opus"')}" opus="${probe.canPlayType('audio/opus')}" webm/opus="${probe.canPlayType('audio/webm; codecs="opus"')}" mp4/aac="${probe.canPlayType('audio/mp4; codecs="mp4a.40.2"')}"`);
    lines.push(`audioSession=${navigator.audioSession?.type ?? 'n/a'} visible=${document.visibilityState} online=${navigator.onLine}`);
    const m = micStatsRef.current;
    lines.push(m
      ? `mic: ${m.active === false ? 'idle' : 'active'} ${m.provider ?? 'wasm'} chunks=${m.totalChunks} (${m.chunksPerSec}/s) notes=${m.totalNotes} (${m.notesPerSec}/s) gated=${m.gatedChunks}${m.droppedChunks ? ` dropped=${m.droppedChunks}` : ''} gain=${(m.inputGain ?? 1).toFixed(2)} infer=${(m.inferMs ?? 0).toFixed(1)}ms${m.inferErrors ? ` errors=${m.inferErrors}` : ''} floor=${m.noiseFloor?.toFixed(5)} last=${m.lastNote} vol=${m.lastVolume?.toFixed(4)}`
      : micActiveRef.current ? 'mic: closed until a song plays' : 'mic: not active');
    lines.push(navigator.userAgent);
    return lines.join('\n');
  }, []);
  // Input device for singing (chosen in the microphone panel); remembered across sessions
  const [micDeviceId, setMicDeviceId] = useState(() => {
    try { return localStorage.getItem('singpro_mic_device') || null; } catch { return null; }
  });
  const micDeviceIdRef = useRef(micDeviceId);
  micDeviceIdRef.current = micDeviceId;
  // Whether the song is running right now: the host asks its own player,
  // joiners follow the host's clock (their own player may be muted, hidden,
  // still loading or waiting for a tap, none of which should silence them)
  const isSongPlaying = useCallback(() => {
    if (!isHostRef.current) return hostIsPlayingRef.current;
    try { return iframePlayerRef.current?.getPlayerState?.() === 1; } catch { return false; }
  }, []);
  // Joining takes a moment, the first time several seconds: the browser opens
  // the microphone (maybe asking first), then the pitch detector is downloaded
  // and compiled. micPhase shows that on the mic button, micError why it failed.
  const [micPhase, setMicPhase] = useState(null); // null | 'starting' | 'loading'
  const [micError, setMicError] = useState(null); // null | 'denied' | 'noDevice' | 'failed'
  const joiningRef = useRef(false);
  const micOpenedAtRef = useRef(0); // performance.now() when the microphone last opened
  const joinSingingWith = useCallback(async (deviceId) => {
    if (stopMicRef.current || joiningRef.current) return; // already singing, or on the way (a second click would open a second microphone)
    joiningRef.current = true;
    setMicError(null);
    try {
      const result = await initMicInput({ deviceId: deviceId || undefined, gpu: isPitchGpuEnabled(), onPhase: setMicPhase });
      micOpenedAtRef.current = performance.now();
      stopMicRef.current = result.stopMicInput;
      micStatsRef.current = result.stats;
      micRecorderRef.current = result.recorder;
      micSetActiveRef.current = result.setActive;
      result.setActive(isSongPlaying());
      try { localStorage.setItem('singpro_mic_on', '1'); } catch { /* */ }
      micActiveRef.current = true;
      bleedRef.current?.dispose();
      const bleed = createBleedController({
        onEstimate: (e) => debugLog('delay', `bleed ${Math.round(e.measured * 1000)} ms z=${e.z.toFixed(1)} chunks=${e.chunks}${e.confident ? ' (sure)' : ''}`),
      });
      bleedRef.current = bleed;
      bleedSongRef.current = null;
      result.setOnAudio((samples, pos) => bleed.pushAudio(samples, pos));
      syncBleedSong(activeSongIdRef.current);
      setSetOnProcessing(() => result.setOnProcessing);
      setMicActive(true);
      startRecordingIfActive(activeSongIdRef.current, songInfoRef.current, lyricDataRef.current, result.recorder);
    } catch (e) {
      console.warn("Microphone access denied or unavailable:", e.message);
      setMicError(micErrorKind(e));
      // Reopening for a song failed too (access withdrawn, device gone): no
      // longer singing, rather than asking again every second
      micActiveRef.current = false;
      setMicActive(false);
    } finally {
      joiningRef.current = false;
      setMicPhase(null);
    }
  }, [startRecordingIfActive, isSongPlaying, syncBleedSong]);
  const handleJoinSinging = useCallback(() => joinSingingWith(micDeviceId), [joinSingingWith, micDeviceId]);

  // Lets go of the microphone and everything reading it (the recording so far
  // is uploaded); the browser stops showing it as in use. Joining opens it anew.
  const closeMic = useCallback(() => {
    stopAndUploadRecording();
    stopMicRef.current?.();
    stopMicRef.current = null;
    bleedRef.current?.dispose();
    bleedRef.current = null;
    micRecorderRef.current = null;
    micSetActiveRef.current = null;
    micStatsRef.current = null;
    setSetOnProcessing(undefined);
  }, [stopAndUploadRecording]);

  // Leave singing — stop microphone
  const handleLeaveSinging = useCallback(() => {
    setMicError(null);
    try { localStorage.setItem('singpro_mic_on', '0'); } catch { /* */ }
    closeMic();
    micActiveRef.current = false;
    setMicActive(false);
  }, [closeMic]);

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
      bleedRef.current?.dispose();
      bleedRef.current = null;
    };
  }, [stopAndUploadRecording]);

  // The microphone comes back the way it was for the previous song: joiners
  // start singing unless they switched the mic off before, hosts only once
  // they joined singing before. That is the choice; the microphone itself
  // opens when a song plays (below). Only where the browser would still ask
  // is it opened at once, so the question comes now, right after joining,
  // rather than when the music starts — and never in a background tab.
  useEffect(() => {
    let remembered = null;
    try { remembered = localStorage.getItem('singpro_mic_on'); } catch { /* */ }
    const wantMic = remembered == null ? !isHost : remembered === '1';
    if (!wantMic || micActive) return;
    micActiveRef.current = true;
    setMicActive(true);
    let cancelled = false;
    micPermission().then(state => {
      if (cancelled || state === 'granted' || document.visibilityState !== 'visible') return;
      if (micActiveRef.current && !stopMicRef.current) handleJoinSinging();
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Open only while needed (micStandby.js): a song playing, or the mic panel
  // open for its level meter. Checked every second, on a change of tab
  // visibility, and at once when playback starts or stops (checkMicRef).
  const micPanelOpenRef = useRef(false);
  const checkMicRef = useRef(null);
  const handleMicPanelOpenChange = useCallback((open) => {
    micPanelOpenRef.current = open;
    checkMicRef.current?.();
  }, []);
  useEffect(() => {
    if (!micActive) return;
    let lastNeeded = performance.now();
    const check = () => {
      if (!micActiveRef.current) return;
      const now = performance.now();
      const hidden = document.visibilityState === 'hidden';
      const needed = isSongPlaying() || (micPanelOpenRef.current && !hidden);
      if (needed) lastNeeded = now;
      const open = !!stopMicRef.current;
      const idleMs = now - Math.max(lastNeeded, open ? micOpenedAtRef.current : 0);
      const action = micAction({ open, opening: joiningRef.current, needed, hidden, idleMs });
      if (action === 'close') {
        debugLog('mic', `nothing playing for ${Math.round(idleMs / 1000)} s${hidden ? ' (background tab)' : ''}: microphone closed until a song plays`);
        closeMic();
      } else if (action === 'open') {
        debugLog('mic', 'a song plays: opening the microphone');
        joinSingingWith(micDeviceIdRef.current);
      }
    };
    checkMicRef.current = check;
    check();
    const id = setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
      checkMicRef.current = null;
    };
  }, [micActive, isSongPlaying, closeMic, joinSingingWith]);

  // Process mic input — uses refs to avoid re-registering the callback on every tick
  useEffect(() => {
    setOnProcessing && setOnProcessing(msg => {
      const { freq, fric, pos, error } = msg.data;
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
      // Everyone sings along to what the speakers play, and that reaches this
      // stamp late: the note belongs to the song time `delay` earlier. One
      // time for judging, drawing and the server's score, so all agree.
      const bleed = bleedRef.current;
      if (bleed && pos !== undefined) bleed.pushStamp(pos, videoTime);
      const delay = bleed ? bleed.nextDelay() : FALLBACK_DELAY;
      const noteTime = videoTime - delay;
      // My notes are judged against the part I sing (a duet's second part has its own)
      const frame = live.frame;
      const td = myPartRef.current === 2 && frame.p2TickData ? frame.p2TickData : frame.tickData;

      if (td.lyricRef) {
        live.notes = getAndSetHitNotesByPlayer(td, live.notes, freq, currentUserNameRef.current, noteTime);
      }

      // Record note telemetry for dataset accuracy evaluation (the stamp as
      // it came, with the delay taken off it)
      micRecorderRef.current?.recordNote({ videoTime, freq, volume: msg.data.volume ?? 0, fric, pos, delay, delaySource: bleed?.state().source });

      const w = wssRef.current;
      if (w) {
        sendPlayerNote(w, { freq, videoTime: noteTime, fric });
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

      sendPartyJoin(wsInstance, { partyId, username: currentUserName, isShowingVideo: true, color: ownColor, part: myPartRef.current });

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
      handlePartyMessage(jsonObj); // songs of the queue being charted (their own store, no render here)

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
        if (state.players) {
          learnPlayerColors(state.players);
          setPlayerParts(Object.fromEntries(state.players.map(p => [p.username, p.part ?? 1])));
        }
        if (!isHost) hostDuetRef.current = !!state.duet;
        // If we're rejoining and don't have a song yet, pick up the current song
        if (state.currentSong?.songId && (!activeSongIdRef.current || activeSongIdRef.current === 'none')) {
          setActiveSongId(state.currentSong.songId);
        }
      }

      if (jsonObj.type === "player:color_changed") {
        const { username, color } = jsonObj.data;
        setPlayerColors(prev => ({ ...prev, [username]: color }));
      }

      if (jsonObj.type === "player:part_changed") {
        const { username, part } = jsonObj.data;
        setPlayerParts(prev => ({ ...prev, [username]: part }));
      }

      // The host switched the stage between solo and duet: joiners follow (their
      // notes are scored by the host's lyrics either way)
      if (!isHost && jsonObj.type === "song:lyrics_loaded" && typeof jsonObj.data?.isDuet === 'boolean') {
        hostDuetRef.current = jsonObj.data.isDuet;
        if (jsonObj.data.isDuet !== duetModeRef.current && songRawRef.current) applyDuetMode(jsonObj.data.isDuet, { send: false });
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
        setCountdownCancelled(false);
      }

      // Achievements signed-in singers just earned: shown on their score cards
      // (the server sends them after party:song_ended of the same song)
      if (jsonObj.type === "party:achievements") {
        setEndScores(prev => mergeEndAchievements(prev, jsonObj.data?.players));
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
        const wasPlaying = hostIsPlayingRef.current;
        hostIsPlayingRef.current = !!jsonObj.data.isPlaying;
        micSetActiveRef.current?.(hostIsPlayingRef.current);
        if (wasPlaying !== hostIsPlayingRef.current) checkMicRef.current?.(); // a closed microphone opens as the song starts

        // Sync stem audio for non-host joiners
        syncStemsToTime(jsonObj.data.videoTime ?? 0, !!jsonObj.data.isPlaying);

        const player = iframePlayerRef.current;
        // A player whose iframe is gone (being replaced) throws from inside
        // YouTube's API on any command; the next message finds the new one
        if (player) {
          try {
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
          } catch { /* see above */ }
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
          // nothing plays without the host: idle the mic, pause our copy of the video and the stems
          hostIsPlayingRef.current = false;
          micSetActiveRef.current?.(false);
          syncStemsToTime(hostVideoTimeRef.current, false);
          try { iframePlayerRef.current?.pauseVideo?.(); } catch { /* */ }
        }
      }
      if (jsonObj.type === "party:closed") {
        clearPartySession();
        document.title = 'singpro.app';
        navigate('/', { replace: true, state: { partyNotice: jsonObj.data?.reason === 'ended' ? 'ended' : 'host_left' } });
      }

      if (jsonObj.type === "party:latency_updated") {
        let mine;
        for (const p of jsonObj.data.latencies ?? []) if (p.username === currentUserNameRef.current) mine = p.latencyMs;
        latencyStore.set(mine);
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

  // A song whose chart is being made joins the queue at once (QueueAddSong, the chart pill)
  const handleQueueAddJob = usePartyChartJobs(wss);

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
  const COUNTDOWN_DURATION = 6000; // ms
  const [countdownCancelled, setCountdownCancelled] = useState(false);
  const countdownCancelledRef = useRef(false);
  useEffect(() => {
    if (!songEnded || !countdownStartRef.current) return;
    setCountdownCancelled(false);
    countdownCancelledRef.current = false;
    let rafId;
    const tick = () => {
      if (countdownCancelledRef.current || !countdownStartRef.current) return;
      // (the ring draws its own progress, CountdownRing: no page render per frame)
      const elapsed = performance.now() - countdownStartRef.current;
      const progress = Math.min(1, elapsed / COUNTDOWN_DURATION);
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

  // Handed to the memoised bar and highway (PartyBar, StageMusicBars), so they
  // stay the same from render to render
  const setGap = useCallback((gap) => {
    if (Number.isFinite(gap)) { gapRef.current = gap; syncGapToParty(gap); }
  }, [syncGapToParty]);
  const gapData = useMemo(() => ({
    gap: liveGap,
    defaultGap: liveDefaultGap,
    setGap,
    // Saved values belong to the song's main chart: while the duet twin is
    // on stage, the distance from the twin's base is carried into that frame
    toShared: gap => carryGap(gap, baseGapRef.current, soloBaseRef.current),
    saveLocal: gap => setGapOverride(activeSongIdRef.current, carryGap(gap, baseGapRef.current, soloBaseRef.current)),
    onSubmitted: () => clearGapOverride(activeSongIdRef.current),
  }), [liveGap, liveDefaultGap, setGap]);
  const toggleQueue = useCallback(() => setQueueOpen(p => !p), []);
  // What this device knew when a problem was reported, for the admins checking it
  const getReportContext = useCallback(() => {
    const bl = bleedRef.current?.state();
    let videoTime = null;
    try { videoTime = isHostRef.current ? (iframePlayerRef.current?.getCurrentTime?.() ?? null) : getHostVideoTime(); } catch { /* */ }
    return {
      gap: lyricDataRef.current?.gap ?? null,
      videoTime: Number.isFinite(videoTime) ? Math.round(videoTime * 10) / 10 : null,
      delayMs: bl ? Math.round(bl.applied * 1000) : null,
      delaySource: bl?.source ?? null,
      isHost: !!isHostRef.current,
      videoId: songInfoRef.current?.videoId ?? null,
      nickname: currentUserNameRef.current ?? null,
      partyId: partyIdRef.current ?? null,
      sessionId: getSessionId(),
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- getHostVideoTime only reads refs

  // The popped-out queue (null unless its window is open)
  const queueWindow = queuePopout.container ? createPortal(
    <QueueWindow
      partyId={partyId}
      song={songMeta && songMeta.songId === activeSongId ? songMeta : null}
      singers={serverScores ? Object.keys(serverScores) : []}
      playerColors={playerColors}
      queue={queue}
      isHost={isHost}
      currentUserName={currentUserName}
      onAdd={handleQueueAdd}
      onAddJob={handleQueueAddJob}
      onRemove={handleQueueRemove}
      onReorder={handleQueueReorder}
      onSkip={isHost && wss ? handleSkipSong : undefined}
      similarSongs={similarSongs}
      onDock={popInQueue}
    />,
    queuePopout.container,
  ) : null;

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
          {queueWindow}
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
        {queueWindow}
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-dvh overflow-hidden">
      {/* The blurred thumbnail is a full-screen layer; while the video plays,
          the player (black bars included) covers all of it */}
      <BackgroundImage videoId={videoId} hidden={showVideo && videoState === 1} />

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
        gapData={gapData}
        volume={volume}
        restoreVolume={volumeSetting}
        vocalsLevel={vocalsLevel}
        instrumentalLevel={instrumentalLevel}
        onVolumeChange={handleVolumeChange}
        onVocalsLevelChange={setVocalsLevel}
        onInstrumentalLevelChange={setInstrumentalLevel}
        hasStems={hasStems}
        volumeTooltip={volumeTooltip}
        stemsHint={stemsHint}
        onDismissStemsHint={dismissStemsHint}
        micActive={micActive}
        micPhase={micPhase}
        micError={micError}
        onJoinSinging={handleJoinSinging}
        onLeaveSinging={handleLeaveSinging}
        micStatsRef={micStatsRef}
        micDeviceId={micDeviceId}
        onMicDeviceChange={handleMicDeviceChange}
        onMicPanelOpenChange={handleMicPanelOpenChange}
        ownColor={ownColor}
        onColorChange={handleColorChange}
        latency={latencyStore}
        showVideo={showVideo}
        onToggleVideo={isHost ? undefined : toggleVideo}
        videoHint={videoHint}
        onDismissVideoHint={dismissVideoHint}
        queueOpen={queueOpen}
        queuePoppedOut={queuePopout.open}
        onToggleQueue={queuePopout.open ? queuePopoutCtl.focus : toggleQueue}
        queueCount={queue.length}
        onFreeClick={handleStageClick}
        getReportContext={getReportContext}
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
              highest of the line — and must stay fully visible). The canvas
              draws both fades itself (MusicBars paintBackdrop / fadeEdges):
              CSS masks here were re-rendered on every frame, the largest cost
              of a frame on CPU-drawing devices. A click on it pauses / resumes too. */}
          <div className="relative flex-shrink-0 cursor-pointer">
            <div className="relative">
              <StageMusicBars
                store={live}
                isHost={isHost}
                playerColors={playerColors}
                playerParts={playerParts}
                scores={serverScores}
                onClick={handleStageClick}
                gapDragEnabled={isFixingTiming}
                setGap={setGap}
              />
            </div>
            {/* The lyrics' script (anyone, for their own screen: 晴天 / Qing Tian). Duet: the
                host switches the stage to two parts (joiners follow); in duet mode
                everyone has a pill with their part that reopens the choice */}
            {(duetMode || (hasDuetLyrics && isHost) || lyricsScript.tag) && (
              <div className="absolute top-2 right-3 z-30 flex items-center gap-1.5">
                {lyricsScript.tag && !(duetMode && hasDuetLyrics) && (
                  <button
                    onClick={handleScriptToggle}
                    className="px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer bg-surface/60 text-gray-300 border-surface-lighter hover:text-white hover:border-gray-500"
                    title={lyricsScript.on ? t('party.scriptLatin') : t('party.scriptNative')}
                    lang={lyricsScript.on ? undefined : SCRIPT_LANG[lyricsScript.tag]}
                  >
                    {lyricsScript.on ? SCRIPT_LABELS.Latn : SCRIPT_LABELS[lyricsScript.tag]}
                  </button>
                )}
                {!(duetMode || (hasDuetLyrics && isHost)) ? null : hasDuetLyrics && isHost ? (
                  <button
                    onClick={handleDuetToggle}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                      duetMode
                        ? 'bg-neon-purple/15 text-neon-purple border-neon-purple/50 hover:bg-neon-purple/25'
                        : 'bg-surface/60 text-gray-400 border-surface-lighter hover:text-white hover:border-gray-500'
                    }`}
                    title={duetMode ? t('party.switchSolo') : t('party.switchDuet')}
                  >
                    <DuetIcon />
                    {duetMode ? t('party.duetOn') : t('party.duetOff')}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border bg-neon-purple/15 text-neon-purple border-neon-purple/50">
                    <DuetIcon />
                    {t('party.duetOn')}
                  </span>
                )}
                {duetMode && (
                  <button
                    onClick={() => setPartPrompt(p => !p)}
                    className="px-2.5 py-1 text-xs rounded-full border bg-surface/80 text-white border-neon-purple/50 hover:bg-neon-purple/20 transition-colors cursor-pointer"
                    title={t('party.changePart')}
                  >
                    {myPart === 2 ? t('party.duetP2') : t('party.duetP1')}
                  </button>
                )}
              </div>
            )}
            {duetMode && partPrompt && (
              <div className="absolute top-11 right-3 z-30 w-64 rounded-xl bg-surface-light/95 border border-neon-purple/40 p-3 shadow-xl backdrop-blur-sm">
                <div className="text-sm font-semibold text-white mb-2">{t('party.whichPart')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2].map(part => {
                    const name = lyricDataRef.current?.duetSingers?.[part === 1 ? 'p1' : 'p2'];
                    return (
                      <button
                        key={part}
                        type="button"
                        onClick={() => choosePart(part)}
                        className={`rounded-lg px-2 py-2 text-sm border transition-colors cursor-pointer ${
                          myPart === part ? 'bg-neon-purple/20 text-white border-neon-purple' : 'bg-surface text-gray-200 border-surface-lighter hover:border-neon-purple/60'
                        }`}
                      >
                        <div className="font-semibold">{part === 1 ? t('party.duetP1') : t('party.duetP2')}</div>
                        {name && <div className="text-xs text-gray-400 truncate">{name}</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
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

          {/* No backdrop-filter on anything that stays over the playing video: a
              blur reads the video every frame, and in landscape this box sits
              on the picture (the Galaxy A36 stuttered). A denser tint looks the same. */}
          <div
            className="relative flex-shrink-0 rounded-2xl overflow-hidden bg-black/70 ring-1 ring-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
            lang={lyricsScript.on && !(duetMode && hasDuetLyrics) ? SCRIPT_LANG[lyricsScript.tag] : undefined}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/60 to-transparent pointer-events-none" />
            {/* Lyrics (both singers' lines stacked in a duet) */}
            <StageLyrics store={live} p1Label={partLabel(1)} p2Label={partLabel(2)} />

            {/* Song timeline: sung stretches marked per singer; the host can seek.
                On a compositor layer of its own: the cursor moves every few
                frames, and sharing the box's layer made each move re-raster the
                box's large blurred shadow too (at 2.625x on the CPU: raster
                2.4 -> 1.0 ms a frame) */}
            <div className="will-change-[opacity]">
              <StageTimeline
                store={live}
                regions={timelineRegions}
                duration={videoDuration}
                onSeek={isHost ? seekVideo : undefined}
                label={t('party.timeline')}
              />
            </div>
          </div>
        </div>

      </div>

      {/* Queue + similar songs: a drawer under the top-right pill (unless
          the queue has a window of its own) */}
      {queueOpen && !queuePopout.open && (
        <div ref={queueDrawerRef} className="absolute top-14 left-3 right-3 sm:left-auto sm:right-4 bottom-4 z-40 sm:w-[22rem] overflow-y-auto overscroll-contain space-y-3">
          <QueuePanel
            queue={queue}
            isHost={isHost}
            currentUserName={currentUserName}
            playerColors={playerColors}
            onAdd={handleQueueAdd}
            onAddJob={handleQueueAddJob}
            onRemove={handleQueueRemove}
            onReorder={handleQueueReorder}
            onSkip={isHost && wss ? handleSkipSong : undefined}
            headerAction={popOutSupported ? <PopOutButton onClick={popOutQueue} /> : null}
          />

          {queuePopout.blocked && (
            <div role="alert" className="rounded-lg border border-neon-magenta/50 bg-surface-light/95 p-3 text-xs text-gray-200">
              <p>{t('queue.popOutBlocked')}</p>
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={queuePopoutCtl.dismissBlocked}
                  className="px-2.5 py-1 rounded border border-neon-magenta/50 bg-neon-magenta/15 text-neon-magenta hover:bg-neon-magenta/25 transition-colors cursor-pointer"
                >
                  {t('volume.gotIt')}
                </button>
              </div>
            </div>
          )}

          <SimilarSongs songs={similarSongs} onAdd={song => handleQueueAdd(song, 'queue-similar')} />
        </div>
      )}
      {queueWindow}

      {/* Song ended overlay */}
      {songEnded && (
        // Scrolls when the content is taller than the screen (phones in
        // landscape); centred otherwise
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md overflow-y-auto">
          {/* singpro.app: back to the menu (a host keeps the party, a joiner leaves it) */}
          <Link to="/" onClick={handleGoToMenu} className="fixed top-2 left-2 sm:top-3 sm:left-4 z-10 flex items-center gap-2 no-underline transition-colors rounded-lg px-2 py-1 bg-surface-light/70 backdrop-blur-sm hover:bg-surface-light">
            <Wordmark height={28} className="-my-1.5" />
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
                            {player.part && (
                              <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wider text-neon-purple border border-neon-purple/50 rounded-full px-1.5 py-px">
                                {player.part === 2 ? t('party.duetP2') : t('party.duetP1')}
                              </span>
                            )}
                          </div>
                          {isMe && (player.newBest || player.previousBest != null) && (
                            <div className={`text-xs leading-tight mt-0.5 ${player.newBest ? "text-neon-magenta font-semibold" : "text-gray-400"}`}>
                              {player.newBest ? t('scores.newBest') : t('scores.yourBest', { score: player.previousBest.toLocaleString() })}
                            </div>
                          )}
                          {player.achievements?.length > 0 && (() => {
                            // Achievements just earned (party:achievements): all of yours, the top two of others'
                            const { shown, more } = scoreCardChips(player.achievements, { mine: isMe });
                            const chip = `inline-flex items-center gap-1 max-w-full rounded-full border px-2 py-px text-[11px] font-semibold leading-4 ${isMe ? "border-neon-magenta/60 bg-neon-magenta/15 text-white shadow-[0_0_10px_rgba(255,0,229,0.3)]" : "border-neon-purple/40 bg-neon-purple/10 text-gray-200"}`;
                            return (
                              <div className="flex flex-wrap items-center gap-1 mt-1 short:mt-0.5 animate-slide-up" aria-label={t('achievements.unlocked')}>
                                <span aria-hidden="true" className="text-xs">🏆</span>
                                {shown.map(key => {
                                  const info = achievementInfo(key);
                                  return (
                                    <span key={key} title={`${t('achievements.unlocked')} ${info.name} (♪ ${creditLine(info)})`} className={chip}>
                                      <span aria-hidden="true">{info.icon}</span>
                                      <span className="truncate">{info.name}</span>
                                    </span>
                                  );
                                })}
                                {more > 0 && (
                                  <span className={chip} title={player.achievements.map(k => achievementInfo(k)?.name).filter(Boolean).join(', ')}>+{more}</span>
                                )}
                              </div>
                            );
                          })()}
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
                  pick first and highlighted, then more similar songs. A song
                  still being charted does not count: it plays once it is ready. */}
              {(() => {
                const queued = firstPlayable(queue);
                const next = queued ?? nextSongInfo;
                const locals = similarSongs.map(s => s.localMatch).filter(Boolean);
                const choosing = isHost && !queued && (next?.songId || locals.length > 0);
                if (!choosing) {
                  if (next?.title) {
                    const names = namesOf(next);
                    return (
                      <div className="text-gray-400">
                        {t('party.upNext')} <span className="text-neon-magenta font-semibold" lang={names.lang}>{names.title}</span>
                        <span className="text-gray-500" lang={names.lang}> - {names.artist}</span>
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
                            <div className={`text-xs sm:text-sm truncate ${isPick ? 'text-neon-magenta font-semibold' : 'text-white'}`} lang={namesOf(song).lang}>{namesOf(song).title}</div>
                            <div className="text-[11px] sm:text-xs text-gray-400 truncate" lang={namesOf(song).lang}>{namesOf(song).artist}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
                {/* Share score image */}
                <ShareCard songInfo={songInfoRef.current} scores={endScores} currentUserName={currentUserName} songId={activeSongId} playerColors={playerColors} />

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
                {!countdownCancelled && <CountdownRing startRef={countdownStartRef} duration={COUNTDOWN_DURATION} />}
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
