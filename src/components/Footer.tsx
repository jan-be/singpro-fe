import { Link } from "react-router-dom";
import React from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./LanguageSwitcher";
import SocialLinks from "./SocialLinks";

const Footer = () => {
  const { t } = useTranslation();

  return (
    <footer className="mt-auto py-6 px-4 border-t border-white/[0.06] bg-ink/60">
      <div className="max-w-xl mx-auto flex flex-col items-center gap-3">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm">
          <Link to="/privacy-policy" className="text-white/50 hover:text-white transition-colors">
            {t('footer.privacyPolicy')}
          </Link>
          <Link to="/tos" className="text-white/50 hover:text-white transition-colors">
            {t('footer.termsOfService')}
          </Link>
          <Link to="/contact" className="text-white/50 hover:text-white transition-colors">
            {t('footer.contact')}
          </Link>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <SocialLinks />
          <span className="w-px h-4 bg-white/15" aria-hidden="true" />
          <LanguageSwitcher />
        </div>
      </div>
    </footer>
  );
};

export default Footer;
