import React from 'react';
import YouTube from 'react-youtube';
import css from './VideoPlayer.module.css';

const VideoPlayer = props => {
  return (
    <div className={css.videoContainerWrapper}>
      <div className={css.videoContainer}>
        <YouTube
          videoId={props.videoId}
          onReady={e => props.onPlayerObject(e.target)}/>
      </div>
    </div>
  );
};

export default VideoPlayer;
