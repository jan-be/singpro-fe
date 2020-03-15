import React from "react";
import './BackgroundImage.css'
import store from "../state/store";

const BackgroundImage = () => {
  const styles = {
    backgroundImage: `url('https://img.youtube.com/vi/${store.getState().videoId}/maxresdefault.jpg')`,
  };

  return (
    <div className="content" style={styles}>
      Bar
    </div>
  );
};

export default BackgroundImage;
