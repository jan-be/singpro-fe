import React, { useEffect, useState } from "react";
import css from './BackgroundImage.module.css'

const BackgroundImage = props => {
  const key = "AIzaSyAnhqBfbdTRaFV1MrkPp7aQ1qvulSB5tNQ";

  const [styles, setStyles] = useState({});

  useEffect(() => {
    (async () => {
      const url = `https://www.googleapis.com/youtube/v3/videos?key=${key}&part=snippet&id=${props.videoId}`;

      let resp = await fetch(url);
      let body = await resp.json();
      let { thumbnails } = body.items[0].snippet;
      let highestResThumbnail = Object.values(thumbnails).slice(-1)[0].url;

      setStyles(oldStyles => {
        return { backgroundImage: `url(${highestResThumbnail})` };
      });
    })();
  }, [props.videoId]);

  return (
    <div className={css.content} style={styles}/>
  );
};

export default BackgroundImage;
