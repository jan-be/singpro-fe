import React, { useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import css from './VideoPlayer.module.css';

// YouTube's privacy-enhanced mode: the player is served from
// youtube-nocookie.com and sets no cookies, so no consent gate is needed.
const YT_HOST = 'https://www.youtube-nocookie.com';

// The old consent gate stored its answer here; nothing reads it any more.
try { localStorage.removeItem('singpro-yt-consent'); } catch { /* */ }

// The lyrics are ours; YouTube's captions must never appear on top of the
// video. There is no player parameter that forces them off (cc_load_policy can
// only force them on, and the viewer's YouTube preference wins otherwise), so
// the captions module is unloaded through the API: on ready, whenever a video
// is (re)started or cued, and whenever the player reports it loaded a module.
const disableCaptions = (player) => {
  for (const mod of ['captions', 'cc']) {
    try { player.unloadModule?.(mod); } catch { /* module not loaded */ }
  }
};
const CAPTION_RELOAD_STATES = new Set([-1, 1, 5]); // unstarted, playing, cued

/**
 * The YouTube player, filling its (absolutely positioned) parent — the stage.
 * YouTube letterboxes the video inside the iframe itself.
 *
 * One player for the party: the next song's video is loaded into the one
 * there is. Given a new videoId, react-youtube replaces the player, iframe
 * and all — YouTube's page and some 3.5 MB of its script loaded and run
 * again at every song change, which on a TV stick (where the frame shares the
 * page's main thread) took it over for seconds just as the song started.
 * `onVideoChange(player)` tells the page another video is in, the way
 * `onPlayerObject` tells it about a new player.
 */
const VideoPlayer = props => {
  const { videoId, onVideoChange } = props;
  const playerRef = useRef(null);
  const createdWithRef = useRef(null); // the video the player was created with: react-youtube's videoId, kept
  const loadedRef = useRef(null);      // the video it holds now
  if (!videoId) createdWithRef.current = null; // no video, no player: the next one is created anew
  else if (!createdWithRef.current) createdWithRef.current = videoId;

  const load = (player, id) => {
    if (!id || id === loadedRef.current) return;
    loadedRef.current = id;
    try { player.loadVideoById(id); } catch { /* the player is going */ }
    onVideoChange?.(player);
  };
  useEffect(() => {
    if (!videoId) { playerRef.current = null; loadedRef.current = null; return; } // react-youtube destroyed it
    if (playerRef.current) load(playerRef.current, videoId);
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={css.videoContainer}>
      {videoId && (
        <YouTube
          videoId={createdWithRef.current}
          opts={{
            host: YT_HOST,
            // No player controls: the page has its own timeline and click-to-pause,
            // and the bar must never show through gaps between the panels laid
            // over the video. No related videos, annotations or fullscreen button
            // either; inline playback on iOS.
            playerVars: { autoplay: 1, controls: 0, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1, disablekb: 1, origin: window.location.origin },
          }}
          onReady={e => {
            playerRef.current = e.target;
            loadedRef.current = createdWithRef.current;
            disableCaptions(e.target);
            try { e.target.addEventListener('onApiChange', () => disableCaptions(e.target)); } catch { /* */ }
            props.onPlayerObject(e.target);
            load(e.target, videoId); // the song changed while the player was starting
          }}
          onStateChange={e => {
            if (CAPTION_RELOAD_STATES.has(e.data)) disableCaptions(e.target);
            props.onStateChange?.(e.data);
          }}
          onEnd={() => props.onEnd?.()}
          // 2 bad id, 5 player error, 100 gone, 101/150 embedding disabled.
          // Without this the stage just stays black and the page keeps
          // offering "tap to play" for a video that will never start.
          onError={e => props.onError?.(e.data)}
        />
      )}
    </div>
  );
};

// Memoised: the party page re-renders on queue, score and player messages,
// none of which concern the player
export default React.memo(VideoPlayer);
