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
            onReady={e => props.onPlayerObject(e.target)}/>
          : null}
      </div>
    </div>
  );
};

export default VideoPlayer;
