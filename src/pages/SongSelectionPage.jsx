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

      for (let item of jsonObj.data) {

        setVideoData(oldData => ([...oldData, item]));
      }
    })();
  }, []);

  return (
    <WrapperPage>
      <Container maxWidth="md">
        <SearchBar/>
        <Grid container>
          {videoData.map((e, i) =>
            <Grid item key={i} xs={12} lg={4} md={6}>
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
