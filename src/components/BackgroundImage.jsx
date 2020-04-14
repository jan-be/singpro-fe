import React from "react";
import css from './BackgroundImage.module.css';

const BackgroundImage = props => {
  return (
    <div className={css.content} style={{ backgroundImage: `url(${props.thumbnailUrl})` }}/>
  );
};

export default BackgroundImage;
