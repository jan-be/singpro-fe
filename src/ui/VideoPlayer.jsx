import React from 'react';
import YouTube from 'react-youtube';
import css from './VideoPlayer.module.css'

const VideoPlayer = props => {

  return (
    <div className={css.videoContainerWrapper}>
      <div className={css.videoContainer}>
        <YouTube videoId={props.videoId} onPlay={props.onPlay}/>
      </div>
    </div>
  );
};

export default VideoPlayer;
