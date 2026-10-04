import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import WrapperPage from "./WrapperPage";

const NotFoundPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'Page Not Found | singpro.app'; }, []);

  return (
    <WrapperPage>
      <div className="text-center py-12 sm:py-20 max-w-md mx-auto">
        <div className="mx-auto mb-6 w-20 h-20 rounded-full bg-panel border border-white/10 grid place-items-center text-3xl font-semibold text-white/60" aria-hidden="true">:(</div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white mb-3 text-balance">{t('notFound.title')}</h1>
        <p className="text-white/55 leading-relaxed mb-8 text-pretty">{t('notFound.description')}</p>
        <button
          onClick={() => navigate('/')}
          className="btn btn-primary btn-lg"
        >
          {t('notFound.goHome')}
        </button>
      </div>
    </WrapperPage>
  );
};

export default NotFoundPage;
