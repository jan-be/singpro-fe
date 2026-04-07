import React from 'react';
import YouTube from 'react-youtube';
import css from './VideoPlayer.module.css';

const VideoPlayer = props => {
  return (
    <div className={css.videoContainerWrapper}>
      <div className={css.videoContainer}>
        {props.videoId
          ? <YouTube
            videoId={props.videoId}
            opts={{ playerVars: { autoplay: 1 } }}
            onReady={e => props.onPlayerObject(e.target)}
            onStateChange={e => props.onStateChange?.(e.data)}
            onEnd={() => props.onEnd?.()}/>
          : null}
      </div>
    </div>
  );
};

export default VideoPlayer;
