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

// The card the three states share: a solid violet panel, like the front page's
const CARD = 'mt-3 rounded-2xl bg-panel border p-3 sm:p-4';

const Thumb = ({ videoId, ai = false, dim = false }) => (
  <div className="relative w-28 sm:w-40 flex-shrink-0">
    {videoId
      ? <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" className={`w-full aspect-video rounded-xl object-cover ring-1 ring-white/10 ${dim ? 'opacity-60' : ''}`} />
      : <span className="block w-full aspect-video rounded-xl bg-white/[0.06]" />}
    {ai && <AiBadge />}
  </div>
);

const AiBadge = () => {
  const { t } = useTranslation();
  return (
    <span
      title={t('chartJob.aiTitle')}
      className="absolute -top-1.5 -left-1.5 px-1.5 rounded-md text-[10px] font-bold leading-4 tracking-wide text-white bg-neon-purple"
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
    <div className={`${CARD} border-white/10 flex gap-3 sm:gap-4 items-center`} aria-busy="true">
      <span className="block w-28 sm:w-40 aspect-video rounded-xl bg-white/[0.06] animate-pulse flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2.5">
        <p className="text-sm text-white/55">{t('search.lookingUp')}</p>
        <span className="block h-3 w-3/4 rounded-full bg-white/[0.06] animate-pulse" />
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
    <div className={`${CARD} border-white/10 animate-slide-up`}>
      <div className="flex gap-3 sm:gap-4 items-center">
        <Thumb videoId={offer.videoId} />
        <div className="flex-1 min-w-0">
          <div className="pop-label">
            {t(other ? 'search.generate.notThisOne' : 'search.generate.notYet')}
          </div>
          <div className="mt-1 text-white font-semibold leading-snug tracking-[-0.01em] line-clamp-2 break-words">{offer.videoTitle}</div>
        </div>
      </div>
      {offerKind === 'offer' && (
        <>
          <button
            type="button"
            onClick={onGenerate}
            disabled={starting}
            className="btn btn-primary mt-4 w-full sm:w-auto sm:px-6 h-auto min-h-10 py-2 whitespace-normal text-center leading-snug disabled:cursor-wait"
          >
            <Sparkles className={`flex-shrink-0 ${starting ? 'animate-pulse' : ''}`} />
            {starting ? t('search.generate.starting') : t('search.generate.cta')}
          </button>
          <p className="mt-2.5 text-xs text-white/55 leading-snug">{t('search.generate.explain')}</p>
        </>
      )}
      {offerKind === 'signIn' && (
        <Link
          to={`/login?next=${encodeURIComponent('/')}`}
          className="btn btn-ghost mt-4 w-full sm:w-auto sm:px-6 h-auto min-h-10 py-2 whitespace-normal text-center leading-snug no-underline"
        >
          <Sparkles className="flex-shrink-0" />
          {t('search.generate.ctaSignIn')}
        </Link>
      )}
      {error && <p role="alert" className="mt-2.5 text-sm text-red-400">{error}</p>}
    </div>
  );
};

/**
 * The chart this page started (chartJobTracker's entry): progress while it is
 * made; "Sing now" when it is done; the reason when no song came of it.
 * onDismiss hides it (here and in the pill).
 */
export const ChartMaking = ({ tracked, job, onSingNow, onDismiss }) => {
  const { t } = useTranslation();
  const done = job?.status === 'done';
  const failed = job?.status === 'failed' || job?.status === 'rejected';
  const making = !done && !failed;
  const title = job?.title ?? tracked.videoTitle;

  return (
    <div className={`${CARD} ${done ? 'border-neon-green/30' : failed ? 'border-red-400/30' : 'border-white/10'} animate-slide-up`}>
      <div className="flex gap-3 sm:gap-4 items-center">
        <Thumb videoId={tracked.videoId} ai dim={failed} />
        <div className="flex-1 min-w-0">
          <div className={`pop-label ${done ? 'text-neon-green' : failed ? 'text-red-300' : 'text-[#d9a8ff]'}`}>
            {done ? t('search.generate.done') : failed ? t(`chartJob.reason.${reasonKey(job)}`) : t('search.generate.making')}
          </div>
          <div className="mt-1 text-white font-semibold leading-snug tracking-[-0.01em] line-clamp-2 break-words">{title}</div>
          {job?.artist && <div className="text-sm text-white/55 truncate">{job.artist}</div>}
        </div>
        {!making && (
          <button type="button" onClick={onDismiss} title={t('chartJob.pill.dismiss')} aria-label={t('chartJob.pill.dismiss')} className="btn-icon w-8 h-8 -mt-1 -mr-1 self-start text-white/50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>
      {making && (
        <>
          <ChartJobProgress job={job} className="mt-4" />
          <p className="mt-3 flex items-start gap-2 text-xs text-white/55 leading-snug">
            <Sparkles className="w-4 h-4 flex-shrink-0 text-[#d9a8ff]" />
            <span>{t('search.generate.keepGoing')}</span>
          </p>
        </>
      )}
      {done && (
        <button
          type="button"
          onClick={onSingNow}
          className="btn btn-primary mt-4 w-full sm:w-auto sm:px-6"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg>
          {t('chartJob.pill.singNow')}
        </button>
      )}
      {failed && <p className="mt-3 text-sm text-white/55 leading-snug">{t(`search.generate.${reasonKey(job)}`)}</p>}
    </div>
  );
};
