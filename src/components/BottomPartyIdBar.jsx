import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';

const useStyles = makeStyles(() => ({
  appBar: {
    top: 'auto',
    bottom: 0,
  },

  text: {
    fontSize: 20,
  },
}));

const BottomPartyIdBar = props => {
  const classes = useStyles();

  return (
    <React.Fragment>
      <AppBar position="fixed" color="primary" className={classes.appBar}>
        <Toolbar className={classes.text}>
          <span><b>{window.location.hostname}</b></span>
          &nbsp;
          <span>Game PIN: <b>{props.partyId}</b></span>
        </Toolbar>
      </AppBar>
    </React.Fragment>
  );
};

export default BottomPartyIdBar;
