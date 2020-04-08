import React from "react";
import { Button } from '@material-ui/core';

const EntryPage = () =>
  <div>
    <Button variant="outlined" href="/select-song">Host game</Button>
    <Button variant="outlined" href="/join-player">Join game</Button>
  </div>;

export default EntryPage;
