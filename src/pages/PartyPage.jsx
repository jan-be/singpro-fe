import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import BackgroundImage from "../components/BackgroundImage";
import Lyrics from "../components/Lyrics";
import { getTickData, readTextFile, getP2TickData } from "../logic/LyricsParser";
import VideoPlayer from "../components/VideoPlayer";
import PartyBar from "../components/PartyBar";
import { shuffle } from "../logic/RandomUtility";
import { apiUrl, useLang, useLangPath } from "../GlobalConsts";
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
  const { t } = useTranslation();
  const lang = useLang();
  const lp = useLangPath();
  const routerState = useLocation().state;
  const navigate = useNavigate();
  const { songId: urlSongId } = useParams();

  // Restore session from sessionStorage if router state is missing (e.g. page reload)
  const savedSession = loadPartySession();

  const [tickData, setTickData] = useState({});
  const [p2TickData, setP2TickData] = useState(null);
  const [partyId, setPartyId] = useState(
    routerState?.partyId ?? savedSession?.partyId ?? undefined
  );
  const [currentUserName] = useState(
    routerState?.currentUserName ?? savedSession?.username ?? t('party.defaultHost')
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
    // Stems: mute the iframe entirely (immune to YouTube volume resets).
    // No stems: unmute and apply the persisted volume.
    if (hasStemsRef.current) {
      try { playerObj.mute(); } catch { /* */ }
    } else {
      try { playerObj.unMute(); playerObj.setVolume(musicVolumeRef.current); } catch { /* */ }
    }
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
  const [playerColors, setPlayerColors] = useState(() => {
    // Seed own color so the scoreboard dot is never gray
    const stored = (() => {
      try {
        const s = localStorage.getItem('singpro_player_color');
        if (s !== null) return Number(s);
      } catch { /* */ }
      return null;
    })();
    const PALETTE = [20, 45, 65, 140, 160, 215, 240, 335];
    const hash = currentUserName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const color = stored ?? PALETTE[hash % PALETTE.length];
    return { [currentUserName]: color };
  });
  const [songEnded, setSongEnded] = useState(false);
  const [endScores, setEndScores] = useState([]); // [{username, score, cumulativeScore}]
  const [countdownProgress, setCountdownProgress] = useState(0); // 0..1
  const [nextSongInfo, setNextSongInfo] = useState(null); // {songId, artist, title} from server
  const [similarSongs, setSimilarSongs] = useState([]);
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
  const [musicVolume, setMusicVolume] = useState(() => {
    try { const v = localStorage.getItem('singpro_music_vol'); return v !== null ? Number(v) : 100; }
    catch { return 100; }
  });
  const [vocalsVolume, setVocalsVolume] = useState(() => {
    try { const v = localStorage.getItem('singpro_vocals_vol'); return v !== null ? Number(v) : 100; }
    catch { return 100; }
  });
  // Tooltip shown when user tries to adjust YouTube volume while stems are active
  const [volumeTooltip, setVolumeTooltip] = useState(false);
  const musicVolumeRef = useRef(musicVolume);
  musicVolumeRef.current = musicVolume;
  const karaokeAudioRef = useRef(null);  // HTMLAudioElement for instrumental
  const vocalsAudioRef = useRef(null);   // HTMLAudioElement for vocals
  const karaokeGainRef = useRef(null);   // GainNode for instrumental
  const vocalsGainRef = useRef(null);    // GainNode for vocals
  const audioCtxRef = useRef(null);      // shared AudioContext
  const karaokeSourceRef = useRef(null); // MediaElementAudioSourceNode
  const vocalsSourceRef = useRef(null);  // MediaElementAudioSourceNode

  hasStemsRef.current = hasStems;

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
      ctx = new (window.AudioContext || window.webkitAudioContext)();
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

    // Apply current volumes
    karaokeGainRef.current.gain.value = musicVolume / 100;
    vocalsGainRef.current.gain.value = vocalsVolume / 100;

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

  // Apply musicVolume to karaoke GainNode + persist
  useEffect(() => {
    if (karaokeGainRef.current) {
      karaokeGainRef.current.gain.value = musicVolume / 100;
    }
    try { localStorage.setItem('singpro_music_vol', String(musicVolume)); } catch { /* */ }
  }, [musicVolume]);

  // Apply vocalsVolume to vocals GainNode + persist.
  // For non-stems songs, also sync to YouTube player.
  useEffect(() => {
    if (vocalsGainRef.current) {
      vocalsGainRef.current.gain.value = vocalsVolume / 100;
    }
    if (!hasStemsRef.current) {
      try { iframePlayerRef.current?.setVolume(vocalsVolume); } catch { /* */ }
    }
    try { localStorage.setItem('singpro_vocals_vol', String(vocalsVolume)); } catch { /* */ }
  }, [vocalsVolume]);

  // On song transition: if stems → mute vocals for karaoke experience,
  // if no stems → apply persisted musicVolume as YouTube volume.
  const lastStemsSongRef = useRef(null);
  useEffect(() => {
    if (activeSongId === lastStemsSongRef.current) return;
    lastStemsSongRef.current = activeSongId;
    if (hasStems) {
      setVocalsVolume(0);
      try { iframePlayerRef.current?.mute(); } catch { /* */ }
    } else {
      // No stems: use musicVolume as the single YouTube volume
      const vol = musicVolume;
      setVocalsVolume(vol);
      try { iframePlayerRef.current?.unMute(); iframePlayerRef.current?.setVolume(vol); } catch { /* */ }
    }
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
        setMusicVolume(prev => {
          if (Math.abs(prev - ytVol) > 2) return ytVol;
          return prev;
        });
        setVocalsVolume(prev => {
          if (Math.abs(prev - ytVol) > 2) return ytVol;
          return prev;
        });
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
  const PLAYER_COLOR_PALETTE = [20, 45, 65, 140, 160, 215, 240, 335];
  const [ownColor, setOwnColor] = useState(() => {
    try {
      const stored = localStorage.getItem('singpro_player_color');
      if (stored !== null) return Number(stored);
    } catch { /* */ }
    // Default: pick a palette color deterministically from username
    const hash = currentUserName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return PLAYER_COLOR_PALETTE[hash % PLAYER_COLOR_PALETTE.length];
  });
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef(null);
  useEffect(() => {
    if (!colorPickerOpen) return;
    const onClickOutside = (e) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
        setColorPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', onClickOutside);
    return () => document.removeEventListener('pointerdown', onClickOutside);
  }, [colorPickerOpen]);
  const handleColorChange = useCallback((hue) => {
    setOwnColor(hue);
    setColorPickerOpen(false);
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

  // Ref for tickData so the mic callback always sees the latest without re-registering
  const tickDataRef = useRef(tickData);
  tickDataRef.current = tickData;

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

  const handleVideoStateChange = useCallback((state) => {
    if (!isHost) {
      playerStateRef.current = state;
    }

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
          const langPrefix = lang === 'en' ? '' : `/${lang}`;
          window.history.replaceState(null, '', `${langPrefix}/sing/${activeSongId}${window.location.search}`);
        }

        songInfoRef.current = jsonObj.data;
        skipSegmentsRef.current = jsonObj.data.skipSegments ?? [];
        setActiveSkipSegment(null);
        setHasStems(!!jsonObj.data.hasStems);

        const { artist, title } = jsonObj.data;

        // Update browser tab title
        if (artist && title) {
          document.title = `${artist} - ${title} | singpro.app`;
        }

        // Fetch similar songs
        if (artist && title) {
          fetch(`${apiUrl}/similar?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}`)
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

          setTickData(getTickData(lyricData, 0));
          setP2TickData(getP2TickData(lyricData, 0));

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
              setTickData(getTickData(ld, videoTime));
              setP2TickData(getP2TickData(ld, videoTime));
            }

            // Check if current time is inside a skippable segment (host only)
            if (isHostRef.current && skipSegmentsRef.current.length > 0) {
              const seg = skipSegmentsRef.current.find(s => videoTime >= s.start && videoTime < s.end);
              if (seg && autoSkipRef.current && player) {
                // Auto-skip: seek past the segment immediately, hide the Skip button.
                // Guard against re-triggering inside the new segment (seekTo lands at seg.end).
                try { player.seekTo(seg.end, true); } catch { /* player destroyed */ }
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

    // Update display immediately
    setTickData(getTickData(ld, 0));
    setP2TickData(getP2TickData(ld, 0));

    // Re-send lyrics to server for scoring
    lyricsPayloadRef.current = { lyrics: rawText, gap: ld.gap };
    const w = wssRef.current;
    if (w && w.readyState === WebSocket.OPEN && isHostRef.current) {
      sendSongLyrics(w, lyricsPayloadRef.current);
    }
  }, []);

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
      const td = tickDataRef.current;

      td.lyricRef && setHitNotesByPlayer(oldData =>
        getAndSetHitNotesByPlayer(td, oldData, freq, currentUserNameRef.current, videoTime));

      const w = wssRef.current;
      if (w) {
        sendPlayerNote(w, { freq, videoTime });
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
  }, [partyId, currentUserName, isHost]); // NO songId — WS is per-party

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
            setHitNotesByPlayer(oldData => applyRemoteNotes(oldData, remoteNotes));
          }
        }
        return;
      }

      const jsonObj = JSON.parse(msg.data);
      const td = tickDataRef.current;

      // v2 messages — batched note echoes from server (all other players' notes)
      // JSON fallback for notes_batch (in case server hasn't been updated yet)
      if (jsonObj.type === "player:notes_batch") {
        const remoteNotes = jsonObj.data.notes.filter(n => n.username !== currentUserNameRef.current);
        if (remoteNotes.length > 0) {
          setHitNotesByPlayer(oldData => applyRemoteNotes(oldData, remoteNotes));
        }
      }

      if (jsonObj.type === "party:queue_updated") {
        setQueue(jsonObj.data.queue ?? []);
      }

      // party:state is sent by the server on join — contains full state including currentSong
      if (jsonObj.type === "party:state") {
        const state = jsonObj.data;
        if (state.queue) setQueue(state.queue);
        // Extract player colors from state
        if (state.players) {
          const colors = {};
          for (const p of state.players) {
            if (p.color != null) colors[p.username] = p.color;
          }
          setPlayerColors(prev => ({ ...prev, ...colors }));
        }
        // If we're rejoining and don't have a song yet, pick up the current song
        if (state.currentSong?.songId && (!activeSongIdRef.current || activeSongIdRef.current === 'none')) {
          setActiveSongId(state.currentSong.songId);
        }
      }

      if (jsonObj.type === "player:color_changed") {
        const { username, color } = jsonObj.data;
        setPlayerColors(prev => ({ ...prev, [username]: color }));
      }

      if (jsonObj.type === "party:scores_updated") {
        const players = jsonObj.data.players ?? jsonObj.data.scores ?? [];
        const scoresMap = {};
        for (const p of players) {
          scoresMap[p.username] = { score: p.score ?? 0, cumulativeScore: p.cumulativeScore ?? 0 };
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
          navigate(lp('/'), { replace: true });
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
    navigate(lp('/'), { replace: true });
  }, [wss, navigate, lp]);

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
            onClick={() => navigate(lp('/'))}
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
    <div className="flex flex-col min-h-screen lg:h-dvh lg:overflow-hidden">
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
          gap: tickData.lyricData?.gap,
          defaultGap: tickData.lyricData?.defaultGap,
          setGap: gap => { if (Number.isFinite(gap)) gapRef.current = gap; },
        }}
        musicVolume={musicVolume}
        vocalsVolume={vocalsVolume}
        onMusicVolumeChange={setMusicVolume}
        onVocalsVolumeChange={setVocalsVolume}
        hasStems={hasStems}
        volumeTooltip={volumeTooltip}
      />

      {error && (
        <div className="text-center py-4 text-red-400 font-bold">
          {t('party.errorNoData')}
        </div>
      )}

      <div className="relative">
        <Lyrics tickData={tickData} />
        {hasDuetLyrics && (
          <button
            onClick={handleDuetToggle}
            className={`absolute top-2 right-3 flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              duetMode
                ? 'bg-neon-purple/15 text-neon-purple border-neon-purple/50 hover:bg-neon-purple/25'
                : 'bg-surface/60 text-gray-400 border-surface-lighter hover:text-white hover:border-gray-500'
            }`}
            title={duetMode ? t('party.switchSolo') : t('party.switchDuet')}
          >
            {/* Two-people icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {duetMode ? t('party.duetOn') : t('party.duetOff')}
          </button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 p-4 lg:flex-1 lg:min-h-0">
        {/* Left sidebar: join + scores + leave */}
        <div className="lg:w-44 xl:w-48 flex-shrink-0 space-y-3 lg:overflow-y-auto">
          {!micActive ? (
            <button
              onClick={handleJoinSinging}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-neon-green/10 to-neon-cyan/10 text-neon-green hover:from-neon-green/20 hover:to-neon-cyan/20 border border-neon-green/30 hover:border-neon-green/60 hover:shadow-[0_0_20px_rgba(57,255,20,0.15)] transition-all duration-300 text-sm font-semibold"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
              {t('party.joinSinging')}
            </button>
          ) : (
            <button
              onClick={handleLeaveSinging}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/60 transition-all text-sm font-semibold"
            >
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              {t('party.leaveSinging')}
            </button>
          )}
          {serverScores && Object.keys(serverScores).length > 0 && (
            <div className="bg-surface-light/80 rounded-lg p-3 backdrop-blur-sm">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('party.scores')}</div>
              {Object.entries(serverScores).map(([name, data]) => {
                const hue = playerColors[name];
                const dotColor = hue != null ? `hsl(${hue}, 100%, 55%)` : '#888';
                const isMe = name === currentUserName;
                const { score, cumulativeScore } = data;
                return (
                  <div key={name} ref={isMe ? colorPickerRef : undefined}>
                    <div className="flex items-center py-1 gap-2">
                      {isMe ? (
                        <button
                          type="button"
                          onClick={() => setColorPickerOpen(prev => !prev)}
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer hover:scale-125 transition-transform border border-white/40"
                          style={{ background: dotColor }}
                          title={t('party.yourColor')}
                        />
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
                      )}
                      <span className="text-white truncate flex-1 min-w-0 text-sm">{name}</span>
                      <PingIndicator latencyMs={playerLatencies[name]} size={10} />
                      <div className="text-right flex-shrink-0">
                        <span className="text-neon-green font-mono font-bold text-sm tabular-nums">{score.toLocaleString()}</span>
                        {cumulativeScore > 0 && (
                          <div className="text-[10px] text-gray-500 font-mono tabular-nums leading-tight">{(cumulativeScore + score).toLocaleString()}</div>
                        )}
                      </div>
                    </div>
                    {isMe && colorPickerOpen && (
                      <div className="flex flex-wrap gap-1.5 py-1 pl-5">
                        {PLAYER_COLOR_PALETTE.map(h => (
                          <button
                            key={h}
                            onClick={() => handleColorChange(h)}
                            className={`w-4 h-4 rounded-full border-2 transition-transform cursor-pointer ${
                              ownColor === h ? 'border-white scale-125' : 'border-transparent hover:scale-110'
                            }`}
                            style={{ background: `hsl(${h}, 100%, 55%)` }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Leave party button */}
          <button
            onClick={handleLeaveParty}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-surface-light/60 text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-surface-lighter hover:border-red-500/40 transition-all text-xs"
          >
            {t('party.leaveParty')}
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
              {showVideo ? t('party.hideVideo') : t('party.showVideo')}
            </button>
          )}
        </div>

        {/* Center: music bars + video */}
        <div className="flex-1 min-w-0 lg:min-h-0 lg:flex lg:flex-col">
          <MusicBars
            tickData={tickData}
            p2TickData={p2TickData}
            hitNotesByPlayer={hitNotesByPlayer}
            isHost={isHost}
            playerColors={playerColors}
            gapDragEnabled={isFixingTiming}
            gapData={{
              gap: tickData.lyricData?.gap,
              defaultGap: tickData.lyricData?.defaultGap,
              setGap: gap => { if (Number.isFinite(gap)) gapRef.current = gap; },
            }}
          />
          {/* P2 lyrics — right below the unified music bars */}
          {p2TickData && p2TickData.currentLine && (
            <Lyrics tickData={p2TickData} label={t('party.duetP2')} />
          )}
          <div className="relative lg:flex-1 lg:min-h-0">
          {showVideo && (
            <VideoPlayer videoId={videoId} onPlayerObject={handlePlayerReady} onStateChange={handleVideoStateChange} onEnd={handleVideoEnd} />
          )}

          {/* Skip Intro / Outro / Interruption — Netflix-style button over video area.
              Label depends on SponsorBlock segment category. */}
          {activeSkipSegment && isHost && (
            <button
              onClick={() => {
                const player = iframePlayerRef.current;
                if (player?.seekTo) {
                  player.seekTo(activeSkipSegment.end, true);
                }
                setActiveSkipSegment(null);
              }}
              className="absolute bottom-4 right-4 z-20 px-5 py-2.5 bg-black/70 hover:bg-black/90 text-white text-sm font-semibold rounded border border-white/40 hover:border-white/70 backdrop-blur-sm transition-all shadow-lg cursor-pointer"
            >
              {activeSkipSegment.category === 'outro'
                ? t('party.skipOutro')
                : activeSkipSegment.category === 'music_offtopic'
                  ? t('party.skipInterruption')
                  : t('party.skipIntro')}
            </button>
          )}
          </div>
        </div>

        {/* Right sidebar: queue + similar */}
        <div className="lg:w-56 xl:w-64 flex-shrink-0 space-y-4 lg:overflow-y-auto">
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
      </div>

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
                  const maxScore = endScores[0]?.score || 1;
                  const barWidth = Math.max(8, (player.score / maxScore) * 100);
                  const hasCumulative = player.cumulativeScore > player.score;

                  return (
                    <div
                      key={player.username}
                      className={`relative rounded-xl border bg-gradient-to-r ${colorClass} overflow-hidden animate-slide-up`}
                      style={{ animationDelay: `${(i + 1) * 150}ms` }}
                    >
                      {/* Score bar background */}
                      <div
                        className="absolute inset-y-0 left-0 bg-white/5 transition-all duration-1000 ease-out"
                        style={{ width: `${barWidth}%` }}
                      />
                      <div className="relative flex items-center gap-3 px-4 py-3">
                        <span className="text-xl w-7 text-center flex-shrink-0">{medal}</span>
                        <div className="flex-1 text-left min-w-0">
                          <div className={`font-bold truncate ${rank === 0 ? "text-lg text-white" : "text-base text-gray-200"}`}>
                            {player.username}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`font-mono font-black ${rank === 0 ? "text-2xl" : "text-lg"} ${scoreColor} leading-tight`}>
                            {player.score.toLocaleString()}
                          </div>
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

            {/* Next up + countdown */}
            <div className="flex flex-col items-center gap-4">
              {/* Next song info */}
              {(() => {
                const next = queue.length > 0 ? queue[0] : nextSongInfo;
                if (next?.title) {
                  return (
                    <div className="text-gray-400">
                      {t('party.upNext')} <span className="text-neon-magenta font-semibold">{next.title}</span>
                      <span className="text-gray-500"> - {next.artist}</span>
                    </div>
                  );
                }
                return <div className="text-gray-500">{t('party.noMoreSongs')}</div>;
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
