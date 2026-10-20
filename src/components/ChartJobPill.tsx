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
            className={`pop pointer-events-auto rounded-2xl p-3 animate-slide-up ${
              done ? 'border-neon-green/35' : failed ? 'border-red-400/35' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              {e.videoId && (
                <img src={`https://i.ytimg.com/vi/${e.videoId}/default.jpg`} alt="" className="w-14 aspect-video rounded-md object-cover ring-1 ring-white/10 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className={`pop-label text-[10px] ${done ? 'text-neon-green' : 'text-[#d9a8ff]'}`}>
                  {done ? t('chartJob.pill.ready') : t('chartJob.pill.making')}
                </div>
                <div className="mt-0.5 text-sm text-white font-semibold tracking-[-0.01em] truncate" title={title}>{title}</div>
                {job?.artist && <div className="text-xs text-white/55 truncate">{job.artist}</div>}
              </div>
              <button
                type="button"
                onClick={() => forget(e.id)}
                title={t('chartJob.pill.dismiss')}
                aria-label={t('chartJob.pill.dismiss')}
                className="btn-icon w-7 h-7 -mr-1 -mt-1 text-white/50 text-xs"
              >
                &#10005;
              </button>
            </div>
            {!done && <ChartJobProgress job={job} className="mt-2.5" />}
            {!done && !failed && !inParty && <p className="mt-2 text-[11px] text-white/55 leading-snug">{t('chartJob.pill.keepGoing')}</p>}
            {(done || (inParty && !failed)) && (
              <div className="mt-2.5 flex gap-2">
                {inParty ? (
                  <button
                    type="button"
                    disabled={!canAdd}
                    onClick={() => addToQueue(e)}
                    className="btn btn-sm btn-primary flex-1 disabled:cursor-default"
                  >
                    {t('chartJob.pill.addToQueue')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => singNow(e)}
                    className="btn btn-sm btn-primary flex-1"
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
        <div className="pointer-events-auto self-start px-2.5 py-0.5 rounded-full bg-panel-raised border border-white/10 text-[11px] text-white/70">
          {t('chartJob.pill.more', { count: shown.length - MAX_SHOWN })}
        </div>
      )}
    </div>
  );
};

export default ChartJobPill;
