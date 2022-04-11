import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import { Grid } from "@mui/material";
import GapCorrector from "./GapCorrector";

const BottomPartyIdBar = ({ partyId, songId, gapData }) => {

  return (
    <AppBar position="fixed" color="primary" sx={{ top: 'auto', bottom: 0 }}>
      <Toolbar sx={{ fontSize: 20 }}>
        <Grid container alignItems="center">
          <Grid item xs={4}>{window.location.hostname}</Grid>

          <Grid item xs={4} sx={{ textAlign: "center" }}>
            <GapCorrector songId={songId} gapData={gapData}/>
          </Grid>

          <Grid item xs={4} sx={{ textAlign: "right" }}>Game PIN: <b>{partyId}</b></Grid>
        </Grid>
      </Toolbar>
    </AppBar>
  );
};

export default BottomPartyIdBar;
