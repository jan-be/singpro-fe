import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";
import { Link, useNavigate } from "react-router-dom";
import { trackPick, searchSession, endSearch } from "../logic/track";
import { startChartJob, chartJobMessageKey } from "../logic/chartJobs";
import { forget, setFocusedChartJob, trackChartJob, useTrackedChartJobs } from "../logic/chartJobTracker";
import { useChartOffer } from "../logic/useChartOffer";
import { extractYouTubeVideoId } from "../logic/youtubeLink";
import ChartJobProgress from "./ChartJobProgress";

const DEBOUNCE_MS = 200;

/**
 * The entry page's search box. It does not render results itself: typing
 * updates the page's `q` filter (debounced) and the song grid below shows
 * the matches. Pasting a YouTube URL jumps straight to an exact match, or
 * searches the grid for the video's title. When no song is that video, a
 * chart can be made for it (logic/chartJobs.js; who is offered it is the
 * backend's switch, useChartOffer): the bar shows its progress, and as the
 * user moves on (sings something else meanwhile) the chart pill on every
 * page takes over (chartJobTracker.js, ChartJobPill).
 *
 * @param {string}   value    current `q` from the URL
 * @param {function} onChange called with the new (trimmed) query
 */
const SearchBar = ({ value = '', onChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState(value);
  const offerKind = useChartOffer();
  const [status, setStatus] = useState(null); // { kind: 'loading' | 'info' | 'error', message }
  const [offer, setOffer] = useState(null);   // { videoId, videoTitle, kind: 'none' | 'title' }: a chart can be made
  const [jobId, setJobId] = useState(null);   // the chart this bar started (followed by the tracker)
  const { entries } = useTrackedChartJobs();
  const tracked = jobId ? entries.find(e => e.id === jobId) : null;
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const lastPushedRef = useRef(value);

  // Follow external changes to `q` (back button, "clear filters") without
  // clobbering what the user is typing right now.
  useEffect(() => {
    if (value !== lastPushedRef.current) {
      lastPushedRef.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  // While this bar shows the chart, the pill leaves it out; leaving the page
  // (or starting another search) hands it to the pill
  useEffect(() => {
    if (!jobId) return undefined;
    setFocusedChartJob(jobId);
    return () => setFocusedChartJob(null);
  }, [jobId]);
  useEffect(() => { if (jobId && !tracked) setJobId(null); }, [jobId, tracked]); // dismissed in the pill

  const push = (q) => {
    const trimmed = q.trim();
    if (trimmed === lastPushedRef.current) return;
    lastPushedRef.current = trimmed;
    onChange?.(trimmed);
  };

  const lookupVideo = async (videoId) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: 'loading', message: t('search.lookingUp') });
    try {
      const resp = await fetch(`${apiUrl}/songs/by-video/${videoId}`, { signal: controller.signal });
      const json = await resp.json();
      if (controller.signal.aborted) return;

      if (json.success && json.data && json.matchType === 'exact') {
        trackPick('youtube-url', { songId: json.data.songId });
        navigate(`/sing/${json.data.songId}`);
        return;
      }
      if (json.success && json.searchQuery) {
        // Title-based matches: search the grid for the video's title so the user can pick
        endSearch('entry');
        searchSession('entry', 'youtube'); // the grid's search event says the link started it
        setText(json.searchQuery);
        push(json.searchQuery);
        setStatus({ kind: 'info', message: t('search.matchesFor', { title: json.videoTitle }) });
        setOffer({ videoId, videoTitle: json.videoTitle, kind: 'title' });
        return;
      }
      if (json.videoTitle) {
        setStatus({ kind: 'info', message: t('search.noMatch', { title: json.videoTitle }) });
        setOffer({ videoId, videoTitle: json.videoTitle, kind: 'none' });
        return;
      }
      setStatus({ kind: 'error', message: json.error ?? t('search.videoNotFound') });
    } catch (e) {
      if (e.name !== 'AbortError') setStatus({ kind: 'error', message: t('search.lookupFailed') });
    }
  };

  const openSong = (songId) => {
    trackPick('youtube-url', { songId });
    navigate(`/sing/${songId}`);
  };

  // Make a chart for the offered video: start (or join) the job; the tracker follows it from here on
  const generate = async () => {
    const { videoId, videoTitle } = offer;
    setOffer(null);
    setStatus({ kind: 'loading', message: t('search.generate.starting') });
    try {
      const started = await startChartJob(videoId);
      if (started.songId) { openSong(started.songId); return; }
      trackChartJob(started.job, { videoTitle });
      setJobId(started.job.id);
      setStatus(null);
    } catch (e) {
      const key = { limit_user: 'limitUser', limit_daily: 'limitDaily', unavailable: 'unavailable', unauthorized: 'signIn' }[e.code] ?? 'failed';
      setStatus({ kind: 'error', message: t(`search.generate.${key}`) });
    }
  };

  const handleChange = (event) => {
    const next = event.target.value;
    setText(next);
    setStatus(null);
    setOffer(null);
    setJobId(null);
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    if (!next.trim()) endSearch('entry'); // an emptied box ends the search session; the next letter starts one

    const videoId = extractYouTubeVideoId(next);
    if (videoId) {
      lookupVideo(videoId);
      return;
    }
    timerRef.current = setTimeout(() => push(next), DEBOUNCE_MS);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      clearTimeout(timerRef.current);
      push(text);
    } else if (event.key === 'Escape') {
      clearSearch();
    }
  };

  const clearSearch = () => {
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    endSearch('entry');
    setText('');
    setStatus(null);
    setOffer(null);
    setJobId(null);
    push('');
    inputRef.current?.focus();
  };

  const statusColor = { loading: 'text-gray-400', info: 'text-gray-400', error: 'text-red-400' };
  const job = tracked?.job ? { ...tracked.job, receivedAt: tracked.receivedAt } : null;
  const jobTitle = job?.title ?? tracked?.videoTitle;

  return (
    <div>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="search"
          placeholder={t('search.placeholder')}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className="w-full pl-12 pr-10 py-3.5 rounded-xl bg-surface-light border border-surface-lighter text-white placeholder-gray-500 text-lg focus:outline-none focus:border-neon-cyan/60 focus:shadow-[0_0_20px_rgba(0,229,255,0.15),inset_0_0_20px_rgba(0,229,255,0.05)] transition-all duration-300 [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer p-1"
            title={t('search.clear')}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* YouTube URL lookup feedback */}
      {status && (
        <div className={`mt-2 px-1 text-sm ${statusColor[status.kind]} ${status.kind === 'loading' ? 'animate-pulse' : ''}`}>
          {status.message}
        </div>
      )}
      {/* A chart for the video: offered as the backend's switch says (admins while it is tested) */}
      {offer && offerKind === 'offer' && (
        <div className="mt-1 px-1 text-sm">
          <button type="button" onClick={generate} className="text-neon-cyan hover:underline cursor-pointer">
            {t(offer.kind === 'title' ? 'search.generate.offerOther' : 'search.generate.offer')}
          </button>
          <span className="text-gray-500"> · {t('search.generate.offerHint')}</span>
        </div>
      )}
      {offer && offerKind === 'signIn' && (
        <div className="mt-1 px-1 text-sm">
          <Link to={`/login?next=${encodeURIComponent('/')}`} className="text-neon-cyan hover:underline">{t('search.generate.signIn')}</Link>
        </div>
      )}

      {/* The chart being made: progress here; the pill follows the user once they move on */}
      {tracked && (
        <div className="mt-3 rounded-xl border border-neon-purple/40 bg-surface-light/80 p-3 flex gap-3 items-start">
          {tracked.videoId && (
            <img src={`https://i.ytimg.com/vi/${tracked.videoId}/mqdefault.jpg`} alt="" className="w-24 aspect-video rounded object-cover flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-neon-purple">{t('chartJob.pill.making')}</div>
            <div className="text-white font-semibold truncate">{jobTitle}</div>
            {job?.artist && <div className="text-xs text-gray-400 truncate">{job.artist}</div>}
            {job?.status === 'done' ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-sm text-neon-green">{t('search.generate.done')}</span>
                <button
                  type="button"
                  onClick={() => { forget(tracked.id); openSong(job.songId); }}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-neon-cyan/30 to-neon-magenta/30 border border-neon-cyan/50 hover:from-neon-cyan/40 hover:to-neon-magenta/40 cursor-pointer"
                >
                  {t('chartJob.pill.singNow')}
                </button>
              </div>
            ) : job?.status === 'failed' || job?.status === 'rejected' ? (
              <div className="mt-2 text-sm text-red-400">{t(`search.generate.${chartJobMessageKey(job)}`)}</div>
            ) : (
              <>
                <ChartJobProgress job={job} className="mt-2" />
                <p className="mt-2 text-xs text-gray-400">{t('search.generate.keepGoing')}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchBar;
