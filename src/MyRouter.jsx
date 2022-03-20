import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import React from "react";
import ContactPage from "./pages/compliance/ContactPage";
import PrivacyPolicyPage from "./pages/compliance/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/compliance/TermsOfServicePage";
import SongSelectionPage from "./pages/SongSelectionPage";
import PartyPage from "./pages/PartyPage";
import SingOnlyPage from "./pages/SingOnlyPage";
import EntryPage from "./pages/EntryPage";
import NotFoundPage from "./pages/NotFoundPage";

const MyRouter = () =>
  <Router>
    <Routes>
      <Route path="/contact" exact element={<ContactPage/>}/>
      <Route path="/privacy-policy" exact element={<PrivacyPolicyPage/>}/>
      <Route path="/tos" exact element={<TermsOfServicePage/>}/>
      <Route path="/select-song" exact element={<SongSelectionPage/>}/>
      <Route path="/mic/:partyId/:username" exact element={<SingOnlyPage/>}/>
      <Route path="/sing/:songId" exact element={<PartyPage/>}/>
      <Route path="/sing/:slug/:songId" exact element={<PartyPage/>}/>
      <Route path="/" exact element={<EntryPage/>}/>
      <Route path="*" element={<NotFoundPage/>}/>
    </Routes>
  </Router>;

export default MyRouter;
