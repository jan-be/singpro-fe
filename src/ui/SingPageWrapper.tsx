import React from "react";
import SingPage from "./SingPage";
import {useParams} from "react-router-dom";
import {setVideoId} from "../state/actions";

const SingPageWrapper = () => {

  const {videoId} = useParams();
  // @ts-ignore
  setVideoId(videoId);

  return (
    <div>
      <SingPage/>
    </div>
  );
};

export default SingPageWrapper;
