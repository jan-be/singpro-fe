import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { etaWords, progressAt, reasonKey, stageKey } from "../logic/chartJobs";

/**
 * A chart being made: what it is doing now, the time left and a bar. Between
 * the server's reports (every few seconds) the bar and the time move on by
 * themselves, from `job.receivedAt` (Date.now() when this copy came), once a
 * second; the bar slides with a CSS transform, so this is one small render a
 * second while it is on screen, and none once the job is finished.
 *
 * job: a chart job as the backend shows it (status, progress, error) + receivedAt
 * compact: one line of text (the queue pill), else label and time on their own line
 */
const ChartJobProgress = ({ job, compact = false, className = '' }) => {
  const { t } = useTranslation();
  const mountedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const shown = useRef({ id: null, fraction: 0 });
  const finished = !job || ['done', 'failed', 'rejected'].includes(job.status);

  useEffect(() => {
    if (finished) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [finished]);

  if (!job) return null;
  if (job.status === 'failed' || job.status === 'rejected') {
    return <div className={`text-xs text-red-400 ${className}`}>{t(`chartJob.reason.${reasonKey(job)}`)}</div>;
  }

  const { fraction: f, eta } = progressAt(job, now - (job.receivedAt ?? mountedAt.current));
  // never backwards (a later estimate may be longer than the last one)
  if (shown.current.id !== job.id) shown.current = { id: job.id, fraction: 0 };
  const fraction = Math.max(shown.current.fraction, f);
  shown.current.fraction = fraction;

  const stage = stageKey(job);
  const words = job.status === 'done' ? null : etaWords(eta);
  const position = job.status === 'queued' && job.progress?.position >= 1 ? job.progress.position : null;
  const label = (
    <>
      {t(`chartJob.stage.${stage}`)}
      {position && <span className="text-gray-400 whitespace-nowrap"> · {t('chartJob.position', { count: position })}</span>}
    </>
  );
  const time = words && <span className="text-gray-400 whitespace-nowrap">{t(`chartJob.eta.${words.key}`, { count: words.count })}</span>;
  const done = job.status === 'done';

  return (
    <div className={className}>
      <div className={`flex flex-wrap items-baseline justify-between gap-x-2 text-xs ${done ? 'text-neon-green' : 'text-gray-200'}`}>
        <span className="min-w-0" aria-live="polite">{label}</span>
        {!compact && time}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-label={t(`chartJob.stage.${stage}`)}
        className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"
      >
        <div
          className={`h-full w-full origin-left rounded-full transition-transform duration-1000 ease-linear ${
            done ? 'bg-neon-green' : job.status === 'queued' ? 'bg-white/25 animate-pulse' : 'bg-gradient-to-r from-neon-cyan to-neon-magenta'
          }`}
          style={{ transform: `scaleX(${job.status === 'queued' ? 0.04 : Math.max(0.03, fraction)})` }}
        />
      </div>
      {compact && time && <div className="mt-0.5 text-[11px]">{time}</div>}
    </div>
  );
};

export default ChartJobProgress;
