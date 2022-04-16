import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import { Button, Grid, Link } from "@mui/material";
import GapCorrector from "./GapCorrector";
import { ReactComponent as MyIcon } from "../icon.svg";
import { Link as RouterLink } from "react-router-dom";
import { getRandInt } from "../logic/RandomUtility";

const BottomPartyIdBar = ({ partyId, setPartyId, songId, gapData }) => {

  return (
    <AppBar position="static" color="primary">
      <Toolbar sx={{ fontSize: 20 }}>
        <Grid container alignItems="center">
          <Grid item xs={3}>
            <Link color="#FFF" underline="none" component={RouterLink} to="/">
              <MyIcon width="16" height="16"/>
              &nbsp;{window.location.hostname}
            </Link>
          </Grid>

          <Grid item xs={3} sx={{ textAlign: "center" }}>
            <GapCorrector songId={songId} gapData={gapData}/>
          </Grid>

          <Grid item xs={3}>
            <Button variant="outlined" color="secondary" onClick={() => document.documentElement.requestFullscreen()}>Fullscreen</Button>
          </Grid>

          {partyId
            ?
            <Grid item xs={3} sx={{ textAlign: "right" }}>Game PIN: <b>{partyId}</b></Grid>
            :
            <Button sx={{ textAlign: "right" }} color="secondary" variant="outlined"
                    onClick={() => setPartyId(getRandInt(1e5, 1e6))}>Start Party</Button>
          }
        </Grid>
      </Toolbar>
    </AppBar>
  );
};

export default BottomPartyIdBar;
