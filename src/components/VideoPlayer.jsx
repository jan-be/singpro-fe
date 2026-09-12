import React from 'react';
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
 */
const VideoPlayer = props => (
  <div className={css.videoContainer}>
    {props.videoId && (
      <YouTube
        videoId={props.videoId}
        opts={{
          host: YT_HOST,
          // No player controls: the page has its own timeline and click-to-pause,
          // and the bar must never show through gaps between the panels laid
          // over the video. No related videos, annotations or fullscreen button
          // either; inline playback on iOS.
          playerVars: { autoplay: 1, controls: 0, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1, disablekb: 1, origin: window.location.origin },
        }}
        onReady={e => {
          disableCaptions(e.target);
          try { e.target.addEventListener('onApiChange', () => disableCaptions(e.target)); } catch { /* */ }
          props.onPlayerObject(e.target);
        }}
        onStateChange={e => {
          if (CAPTION_RELOAD_STATES.has(e.data)) disableCaptions(e.target);
          props.onStateChange?.(e.data);
        }}
        onEnd={() => props.onEnd?.()}
      />
    )}
  </div>
);

export default VideoPlayer;
