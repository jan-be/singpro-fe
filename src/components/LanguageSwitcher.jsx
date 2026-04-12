import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supportedLanguages, languageNames } from "../i18n/i18n";

/**
 * Compact language switcher dropdown.
 * On selection: saves preference to localStorage, updates i18next, navigates
 * to the same page under the new /{lang}/ prefix.
 */
const LanguageSwitcher = () => {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useParams();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentLang = lang || i18n.language || "en";

  const switchTo = (newLang) => {
    setOpen(false);
    if (newLang === currentLang) return;

    // Save to localStorage so detection picks it up next time
    localStorage.setItem("singpro-lang", newLang);
    i18n.changeLanguage(newLang);

    // Replace /{oldLang}/ with /{newLang}/ in the current path
    const rest = location.pathname.replace(/^\/[^/]+/, "");
    navigate(`/${newLang}${rest}${location.search}${location.hash}`, { replace: true });
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-gray-400 hover:text-neon-cyan transition-colors text-sm cursor-pointer"
        aria-label="Change language"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        {languageNames[currentLang] || currentLang}
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-surface-light border border-surface-lighter rounded-lg shadow-xl py-1 z-50 max-h-80 overflow-y-auto min-w-[160px]">
          {supportedLanguages.map((sl) => (
            <button
              key={sl}
              onClick={() => switchTo(sl)}
              className={`w-full text-left px-4 py-1.5 text-sm transition-colors cursor-pointer ${
                sl === currentLang
                  ? "text-neon-cyan bg-neon-cyan/10"
                  : "text-gray-300 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              {languageNames[sl] || sl}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;
