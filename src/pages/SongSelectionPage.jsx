import React, { useEffect, useState } from "react";
import { Container, ImageList, ImageListItem, ImageListItemBar, useMediaQuery, useTheme, Box } from "@mui/material";
import { Link } from "react-router-dom";
import SearchBar from "../components/SearchBar";
import { apiUrl } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";

const SongSelectionPage = () => {

  const [videoData, setVideoData] = useState([]);

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('sm'));

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
    <Container maxWidth="sm">
      <SearchBar/>
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        overflow: 'hidden',
        backgroundColor: theme.palette.background.paper,
      }}>
        <ImageList>
          {videoData.map((e, i) =>
            <ImageListItem cols={matches ? 1 : 2} component={Link}
                           to={`/sing/${urlEscapedTitle(e.artist, e.title)}/${e.songId}`} key={i}>
              <img src={`https://i.ytimg.com/vi/${e.videoId}/mqdefault.jpg`} alt=""/>
              <ImageListItemBar title={e.title}/>
            </ImageListItem>)
          }
        </ImageList>
      </Box>
    </Container>
  );
};

export default SongSelectionPage;
