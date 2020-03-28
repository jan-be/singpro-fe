import { BrowserRouter as Router, Route, Switch } from "react-router-dom";
import React from "react";
import EntryPage from "./ui/EntryPage";
import PartyPage from "./ui/PartyPage";
import SingOnlyPage from "./ui/SingOnlyPage";

const MyRouter = () =>
  <Router>
    <Switch>
      <Route path="/hmm" exact component={SingOnlyPage}/>
      <Route path="/sing/:videoId" exact component={PartyPage}/>
      <Route path="/" exact component={EntryPage}/>
    </Switch>
  </Router>;

export default MyRouter;


