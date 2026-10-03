import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { reportSong } from "../logic/authApi";

/** What can be wrong with a song (backend songReports.js REPORT_KINDS), in the order shown */
export const REPORT_KINDS = ['timing', 'lyrics', 'pitch', 'video', 'unavailable', 'other'];
const MAX_COMMENT = 500;

/**
 * "Report a problem" for the song that is playing: tick what is wrong, add a
 * note if you like, send. The admins review it (AdminPage). `getContext`
 * returns what this device knows at that moment (gap, song time, singing
 * delay, nickname, party, session) and goes along with the report.
 */
const ReportSongDialog = ({ songId, isOpen, onClose, getContext }) => {
  const { t } = useTranslation();
  const [kinds, setKinds] = useState([]);
  const [comment, setComment] = useState('');
  const [state, setState] = useState(null); // null | 'sending' | 'done' | 'failed' | 'limited'

  useEffect(() => {
    if (!isOpen) return;
    setKinds([]); setComment(''); setState(null);
  }, [isOpen, songId]);

  if (!isOpen) return null;

  const toggle = (k) => setKinds(ks => (ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k]));

  const send = async () => {
    if (!kinds.length || state === 'sending') return;
    setState('sending');
    try {
      const { nickname, partyId, sessionId, ...context } = getContext?.() ?? {};
      await reportSong(songId, { kinds, comment: comment.trim() || undefined, context, nickname, partyId, sessionId });
      setState('done');
      setTimeout(onClose, 1500);
    } catch (e) {
      setState(e?.code === 'rate_limited' ? 'limited' : 'failed');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-light border border-surface-lighter rounded-lg shadow-2xl p-5 w-[340px] max-w-[92vw]"
      >
        <div id="report-title" className="text-white font-semibold mb-1">{t('report.title')}</div>
        <div className="text-gray-400 text-xs mb-3">{t('report.hint')}</div>

        {state === 'done' ? (
          <div className="py-6 text-center text-neon-green font-semibold">{t('report.thanks')}</div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5" role="group" aria-label={t('report.title')}>
              {REPORT_KINDS.map(k => (
                <label
                  key={k}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded border text-sm cursor-pointer transition-colors ${
                    kinds.includes(k) ? 'border-neon-cyan/60 bg-neon-cyan/10 text-white' : 'border-surface-lighter text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} className="accent-neon-cyan" />
                  {t(`report.kinds.${k}`)}
                </label>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
              placeholder={t('report.commentPlaceholder')}
              rows={3}
              className="mt-3 w-full px-3 py-2 rounded bg-surface border border-surface-lighter text-white text-sm placeholder-gray-500 focus:outline-none focus:border-neon-cyan resize-none"
            />
            {state === 'failed' && <div className="mt-1 text-[11px] text-red-400">{t('report.failed')}</div>}
            {state === 'limited' && <div className="mt-1 text-[11px] text-red-400">{t('report.limited')}</div>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm rounded border border-surface-lighter text-gray-300 hover:text-white hover:border-gray-500 transition-colors cursor-pointer"
              >
                {t('report.cancel')}
              </button>
              <button
                type="button"
                onClick={send}
                disabled={!kinds.length || state === 'sending'}
                className="flex-1 px-4 py-2 text-sm rounded border font-semibold transition-colors bg-neon-cyan/15 border-neon-cyan/60 text-neon-cyan hover:bg-neon-cyan/25 cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                {state === 'sending' ? t('report.sending') : t('report.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default ReportSongDialog;
