import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reportAvatar } from '../logic/authApi';

/**
 * "Report picture": tells the admins that someone's profile picture should
 * not be there (backend avatarReports.js). Anyone may, guests too. A first
 * click asks, the second sends; then it thanks you and stays done. `path` is
 * the picture as the server gave it; `where` { place, partyId?, nickname? }
 * goes along so the admins know where it was seen.
 */
const ReportPicture = ({ path, where, className = '' }) => {
  const { t } = useTranslation();
  const [state, setState] = useState(null); // null | 'asking' | 'sending' | 'done' | 'failed' | 'limited' | 'gone'
  useEffect(() => { setState(null); }, [path]);

  const send = async () => {
    setState('sending');
    try {
      await reportAvatar(path, where);
      setState('done');
    } catch (e) {
      setState(e?.code === 'rate_limited' ? 'limited' : e?.code === 'no_avatar' ? 'gone' : 'failed');
    }
  };

  if (state === 'done' || state === 'gone') {
    return <p className={`text-xs text-white/60 ${className}`} role="status">{state === 'done' ? t('avatar.reported') : t('avatar.reportGone')}</p>;
  }
  if (state === null) {
    return (
      <button type="button" onClick={() => setState('asking')} className={`text-xs text-white/45 hover:text-white underline-offset-2 hover:underline ${className}`}>
        {t('avatar.report')}
      </button>
    );
  }
  return (
    <div className={`text-xs ${className}`} role="group" aria-label={t('avatar.report')}>
      <p className="text-white/70">{t('avatar.reportConfirm')}</p>
      {state === 'failed' && <p className="mt-1 text-[#ff8a97]" role="alert">{t('avatar.reportFailed')}</p>}
      {state === 'limited' && <p className="mt-1 text-[#ff8a97]" role="alert">{t('avatar.reportLimited')}</p>}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={send} disabled={state === 'sending'} className="btn btn-sm btn-stop">{t('avatar.reportSend')}</button>
        <button type="button" onClick={() => setState(null)} disabled={state === 'sending'} className="btn btn-sm btn-ghost">{t('avatar.cancel')}</button>
      </div>
    </div>
  );
};

export default ReportPicture;
