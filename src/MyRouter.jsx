import { BrowserRouter as Router, Route, Routes, Navigate, useParams, useLocation } from "react-router-dom";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supportedLanguages } from "./i18n/i18n";
import ContactPage from "./pages/compliance/ContactPage";
import PrivacyPolicyPage from "./pages/compliance/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/compliance/TermsOfServicePage";
import PartyPage from "./pages/PartyPage";
import EntryPage from "./pages/EntryPage";
import JoinPage from "./pages/JoinPage";
import NotFoundPage from "./pages/NotFoundPage";

// Non-English languages that get a /{lang}/ prefix
const prefixedLanguages = supportedLanguages.filter(l => l !== 'en');

/**
 * Syncs the i18next language with the URL :lang param.
 * Also sets the <html lang> attribute.
 */
const LanguageSync = ({ children, forceLang }) => {
  const { lang } = useParams();
  const { i18n } = useTranslation();
  const effectiveLang = forceLang || lang || 'en';

  useEffect(() => {
    if (effectiveLang !== i18n.language) {
      i18n.changeLanguage(effectiveLang);
    }
    document.documentElement.lang = effectiveLang;
  }, [effectiveLang, i18n]);

  return children;
};

/**
 * /en/... → redirect to /... (strip the /en prefix)
 */
const EnRedirect = () => {
  const location = useLocation();
  const rest = location.pathname.replace(/^\/en\/?/, '/');
  return <Navigate to={`${rest}${location.search}${location.hash}`} replace />;
};

/**
 * Validates that :lang is a supported non-English language.
 * If not → 404.
 * If valid → renders children with LanguageSync.
 */
const LangGuard = ({ children }) => {
  const { lang } = useParams();

  if (!prefixedLanguages.includes(lang)) {
    return <NotFoundPage />;
  }

  return <LanguageSync>{children}</LanguageSync>;
};

// Legacy /mic/:partyId/:username route — redirect to join page
const MicRedirect = () => {
  const { lang, partyId } = useParams();
  if (lang) {
    return <Navigate to={`/${lang}/join/${partyId}`} replace />;
  }
  return <Navigate to={`/join/${partyId}`} replace />;
};

// Redirect old slug URLs: /sing/:slug/:songId → /sing/:songId
const SlugRedirect = () => {
  const { lang, songId } = useParams();
  const location = useLocation();
  const base = lang ? `/${lang}/sing/${songId}` : `/sing/${songId}`;
  return <Navigate to={`${base}${location.search}${location.hash}`} replace />;
};

const MyRouter = () =>
  <Router>
    <Routes>
      {/* === /en/... → redirect to bare /... === */}
      <Route path="/en/*" element={<EnRedirect />} />
      <Route path="/en" element={<EnRedirect />} />

      {/* === Non-English localized routes: /:lang/... === */}
      <Route path="/:lang/contact" element={<LangGuard><ContactPage /></LangGuard>} />
      <Route path="/:lang/privacy-policy" element={<LangGuard><PrivacyPolicyPage /></LangGuard>} />
      <Route path="/:lang/tos" element={<LangGuard><TermsOfServicePage /></LangGuard>} />
      <Route path="/:lang/join/:partyId" element={<LangGuard><JoinPage /></LangGuard>} />
      <Route path="/:lang/mic/:partyId/:username" element={<MicRedirect />} />
      <Route path="/:lang/sing/:slug/:songId" element={<SlugRedirect />} />
      <Route path="/:lang/sing/:songId" element={<LangGuard><PartyPage /></LangGuard>} />
      <Route path="/:lang" element={<LangGuard><EntryPage /></LangGuard>} />

      {/* === English (default) routes: bare /... === */}
      <Route path="/contact" element={<LanguageSync forceLang="en"><ContactPage /></LanguageSync>} />
      <Route path="/privacy-policy" element={<LanguageSync forceLang="en"><PrivacyPolicyPage /></LanguageSync>} />
      <Route path="/tos" element={<LanguageSync forceLang="en"><TermsOfServicePage /></LanguageSync>} />
      <Route path="/join/:partyId" element={<LanguageSync forceLang="en"><JoinPage /></LanguageSync>} />
      <Route path="/mic/:partyId/:username" element={<MicRedirect />} />
      <Route path="/sing/:slug/:songId" element={<SlugRedirect />} />
      <Route path="/sing/:songId" element={<LanguageSync forceLang="en"><PartyPage /></LanguageSync>} />
      <Route path="/" element={<LanguageSync forceLang="en"><EntryPage /></LanguageSync>} />

      {/* Catch-all: 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </Router>
;

export default MyRouter;
