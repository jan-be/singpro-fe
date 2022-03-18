import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';

const BottomPartyIdBar = props => {

  return (
    <React.Fragment>
      <AppBar position="fixed" color="primary" sx={{ top: 'auto', bottom: 0 }}>
        <Toolbar sx={{ fontSize: 20 }}>
          <span><b>{window.location.hostname}</b></span>
          &nbsp;
          <span>Game PIN: <b>{props.partyId}</b></span>
        </Toolbar>
      </AppBar>
    </React.Fragment>
  );
};

export default BottomPartyIdBar;
