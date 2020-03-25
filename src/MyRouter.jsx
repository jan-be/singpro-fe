import { BrowserRouter as Router, Route, Switch } from "react-router-dom";
import React from "react";
import EntryPage from "./ui/EntryPage";
import SingPage from "./ui/SingPage";

const MyRouter = () =>
  <Router>
    <Switch>
      <Route path="/sing/:videoId" exact component={SingPage}/>
      <Route path="/" exact component={EntryPage}/>
    </Switch>
  </Router>;

export default MyRouter;


