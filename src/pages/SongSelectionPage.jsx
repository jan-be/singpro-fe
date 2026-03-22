import React, { useEffect, useState } from "react";
import { ImageListItem, ImageListItemBar, Grid, Container } from "@mui/material";
import { Link } from "react-router-dom";
import SearchBar from "../components/SearchBar";
import { apiUrl } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";
import WrapperPage from "./WrapperPage";

const SongSelectionPage = () => {

  const [videoData, setVideoData] = useState([]);

  useEffect(() => {
    (async () => {
      let resp = await fetch(`${apiUrl}/recommended`);
      let jsonObj = await resp.json();

      // one hell of a one-liner
      // https://stackoverflow.com/questions/2218999/how-to-remove-all-duplicates-from-an-array-of-objects
      setVideoData(oldData => [...oldData, ...jsonObj.data].filter((v, i, a) => a.findIndex(v2 => (v2.songId === v.songId)) === i));
    })();
  }, []);

  return (
    <WrapperPage>
      <Container maxWidth="md">
        <SearchBar/>
        <Grid container>
          {videoData.map((e, i) =>
            <Grid key={i} size={{ xs: 12, lg: 4, md: 6 }}>
              <ImageListItem component={Link}
                             to={`/sing/${urlEscapedTitle(e.artist, e.title)}/${e.songId}`}>
                <img src={`https://i.ytimg.com/vi/${e.videoId}/mqdefault.jpg`} alt=""/>
                <ImageListItemBar title={e.title} subtitle={e.artist}/>
              </ImageListItem>
            </Grid>)
          }
        </Grid>
      </Container>
    </WrapperPage>
  );
};

export default SongSelectionPage;
