import { Link } from "react-router-dom";
import React from "react";
import { useTranslation } from "react-i18next";
import { useLangPath } from "../GlobalConsts";
import LanguageSwitcher from "./LanguageSwitcher";

const Footer = () => {
  const { t } = useTranslation();
  const lp = useLangPath();

  return (
    <footer className="mt-auto py-6 px-4 bg-surface border-t border-surface-lighter">
      <div className="max-w-xl mx-auto flex flex-col items-center gap-3">
        <div className="flex justify-center gap-6 text-sm">
          <Link to={lp('/privacy-policy')} className="text-gray-400 hover:text-neon-cyan transition-colors">
            {t('footer.privacyPolicy')}
          </Link>
          <Link to={lp('/tos')} className="text-gray-400 hover:text-neon-cyan transition-colors">
            {t('footer.termsOfService')}
          </Link>
          <Link to={lp('/contact')} className="text-gray-400 hover:text-neon-cyan transition-colors">
            {t('footer.contact')}
          </Link>
        </div>
        <LanguageSwitcher />
      </div>
    </footer>
  );
};

export default Footer;
