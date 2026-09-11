import React from 'react';
import YouTube from 'react-youtube';
import css from './VideoPlayer.module.css';

// YouTube's privacy-enhanced mode: the player is served from
// youtube-nocookie.com and sets no cookies, so no consent gate is needed.
const YT_HOST = 'https://www.youtube-nocookie.com';

// The old consent gate stored its answer here; nothing reads it any more.
try { localStorage.removeItem('singpro-yt-consent'); } catch { /* */ }

const VideoPlayer = props => (
  <div className={css.videoContainerWrapper}>
    <div className={css.videoContainer}>
      {props.videoId && (
        <YouTube
          videoId={props.videoId}
          opts={{
            host: YT_HOST,
            playerVars: { autoplay: 1, origin: window.location.origin },
          }}
          onReady={e => props.onPlayerObject(e.target)}
          onStateChange={e => props.onStateChange?.(e.data)}
          onEnd={() => props.onEnd?.()}
        />
      )}
    </div>
  </div>
);

export default VideoPlayer;
