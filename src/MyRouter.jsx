import { BrowserRouter as Router, Route, Routes, Navigate, useParams } from "react-router-dom";
import React from "react";
import ContactPage from "./pages/compliance/ContactPage";
import PrivacyPolicyPage from "./pages/compliance/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/compliance/TermsOfServicePage";
import PartyPage from "./pages/PartyPage";
import EntryPage from "./pages/EntryPage";
import JoinPage from "./pages/JoinPage";
import NotFoundPage from "./pages/NotFoundPage";

// Legacy /mic/:partyId/:username route — redirect to join page
const MicRedirect = () => {
  const { partyId } = useParams();
  return <Navigate to={`/join/${partyId}`} replace />;
};

const MyRouter = () =>
  <Router>
    <Routes>
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/tos" element={<TermsOfServicePage />} />
      <Route path="/join/:partyId" element={<JoinPage />} />
      <Route path="/mic/:partyId/:username" element={<MicRedirect />} />
      <Route path="/sing/:songId" element={<PartyPage />} />
      <Route path="/sing/:slug/:songId" element={<PartyPage />} />
      <Route path="/" element={<EntryPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </Router>
;

export default MyRouter;
