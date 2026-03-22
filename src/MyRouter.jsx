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
import { ThemeProvider } from "@mui/material";
import Theme from "./Theme"

const MyRouter = () =>
  <ThemeProvider theme={Theme}>
    <Router>
      <Routes>
        <Route path="/contact" element={<ContactPage/>}/>
        <Route path="/privacy-policy" element={<PrivacyPolicyPage/>}/>
        <Route path="/tos" element={<TermsOfServicePage/>}/>
        <Route path="/select-song" element={<SongSelectionPage/>}/>
        <Route path="/mic/:partyId/:username" element={<SingOnlyPage/>}/>
        <Route path="/sing/:songId" element={<PartyPage/>}/>
        <Route path="/sing/:slug/:songId" element={<PartyPage/>}/>
        <Route path="/" element={<EntryPage/>}/>
        <Route path="*" element={<NotFoundPage/>}/>
      </Routes>
    </Router>
  </ThemeProvider>
;

export default MyRouter;
