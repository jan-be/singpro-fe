import React from "react";
import css from './BackgroundImage.module.css';

const BackgroundImage = ({ videoId }) => {
  if (!videoId) return null;
  const url = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return (
    <div className={css.content} style={{ backgroundImage: `url(${url})` }}/>
  );
};

export default BackgroundImage;
