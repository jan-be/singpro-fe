import React from "react";
import css from './BackgroundImage.module.css'
import store from "../state/store";

const BackgroundImage = () => {
  const styles = {
    backgroundImage: `url('https://img.youtube.com/vi/${store.getState().videoId}/maxresdefault.jpg')`,
  };

  return (
    <div className={css.content} style={styles}>
      Bar
    </div>
  );
};

export default BackgroundImage;
