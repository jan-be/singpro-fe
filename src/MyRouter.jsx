import { BrowserRouter as Router, Route, Switch } from "react-router-dom";
import React from "react";
import SongSelectionPage from "./pages/SongSelectionPage";
import PartyPage from "./pages/PartyPage";
import SingOnlyPage from "./pages/SingOnlyPage";
import EntryPage from "./pages/EntryPage";
import JoinPlayerPage from "./pages/JoinPlayerPage";
import NotFoundPage from "./pages/NotFoundPage";

const MyRouter = () =>
  <Router>
    <Switch>
      <Route path="/select-song" exact component={SongSelectionPage}/>
      <Route path="/join-player" exact component={JoinPlayerPage}/>
      <Route path="/mic/:partyId/:username" exact component={SingOnlyPage}/>
      <Route path="/sing/:songId" exact component={PartyPage}/>
      <Route path="/sing/:slug/:songId" exact component={PartyPage}/>
      <Route path="/" exact component={EntryPage}/>
      <Route component={NotFoundPage}/>
    </Switch>
  </Router>;

export default MyRouter;
