import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { clearReadyNotice, usePartyChartState } from "../logic/partyChartJobs";

const R = 6;
const C = 2 * Math.PI * R;

/**
 * On the bar's queue pill: a ring for the songs of the queue still being
 * charted (how far the front one is), and a word for everyone when one is
 * ready. It follows the party's chart store by itself, so the memoised bar
 * does not re-render for it; it changes only when the server reports (every
 * few seconds), never per frame.
 */
const QueueChartBadge = () => {
  const { t } = useTranslation();
  const jobs = usePartyChartState(s => s.jobs);
  const ready = usePartyChartState(s => s.ready);
  const waiting = Object.values(jobs).filter(j => !['done', 'failed', 'rejected'].includes(j.status));

  useEffect(() => {
    if (!ready) return undefined;
    const id = setTimeout(clearReadyNotice, 7000);
    return () => clearTimeout(id);
  }, [ready]);

  const front = waiting[0];
  const fraction = Math.min(1, Math.max(0.05, Number(front?.progress?.fraction) || 0.05));
  return (
    <>
      {waiting.length > 0 && (
        <span className="flex items-center" title={t('queue.pendingCount', { count: waiting.length })}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="-rotate-90">
            <circle cx="8" cy="8" r={R} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" className="text-neon-purple" />
            <circle
              cx="8" cy="8" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
              stroke="currentColor" className="text-neon-purple transition-[stroke-dashoffset] duration-1000"
              strokeDasharray={C} strokeDashoffset={C * (1 - fraction)}
            />
          </svg>
          <span className="sr-only">{t('queue.pendingCount', { count: waiting.length })}</span>
        </span>
      )}
      {ready && (
        <span
          role="status"
          className="absolute right-0 top-full mt-2 w-60 max-w-[80vw] px-3 py-2 rounded-lg bg-surface-light border border-neon-green/60 text-left text-xs font-normal text-white shadow-[0_8px_30px_rgba(0,0,0,0.5)] animate-slide-up pointer-events-none"
        >
          <span className="text-neon-green font-semibold">{t('chartJob.stage.done')}</span>
          <span className="block line-clamp-2">{t('queue.readyToast', { title: ready.title })}</span>
        </span>
      )}
    </>
  );
};

export default QueueChartBadge;
