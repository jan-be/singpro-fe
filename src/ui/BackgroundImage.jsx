import React from "react";
import css from './BackgroundImage.module.css'

const BackgroundImage = props => {
  const styles = {
    backgroundImage: `url('https://img.youtube.com/vi/${props.videoId}/maxresdefault.jpg')`,
  };

  return (
    <div className={css.content} style={styles}/>
  );
};

export default BackgroundImage;
