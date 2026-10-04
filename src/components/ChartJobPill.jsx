import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { forget, useTrackedChartJobs } from "../logic/chartJobTracker";
import { addJobToParty, usePartyChartState } from "../logic/partyChartJobs";
import { trackPick } from "../logic/track";
import ChartJobProgress from "./ChartJobProgress";

const MAX_SHOWN = 2;

/**
 * The charts this browser asked for on the home page, on every page until
 * they are sung, queued or dismissed (chartJobTracker.js): the progress while
 * they are made, then "Sing now" — or, in a party, "Add to queue", which can
 * be done before the chart is ready too: the queue then shows the progress
 * for everyone and plays the song once it is ready.
 *
 * On the party page it sits under the bar on the left, clear of the queue
 * drawer and the lyrics; elsewhere at the bottom of the screen. Solid tints,
 * no backdrop blur: on the party page it floats over the playing video.
 */
const ChartJobPill = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { entries, focused } = useTrackedChartJobs();
  const canAdd = usePartyChartState(s => s.canAdd && s.maxPending > 0);
  const inParty = pathname.startsWith('/sing/');
  const shown = entries.filter(e => e.id !== focused);
  if (!shown.length || pathname.startsWith('/admin')) return null;

  const singNow = (e) => {
    forget(e.id);
    trackPick('youtube-url', { songId: e.job.songId });
    navigate(`/sing/${e.job.songId}`);
  };
  const addToQueue = (e) => {
    if (addJobToParty(e.id, e.job?.title ?? e.videoTitle)) forget(e.id);
  };

  return (
    <div
      className={`fixed flex flex-col gap-2 pointer-events-none ${
        // party page: under the bar, below its popovers and the queue drawer; elsewhere above the home page's footer bar
        inParty ? 'z-30 top-14 left-3 w-72 max-w-[calc(100%-1.5rem)]' : 'z-50 bottom-12 left-4 right-4 sm:right-auto sm:w-80'
      }`}
      aria-label={t('chartJob.pill.title')}
    >
      {shown.slice(0, MAX_SHOWN).map(e => {
        const job = e.job ? { ...e.job, receivedAt: e.receivedAt } : null;
        const title = job?.title ?? e.videoTitle ?? t('chartJob.pill.making');
        const done = job?.status === 'done' && job.songId;
        const failed = job?.status === 'failed' || job?.status === 'rejected';
        return (
          <section
            key={e.id}
            className={`pointer-events-auto rounded-xl border bg-surface-light shadow-[0_8px_30px_rgba(0,0,0,0.5)] p-2.5 animate-slide-up ${
              done ? 'border-neon-green/60' : failed ? 'border-red-500/50' : 'border-neon-purple/50'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {e.videoId && (
                <img src={`https://i.ytimg.com/vi/${e.videoId}/default.jpg`} alt="" className="w-14 aspect-video rounded object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider font-bold text-neon-purple">
                  {done ? t('chartJob.pill.ready') : t('chartJob.pill.making')}
                </div>
                <div className="text-sm text-white font-semibold truncate" title={title}>{title}</div>
                {job?.artist && <div className="text-xs text-gray-400 truncate">{job.artist}</div>}
              </div>
              <button
                type="button"
                onClick={() => forget(e.id)}
                title={t('chartJob.pill.dismiss')}
                aria-label={t('chartJob.pill.dismiss')}
                className="w-6 h-6 -mr-1 -mt-1 rounded text-gray-400 hover:text-white hover:bg-surface-lighter cursor-pointer flex-shrink-0 text-xs"
              >
                &#10005;
              </button>
            </div>
            {!done && <ChartJobProgress job={job} className="mt-2" />}
            {!done && !failed && !inParty && <p className="mt-1.5 text-[11px] text-gray-400 leading-snug">{t('chartJob.pill.keepGoing')}</p>}
            {(done || (inParty && !failed)) && (
              <div className="mt-2 flex gap-2">
                {inParty ? (
                  <button
                    type="button"
                    disabled={!canAdd}
                    onClick={() => addToQueue(e)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10 hover:bg-neon-cyan/20 disabled:opacity-40 cursor-pointer disabled:cursor-default"
                  >
                    {t('chartJob.pill.addToQueue')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => singNow(e)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-neon-cyan/30 to-neon-magenta/30 border border-neon-cyan/50 hover:from-neon-cyan/40 hover:to-neon-magenta/40 cursor-pointer"
                  >
                    {t('chartJob.pill.singNow')}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
      {shown.length > MAX_SHOWN && (
        <div className="pointer-events-auto self-start px-2 py-0.5 rounded-full bg-surface-light text-[11px] text-gray-300">
          {t('chartJob.pill.more', { count: shown.length - MAX_SHOWN })}
        </div>
      )}
    </div>
  );
};

export default ChartJobPill;
