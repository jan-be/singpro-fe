import { BrowserRouter as Router, Route, Routes, Navigate, useParams, useLocation } from "react-router-dom";
import React, { useEffect } from "react";
import { supportedLanguages } from "./i18n/i18n";
import ContactPage from "./pages/compliance/ContactPage";
import PrivacyPolicyPage from "./pages/compliance/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/compliance/TermsOfServicePage";
import PartyPage from "./pages/PartyPage";
import EntryPage from "./pages/EntryPage";
import JoinPage from "./pages/JoinPage";
import NotFoundPage from "./pages/NotFoundPage";

/**
 * Sets the document title for a route. (Language is not part of the URL any
 * more — i18n.js keeps <html lang> in sync with the detected/selected language.)
 */
const Page = ({ title, children }) => {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
  return children;
};

/**
 * Legacy /{lang}/... URLs → bare path (301 in nginx; this covers the dev server
 * and in-app navigation). Unknown first segments fall through to the 404 page.
 */
const LegacyLangRedirect = () => {
  const { lang } = useParams();
  const location = useLocation();

  if (!supportedLanguages.includes(lang)) {
    return <NotFoundPage />;
  }
  const rest = location.pathname.replace(/^\/[^/]+/, '') || '/';
  return <Navigate to={`${rest}${location.search}${location.hash}`} replace />;
};

// Legacy /mic/:partyId/:username route — redirect to join page
const MicRedirect = () => {
  const { partyId } = useParams();
  return <Navigate to={`/join/${partyId}`} replace />;
};

// Redirect old slug URLs: /sing/:slug/:songId → /sing/:songId
const SlugRedirect = () => {
  const { songId } = useParams();
  const location = useLocation();
  return <Navigate to={`/sing/${songId}${location.search}${location.hash}`} replace />;
};

const MyRouter = () =>
  <Router>
    <Routes>
      <Route path="/contact" element={<Page title="Contact | singpro.app"><ContactPage /></Page>} />
      <Route path="/privacy-policy" element={<Page title="Privacy Policy | singpro.app"><PrivacyPolicyPage /></Page>} />
      <Route path="/tos" element={<Page title="Terms of Service | singpro.app"><TermsOfServicePage /></Page>} />
      <Route path="/join/:partyId" element={<Page title="Join Party | singpro.app"><JoinPage /></Page>} />
      <Route path="/mic/:partyId/:username" element={<MicRedirect />} />
      <Route path="/sing/:slug/:songId" element={<SlugRedirect />} />
      <Route path="/sing/:songId" element={<PartyPage />} />
      <Route path="/" element={<Page title="singpro.app – Free Online Karaoke with Friends"><EntryPage /></Page>} />

      {/* Legacy language-prefixed URLs (/de, /de/sing/…) */}
      <Route path="/:lang" element={<LegacyLangRedirect />} />
      <Route path="/:lang/*" element={<LegacyLangRedirect />} />

      {/* Catch-all: 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </Router>
;

export default MyRouter;
