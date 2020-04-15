import React, { useEffect, useState } from "react";
import makeStyles from "@material-ui/core/styles/makeStyles";
import { Container, GridList, GridListTile, GridListTileBar, useMediaQuery, useTheme } from "@material-ui/core";
import { Link } from "react-router-dom";
import SearchBar from "../components/SearchBar";
import { apiDomain } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    overflow: 'hidden',
    backgroundColor: theme.palette.background.paper,
  },
}));

const SongSelectionPage = () => {
  const classes = useStyles();

  const [videoData, setVideoData] = useState([]);

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('sm'));

  useEffect(() => {
    (async () => {
      let resp = await fetch(`https://${apiDomain}/recommended`);
      let jsonObj = await resp.json();

      for (let item of jsonObj.data) {

        setVideoData(oldData => ([...oldData, item]));
      }
    })();
  }, []);

  return (
    <Container maxWidth="sm">
      <SearchBar/>
      <div className={classes.root}>
        <GridList>
          {videoData.map((e, i) =>
            <GridListTile cols={matches ? 1 : 2} component={Link}
                          to={`/sing/${urlEscapedTitle(e.artist, e.title)}/${e.songId}`} key={i}>
              <img src={`https://i.ytimg.com/vi/${e.videoId}/mqdefault.jpg`} alt=""/>
              <GridListTileBar title={e.title}/>
            </GridListTile>)
          }
        </GridList>
      </div>
    </Container>
  );
};

export default SongSelectionPage;
