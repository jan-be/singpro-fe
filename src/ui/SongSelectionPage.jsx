import React from "react";
import { Link } from "react-router-dom";

const songs = [
  { title: "Viva la Vida", videoId: "dvgZkm1xWPE" },
  { title: "I gotta feeling", videoId: "uSD4vsh1zDA" },
  { title: "I'm gonna be (500 Miles)", videoId: "tbNlMtqrYS0" },
  { title: "In the end", videoId: "eVTXPUF4Oz4" },
  { title: "Heaven", videoId: "3eT464L1YRA" },
  { title: "Wahnsinn", videoId: "8WQFqRO3Xzg" },
];

const SongSelectionPage = () =>
  <div>
    {songs.map((el, i) =>
      <div key={i}>
        <Link to={`/sing/${el.videoId}`}>{el.title}</Link>
      </div>)}
  </div>;

export default SongSelectionPage;
