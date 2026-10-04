import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import ChartJobProgress from "./ChartJobProgress";
import { reasonKey } from "../logic/chartJobs";

/**
 * The entry page's side of AI karaoke charts (SearchBar): a pasted YouTube
 * link that no song is gets a card with the video and one clear button
 * (ChartOffer), and the chart being made gets a card with its progress, then
 * "Sing now" (ChartMaking). The party queue has its own compact versions
 * (QueueAddSong, QueuePanel); these are the roomier ones for the home page.
 */

const Thumb = ({ videoId, ai = false, dim = false }) => (
  <div className="relative w-28 sm:w-40 flex-shrink-0">
    {videoId
      ? <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" className={`w-full aspect-video rounded-lg object-cover ${dim ? 'opacity-70' : ''}`} />
      : <span className="block w-full aspect-video rounded-lg bg-surface-lighter" />}
    {ai && <AiBadge />}
  </div>
);

const AiBadge = () => {
  const { t } = useTranslation();
  return (
    <span
      title={t('chartJob.aiTitle')}
      className="absolute -top-1.5 -left-1.5 px-1.5 rounded text-[10px] font-black leading-4 text-white bg-neon-purple shadow-[0_0_10px_rgba(180,74,255,0.6)]"
    >
      {t('chartJob.ai')}
    </span>
  );
};

const Sparkles = ({ className = '' }) => (
  <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M10 2.5l1.9 5.6 5.6 1.9-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9z" />
    <path d="M18.5 13l.95 2.55L22 16.5l-2.55.95L18.5 20l-.95-2.55L15 16.5l2.55-.95z" opacity="0.8" />
  </svg>
);

/** While the pasted link is being looked up: the card's shape, waiting */
export const ChartLookup = () => {
  const { t } = useTranslation();
  return (
    <div className="mt-3 rounded-2xl border border-surface-lighter bg-surface-light/60 p-3 sm:p-4 flex gap-3 sm:gap-4 items-center" aria-busy="true">
      <span className="block w-28 sm:w-40 aspect-video rounded-lg bg-surface-lighter animate-pulse flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm text-gray-400">{t('search.lookingUp')}</p>
        <span className="block h-3 w-3/4 rounded bg-surface-lighter animate-pulse" />
      </div>
    </div>
  );
};

/**
 * A video no song is (kind 'none'), or one whose title found other songs
 * (kind 'title', listed in the grid below). offerKind is the backend's
 * switch (useChartOffer): 'offer' gets the button, 'signIn' a sign-in link,
 * anything else just the card.
 */
export const ChartOffer = ({ offer, offerKind, onGenerate, starting = false, error = null }) => {
  const { t } = useTranslation();
  const other = offer.kind === 'title';
  return (
    <div className="mt-3 rounded-2xl border border-surface-lighter bg-surface-light/80 p-3 sm:p-4 animate-slide-up">
      <div className="flex gap-3 sm:gap-4 items-center">
        <Thumb videoId={offer.videoId} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-bold text-neon-purple">
            {t(other ? 'search.generate.notThisOne' : 'search.generate.notYet')}
          </div>
          <div className="mt-0.5 text-white font-semibold leading-snug line-clamp-2 break-words">{offer.videoTitle}</div>
        </div>
      </div>
      {offerKind === 'offer' && (
        <>
          <button
            type="button"
            onClick={onGenerate}
            disabled={starting}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-neon-purple/50 to-neon-magenta/40 border border-neon-purple/70 shadow-[0_0_24px_rgba(180,74,255,0.25)] hover:from-neon-purple/65 hover:to-neon-magenta/55 hover:shadow-[0_0_30px_rgba(180,74,255,0.4)] disabled:opacity-60 cursor-pointer disabled:cursor-wait transition-all"
          >
            <Sparkles className={starting ? 'animate-pulse' : ''} />
            {starting ? t('search.generate.starting') : t('search.generate.cta')}
          </button>
          <p className="mt-2 text-xs text-gray-400 leading-snug">{t('search.generate.explain')}</p>
        </>
      )}
      {offerKind === 'signIn' && (
        <Link
          to={`/login?next=${encodeURIComponent('/')}`}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-neon-cyan border border-neon-cyan/50 hover:bg-neon-cyan/10 no-underline transition-colors"
        >
          <Sparkles />
          {t('search.generate.ctaSignIn')}
        </Link>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
};

/**
 * The chart this page started (chartJobTracker's entry): progress while it is
 * made, in an animated frame; "Sing now" when it is done; the reason when no
 * song came of it. onDismiss hides it (here and in the pill).
 */
export const ChartMaking = ({ tracked, job, onSingNow, onDismiss }) => {
  const { t } = useTranslation();
  const done = job?.status === 'done';
  const failed = job?.status === 'failed' || job?.status === 'rejected';
  const making = !done && !failed;
  const title = job?.title ?? tracked.videoTitle;

  const body = (
    <div className={`rounded-2xl p-3 sm:p-4 ${making ? 'bg-surface' : ''}`}>
      <div className="flex gap-3 sm:gap-4 items-center">
        <Thumb videoId={tracked.videoId} ai dim={failed} />
        <div className="flex-1 min-w-0">
          <div className={`text-[11px] uppercase tracking-wider font-bold ${done ? 'text-neon-green' : failed ? 'text-red-400' : 'text-neon-purple'}`}>
            {done ? t('search.generate.done') : failed ? t(`chartJob.reason.${reasonKey(job)}`) : t('search.generate.making')}
          </div>
          <div className="mt-0.5 text-white font-semibold leading-snug line-clamp-2 break-words">{title}</div>
          {job?.artist && <div className="text-sm text-gray-400 truncate">{job.artist}</div>}
        </div>
        {!making && (
          <button type="button" onClick={onDismiss} title={t('chartJob.pill.dismiss')} aria-label={t('chartJob.pill.dismiss')} className="self-start p-1 -m-1 text-gray-500 hover:text-gray-300 cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>
      {making && (
        <>
          <ChartJobProgress job={job} className="mt-3" />
          <p className="mt-2.5 flex items-start gap-2 text-xs text-gray-400 leading-snug">
            <Sparkles className="w-4 h-4 flex-shrink-0 text-neon-purple/80" />
            <span>{t('search.generate.keepGoing')}</span>
          </p>
        </>
      )}
      {done && (
        <button
          type="button"
          onClick={onSingNow}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-neon-cyan/40 to-neon-green/30 border border-neon-green/60 shadow-[0_0_24px_rgba(57,255,20,0.2)] hover:from-neon-cyan/55 hover:to-neon-green/45 cursor-pointer transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg>
          {t('chartJob.pill.singNow')}
        </button>
      )}
      {failed && <p className="mt-2 text-sm text-gray-400">{t(`search.generate.${reasonKey(job)}`)}</p>}
    </div>
  );

  // Being made: a slowly moving gradient frame says "working" without a spinner
  return making
    ? <div className="mt-3 rounded-2xl p-px gradient-border-animated animate-slide-up">{body}</div>
    : <div className={`mt-3 rounded-2xl border ${done ? 'border-neon-green/50 bg-neon-green/5' : 'border-red-400/40 bg-surface-light/60'} animate-slide-up`}>{body}</div>;
};
