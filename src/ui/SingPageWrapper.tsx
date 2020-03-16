import React from "react";
import SingPage from "./SingPage";
import {useParams} from "react-router-dom";
import store from "../state/store";
import {setVideoId} from "../state/actions";

const SingPageWrapper = () => {

  const {videoId} = useParams();
// @ts-ignore
  store.dispatch(setVideoId(videoId));

  return (
    <div>
      <SingPage/>
    </div>
  );
};

export default SingPageWrapper;
