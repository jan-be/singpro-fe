import React from "react";
import { Button } from '@material-ui/core';
import { Link } from 'react-router-dom';

const EntryPage = () =>
  <div>
    <Button variant="outlined" component={Link} to="/select-song">Host game</Button>
    <Button variant="outlined" component={Link} to="/join-player">Join game</Button>
  </div>;

export default EntryPage;
