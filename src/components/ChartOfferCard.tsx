import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import ChartJobProgress from "./ChartJobProgress";
import AiBadge from "./AiBadge";
import { PopOutIcon, SparklesIcon as Sparkles } from "./Icons";
import { reasonKey, searchYouTube, type ChartJob, type ChartOffer as OfferWord, type YouTubeResult } from "../logic/chartJobs";
import { thrownField } from "../logic/authApi";

/** What the viewer is offered for a video no song is (useChartOffer): 'offer', 'signIn', or null for nothing */
export type ChartOfferKind = OfferWord | null;

/** A pasted video no song is (kind 'none'), or one whose title found other songs (kind 'title') */
export interface VideoOffer {
  videoId: string;
  videoTitle: string;
  kind: 'none' | 'title';
}

export interface ChartHintProps {
  query: string;
  offerKind: ChartOfferKind;
  onMake?: (videoId: string, title: string) => void;
}

export interface ChartOfferProps {
  offer: VideoOffer;
  offerKind: ChartOfferKind;
  onGenerate: () => void;
  starting?: boolean;
  error?: string | null;
}

export interface ChartMakingProps {
  /** the tracker's entry (logic/chartJobTracker.ts): the video asked for */
  tracked: { videoId?: string | null; videoTitle?: string | null };
  job: ChartJob | null;
  onSingNow: () => void;
  onDismiss: () => void;
}

/**
 * The entry page's side of AI karaoke charts (SearchBar): a pasted YouTube
 * link that no song is gets a card with the video and one clear button
 * (ChartOffer), and the chart being made gets a card with its progress, then
 * "Sing now" (ChartMaking). The party queue has its own compact versions
 * (QueueAddSong, QueuePanel); these are the roomier ones for the home page.
 */

// The card the three states share: a solid violet panel, like the front page's
const CARD = 'mt-3 rounded-2xl bg-panel border p-3 sm:p-4';

const Thumb = ({ videoId, ai = false, dim = false }: { videoId?: string | null; ai?: boolean; dim?: boolean }) => (
  <div className="relative w-28 sm:w-40 flex-shrink-0">
    {videoId
      ? <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" className={`w-full aspect-video rounded-xl object-cover ring-1 ring-white/10 ${dim ? 'opacity-60' : ''}`} />
      : <span className="block w-full aspect-video rounded-xl bg-white/[0.06]" />}
    {ai && <AiBadge look="md" />}
  </div>
);

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Above the results when nothing found answers the search well (the
 * backend's `match`, songs/browse): a song that is not here can be made from
 * its YouTube video. "Find it on YouTube" asks YouTube right here (the
 * backend's search, GET /chart-jobs/youtube) and lists the videos that could
 * become charts, each with its button: make it (onMake(videoId, title): the
 * search bar starts it and shows its progress), sign in first, or sing it
 * when it is a song here already. youtube.com is only the way out when the
 * search fails. `offerKind` as in ChartOffer.
 */
export const ChartHint = ({ query, offerKind, onMake }: ChartHintProps) => {
  const { t } = useTranslation();
  // { q, state: 'loading' | 'done' | 'error', results, error }: what was found for which search
  const [found, setFound] = useState<{ q: string; state: 'loading' | 'done' | 'error'; results: YouTubeResult[]; error?: string } | null>(null);
  useEffect(() => { setFound(null); }, [query]);
  const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const search = async () => {
    setFound({ q: query, state: 'loading', results: [] });
    try {
      const results = await searchYouTube(query);
      setFound(f => (f?.q === query ? { q: query, state: 'done', results } : f));
    } catch (e) {
      const code = thrownField(e, 'code'); // (a failed call's ApiError, chartJobs.ts)
      setFound(f => (f?.q === query ? { q: query, state: 'error', results: [], error: typeof code === 'string' ? code : undefined } : f));
    }
  };
  const openYouTube = (
    <a href={youtube} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4 decoration-white/25 hover:text-white">
      {t('search.hint.openYoutube')}<PopOutIcon size={12} />
    </a>
  );
  return (
    <div className="mb-4 rounded-2xl bg-panel border border-white/10 p-3 sm:p-4 animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-3 items-start sm:items-center flex-1 min-w-0">
          <span className="flex-shrink-0 grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-[#ff4fd8] to-[#8b5cf6] text-white" aria-hidden="true">
            <Sparkles />
          </span>
          <div className="min-w-0">
            <div className="text-white font-semibold leading-snug">{t('search.hint.title')}</div>
            <p className="mt-0.5 text-sm text-white/60 leading-snug">{t(offerKind === 'signIn' ? 'search.hint.textSignIn' : 'search.hint.text')}</p>
          </div>
        </div>
        {!found && (
          <button type="button" onClick={search} className="btn btn-sm btn-ghost flex-shrink-0 self-start sm:self-auto">
            {t('search.hint.youtube')}
          </button>
        )}
      </div>
      {found && (
        <ul className="mt-3 divide-y divide-white/[0.06]" aria-busy={found.state === 'loading'}>
          {found.state === 'loading' && [0, 1, 2].map(i => (
            <li key={i} className="flex items-center gap-3 py-2" aria-hidden="true">
              <span className="block w-24 sm:w-28 aspect-video rounded-lg bg-white/[0.06] animate-pulse flex-shrink-0" />
              <span className="block h-3 w-1/2 rounded-full bg-white/[0.06] animate-pulse" />
            </li>
          ))}
          {found.results.map(r => (
            <li key={r.videoId} className="flex items-center gap-3 py-2">
              <img src={`https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`} alt="" loading="lazy" className="w-24 sm:w-28 aspect-video rounded-lg object-cover flex-shrink-0 ring-1 ring-white/10" />
              {/* phones: the button under the name; wider screens: beside it */}
              <div className="flex-1 min-w-0 sm:flex sm:items-center sm:gap-3">
                <div className="min-w-0 sm:flex-1">
                  <div className="text-sm text-white font-medium leading-snug line-clamp-2 break-words">{r.title}</div>
                  <div className="mt-0.5 text-xs text-white/50 truncate">{[r.channel, r.duration ? mmss(r.duration) : null].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="mt-1.5 sm:mt-0 flex-shrink-0">
                  {r.songId ? (
                    <Link to={`/sing/${r.songId}`} className="btn btn-sm btn-ghost no-underline">{t('search.hint.sing')}</Link>
                  ) : offerKind === 'offer' ? (
                    <button type="button" onClick={() => onMake?.(r.videoId, r.title)} className="btn btn-sm btn-primary">
                      <Sparkles className="w-4 h-4 flex-shrink-0" />
                      {t('search.hint.make')}
                    </button>
                  ) : (
                    <Link to={`/login?next=${encodeURIComponent('/')}`} className="btn btn-sm btn-ghost no-underline">{t('search.hint.signIn')}</Link>
                  )}
                </div>
              </div>
            </li>
          ))}
          {found.state === 'done' && !found.results.length && (
            <li className="py-2 text-sm text-white/55">{t('search.hint.none')} {openYouTube}</li>
          )}
          {found.state === 'error' && (
            <li role="alert" className="py-2 text-sm text-white/55">
              {t(found.error === 'rate_limited' ? 'search.hint.tooMany' : 'search.hint.failed')} {openYouTube}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

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
export const ChartOffer = ({ offer, offerKind, onGenerate, starting = false, error = null }: ChartOfferProps) => {
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
            className="btn btn-primary mt-4 w-full sm:w-auto sm:px-6 h-auto min-h-10 py-2 whitespace-normal text-center leading-snug disabled:cursor-default"
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
export const ChartMaking = ({ tracked, job, onSingNow, onDismiss }: ChartMakingProps) => {
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
