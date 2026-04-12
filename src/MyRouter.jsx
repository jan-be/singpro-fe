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

// Legacy /mic/:partyId/:username route — redirect to join page
const MicRedirect = () => {
  const { lang, partyId } = useParams();
  return <Navigate to={`/${lang}/join/${partyId}`} replace />;
};

/**
 * Syncs the i18next language with the URL :lang param.
 * Also sets the <html lang> attribute.
 */
const LanguageSync = ({ children }) => {
  const { lang } = useParams();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (lang && lang !== i18n.language) {
      i18n.changeLanguage(lang);
    }
    document.documentElement.lang = lang || 'en';
  }, [lang, i18n]);

  return children;
};

/**
 * Redirects bare URLs (no lang prefix) to /{detectedLang}/...
 * e.g. /sing/foo/123 → /en/sing/foo/123
 */
const LangRedirect = () => {
  const { i18n } = useTranslation();
  const location = useLocation();

  // Use the current i18n language (detected from localStorage or navigator)
  const lang = supportedLanguages.includes(i18n.language)
    ? i18n.language
    : 'en';

  const target = `/${lang}${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
};

/**
 * Catches /{invalidLang}/... and redirects to /en/...
 */
const InvalidLangRedirect = () => {
  const { lang } = useParams();
  const { i18n } = useTranslation();
  const location = useLocation();

  // If lang param is not a supported language, redirect
  if (!supportedLanguages.includes(lang)) {
    const bestLang = supportedLanguages.includes(i18n.language) ? i18n.language : 'en';
    // The rest of the path after /:lang
    const rest = location.pathname.replace(/^\/[^/]+/, '');
    return <Navigate to={`/${bestLang}${rest}${location.search}${location.hash}`} replace />;
  }

  return <LanguageSync><NotFoundPage /></LanguageSync>;
};

const MyRouter = () =>
  <Router>
    <Routes>
        {/* === Localized routes under /:lang/ === */}
        <Route path="/:lang/contact" element={<LanguageSync><ContactPage /></LanguageSync>} />
        <Route path="/:lang/privacy-policy" element={<LanguageSync><PrivacyPolicyPage /></LanguageSync>} />
        <Route path="/:lang/tos" element={<LanguageSync><TermsOfServicePage /></LanguageSync>} />
        <Route path="/:lang/join/:partyId" element={<LanguageSync><JoinPage /></LanguageSync>} />
        <Route path="/:lang/mic/:partyId/:username" element={<MicRedirect />} />
        <Route path="/:lang/sing/:songId" element={<LanguageSync><PartyPage /></LanguageSync>} />
        <Route path="/:lang/sing/:slug/:songId" element={<LanguageSync><PartyPage /></LanguageSync>} />
        <Route path="/:lang" element={<LanguageSync><EntryPage /></LanguageSync>} />

        {/* === Bare routes (no lang prefix) — redirect to /{lang}/... === */}
        <Route path="/contact" element={<LangRedirect />} />
        <Route path="/privacy-policy" element={<LangRedirect />} />
        <Route path="/tos" element={<LangRedirect />} />
        <Route path="/join/:partyId" element={<LangRedirect />} />
        <Route path="/mic/:partyId/:username" element={<LangRedirect />} />
        <Route path="/sing/:songId" element={<LangRedirect />} />
        <Route path="/sing/:slug/:songId" element={<LangRedirect />} />
        <Route path="/" element={<LangRedirect />} />

        {/* Catch-all: if /:lang is invalid, redirect; otherwise 404 */}
        <Route path="/:lang/*" element={<InvalidLangRedirect />} />
      <Route path="*" element={<LangRedirect />} />
    </Routes>
  </Router>
;

export default MyRouter;
