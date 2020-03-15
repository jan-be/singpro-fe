import {BrowserRouter as Router, Route, Switch} from "react-router-dom";
import React from "react";
import EntryPage from "./ui/EntryPage";
import SingPageWrapper from "./ui/SingPageWrapper";

const MyRouter = () =>
  <Router>
    <Switch>
      <Route path="/sing/:videoId" exact component={SingPageWrapper}/>
      <Route path="/" exact component={EntryPage}/>
    </Switch>
  </Router>;

export default MyRouter;


