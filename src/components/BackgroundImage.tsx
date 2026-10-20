import React from "react";
import css from './BackgroundImage.module.css';

/** `hidden`: something opaque covers the whole page (the playing video), so
 *  the blurred full-screen layer is not kept around for nothing. */
const BackgroundImage = ({ videoId, hidden = false }) => {
  if (!videoId || hidden) return null;
  const url = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return (
    <div className={css.content} style={{ backgroundImage: `url(${url})` }}/>
  );
};

export default BackgroundImage;
