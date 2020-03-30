import { BrowserRouter as Router, Route, Switch } from "react-router-dom";
import React from "react";
import SongSelectionPage from "./ui/SongSelectionPage";
import PartyPage from "./ui/PartyPage";
import SingOnlyPage from "./ui/SingOnlyPage";
import EntryPage from "./ui/EntryPage";

const MyRouter = () =>
  <Router>
    <Switch>
      <Route path="/select-song" exact component={SongSelectionPage}/>
      <Route path="/mic" exact component={SingOnlyPage}/>
      <Route path="/sing/:videoId" exact component={PartyPage}/>
      <Route path="/" exact component={EntryPage}/>
    </Switch>
  </Router>;

export default MyRouter;


