import React, { useEffect, useState } from "react";
import makeStyles from "@material-ui/core/styles/makeStyles";
import { Container, GridList, GridListTile, GridListTileBar, useMediaQuery, useTheme } from "@material-ui/core";
import { Link } from "react-router-dom";

const videoIds = [
  "dvgZkm1xWPE",
  "uSD4vsh1zDA",
  "tbNlMtqrYS0",
  "eVTXPUF4Oz4",
  "3eT464L1YRA",
  "8WQFqRO3Xzg",
];

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

  const key = "AIzaSyAnhqBfbdTRaFV1MrkPp7aQ1qvulSB5tNQ";

  const [videoData, setVideoData] = useState([]);

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('sm'));

  useEffect(() => {
    (async () => {
      console.log(videoIds.join());
      const url = `https://www.googleapis.com/youtube/v3/videos?key=${key}&part=snippet&id=${videoIds.join()}`;

      let resp = await fetch(url);
      let body = await resp.json();

      for (let item of body.items) {

        let { thumbnails } = item.snippet;
        let highestResThumbnail = Object.values(thumbnails).slice(-1)[0].url;

        setVideoData(oldData => ([
          ...oldData, { videoId: item.id, thumbnailUrl: highestResThumbnail, title: item.snippet.title },
        ]));
      }
    })();
  }, []);

  return (
    <Container maxWidth="sm">
      <div className={classes.root}>
        <GridList>
          {videoData.map(({ videoId, thumbnailUrl, title }, i) =>
            <GridListTile cols={matches ? 1 : 2} component={Link} to={`/sing/${videoId}`} key={i}>
              <img src={thumbnailUrl} alt=""/>
              <GridListTileBar title={title}/>
            </GridListTile>)
          }
        </GridList>
      </div>
    </Container>
  );
};

export default SongSelectionPage;
