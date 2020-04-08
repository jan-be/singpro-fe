import React from "react";
import { Link } from "react-router-dom";
import { Button } from '@material-ui/core';


const EntryPage = () =>
  <div>
    <Link to="/select-song"><Button>Host game</Button></Link>
    <Link to="/join-player"><Button>Join game</Button></Link>
  </div>;

export default EntryPage;
