import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import WrapperPage from "./WrapperPage";
import { useLangPath } from "../GlobalConsts";

const NotFoundPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lp = useLangPath();

  useEffect(() => { document.title = 'Page Not Found | singpro.app'; }, []);

  return (
    <WrapperPage>
      <div className="text-center py-20">
        <div className="text-6xl mb-4">:(</div>
        <h1 className="text-2xl font-bold text-white mb-2">{t('notFound.title')}</h1>
        <p className="text-gray-400 mb-6">{t('notFound.description')}</p>
        <button
          onClick={() => navigate(lp('/'))}
          className="px-6 py-2 rounded-lg bg-surface-light border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 transition-all cursor-pointer"
        >
          {t('notFound.goHome')}
        </button>
      </div>
    </WrapperPage>
  );
};

export default NotFoundPage;
