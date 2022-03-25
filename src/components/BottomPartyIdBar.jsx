import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import { Grid } from "@mui/material";

const BottomPartyIdBar = props => {

  return (
    <AppBar position="fixed" color="primary" sx={{ top: 'auto', bottom: 0 }}>
      <Toolbar sx={{ fontSize: 20 }}>
        <Grid container alignItems="center">
          <Grid item xs={6}>{window.location.hostname}</Grid>
          <Grid item xs={6} sx={{ textAlign: "right" }}>Game PIN: <b>{props.partyId}</b></Grid>
        </Grid>
      </Toolbar>
    </AppBar>
  );
};

export default BottomPartyIdBar;
