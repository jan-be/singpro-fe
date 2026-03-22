import React, { Suspense, use } from "react";
import { ImageListItem, ImageListItemBar, Grid, Container } from "@mui/material";
import { Link } from "react-router-dom";
import SearchBar from "../components/SearchBar";
import { apiUrl } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";
import WrapperPage from "./WrapperPage";

const recommendedPromise = fetch(`${apiUrl}/recommended`).then(r => r.json()).then(j => j.data);

const SongList = () => {
  const videoData = use(recommendedPromise);

  return (
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
  );
};

const SongSelectionPage = () =>
  <WrapperPage>
    <Container maxWidth="md">
      <SearchBar/>
      <Suspense fallback={<div>Loading...</div>}>
        <SongList/>
      </Suspense>
    </Container>
  </WrapperPage>
;

export default SongSelectionPage;
