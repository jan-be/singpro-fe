import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import { Grid, Input, Slider, Stack } from "@mui/material";

const BottomPartyIdBar = ({ partyId, gap, defaultGap, setGap }) => {

  return (
    <AppBar position="fixed" color="primary" sx={{ top: 'auto', bottom: 0 }}>
      <Toolbar sx={{ fontSize: 20 }}>
        <Grid container alignItems="center">
          <Grid item xs={4}>{window.location.hostname}</Grid>

          <Grid item xs={4} sx={{ textAlign: "center" }}>
            <Stack spacing={2} direction="row" sx={{ mb: 1 }} alignItems="center">
              <Slider value={gap} onChange={setGap} min={0} max={defaultGap * 2} defaultValue={defaultGap} color="secondary"/>
              <Input value={gap} onChange={setGap}/>
            </Stack>
          </Grid>

          <Grid item xs={4} sx={{ textAlign: "right" }}>Game PIN: <b>{partyId}</b></Grid>
        </Grid>
      </Toolbar>
    </AppBar>
  );
};

export default BottomPartyIdBar;
