import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import React from "react";
import SongSelectionPage from "./pages/SongSelectionPage";
import PartyPage from "./pages/PartyPage";
import SingOnlyPage from "./pages/SingOnlyPage";
import EntryPage from "./pages/EntryPage";
import JoinPlayerPage from "./pages/JoinPlayerPage";
import NotFoundPage from "./pages/NotFoundPage";

const MyRouter = () =>
  <Router>
    <Routes>
      <Route path="/select-song" exact element={<SongSelectionPage/>}/>
      <Route path="/join-player" exact element={<JoinPlayerPage/>}/>
      <Route path="/mic/:partyId/:username" exact element={<SingOnlyPage/>}/>
      <Route path="/sing/:songId" exact element={<PartyPage/>}/>
      <Route path="/sing/:slug/:songId" exact element={<PartyPage/>}/>
      <Route path="/" exact element={<EntryPage/>}/>
      <Route element={<NotFoundPage/>}/>
    </Routes>
  </Router>;

export default MyRouter;
