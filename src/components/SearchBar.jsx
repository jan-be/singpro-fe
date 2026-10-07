import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";
import { useNavigate } from "react-router-dom";
import { trackPick, searchSession, endSearch } from "../logic/track";
import { startChartJob } from "../logic/chartJobs";
import { forget, setFocusedChartJob, trackChartJob, useTrackedChartJobs } from "../logic/chartJobTracker";
import { useChartOffer } from "../logic/useChartOffer";
import { extractYouTubeVideoId } from "../logic/youtubeLink";
import { ChartLookup, ChartOffer, ChartMaking } from "./ChartOfferCard";

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
 * @param {function} onLinkActive called with whether the box is busy with a
 *        pasted link (looking it up, its offer, its chart), when that changes
 */
const SearchBar = ({ value = '', onChange, onLinkActive }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState(value);
  const offerKind = useChartOffer();
  const [status, setStatus] = useState(null); // { kind: 'loading' | 'info' | 'error', message }
  const [looking, setLooking] = useState(false); // a pasted link is being looked up
  const [offer, setOffer] = useState(null);   // { videoId, videoTitle, kind: 'none' | 'title' }: a chart can be made
  const [starting, setStarting] = useState(false);
  const [offerError, setOfferError] = useState(null); // why starting the chart failed
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
    setLooking(true);
    try {
      const resp = await fetch(`${apiUrl}/songs/by-video/${videoId}`, { signal: controller.signal });
      const json = await resp.json();
      if (controller.signal.aborted) return;
      setLooking(false);

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
        // the card says it: the video, "not on singpro yet", and the button where offered
        setOffer({ videoId, videoTitle: json.videoTitle, kind: 'none' });
        return;
      }
      setStatus({ kind: 'error', message: json.error ?? t('search.videoNotFound') });
    } catch (e) {
      if (e.name !== 'AbortError') { setLooking(false); setStatus({ kind: 'error', message: t('search.lookupFailed') }); }
    }
  };

  const openSong = (songId) => {
    trackPick('youtube-url', { songId });
    navigate(`/sing/${songId}`);
  };

  // Make a chart for the offered video: start (or join) the job; the tracker follows it from here on
  const generate = async () => {
    const { videoId, videoTitle } = offer;
    setStarting(true);
    setOfferError(null);
    try {
      const started = await startChartJob(videoId);
      if (started.songId) { openSong(started.songId); return; }
      trackChartJob(started.job, { videoTitle });
      setJobId(started.job.id);
      setOffer(null);
      setStatus(null);
    } catch (e) {
      const key = { limit_user: 'limitUser', limit_daily: 'limitDaily', unavailable: 'unavailable', unauthorized: 'signIn' }[e.code] ?? 'failed';
      setOfferError(t(`search.generate.${key}`));
    } finally {
      setStarting(false);
    }
  };

  const handleChange = (event) => {
    const next = event.target.value;
    setText(next);
    setStatus(null);
    setOffer(null);
    setOfferError(null);
    setLooking(false);
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
    setOfferError(null);
    setLooking(false);
    setJobId(null);
    push('');
    inputRef.current?.focus();
  };

  // A pasted link has the box's own card: the page's hint to paste one would be noise
  const linkActive = looking || Boolean(offer) || Boolean(tracked);
  useEffect(() => { onLinkActive?.(linkActive); }, [linkActive, onLinkActive]);

  const statusColor = { loading: 'text-white/55', info: 'text-white/55', error: 'text-red-400' };
  const job = tracked?.job ? { ...tracked.job, receivedAt: tracked.receivedAt } : null;

  return (
    <div>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none">
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
          className="field h-12 sm:h-14 rounded-2xl pl-12 pr-12 text-base sm:text-[17px] [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            onClick={clearSearch}
            className="btn-icon absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 text-white/50"
            title={t('search.clear')}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* YouTube URL lookup: the card's shape while it is looked up, then a word on what was found */}
      {looking && <ChartLookup />}
      {status && (
        <div className={`mt-2 px-1 text-sm ${statusColor[status.kind]} ${status.kind === 'loading' ? 'animate-pulse' : ''}`}>
          {status.message}
        </div>
      )}
      {/* A video no song is: the card, with the chart offered as the backend's switch says
          (admins while it is tested); for a title that found other songs, only where it can be made */}
      {offer && !tracked && (offer.kind === 'none' || offerKind === 'offer' || offerKind === 'signIn') && (
        <ChartOffer offer={offer} offerKind={offerKind} onGenerate={generate} starting={starting} error={offerError} />
      )}

      {/* The chart being made: progress here; the pill follows the user once they move on */}
      {tracked && (
        <ChartMaking
          tracked={tracked}
          job={job}
          onSingNow={() => { forget(tracked.id); openSong(job.songId); }}
          onDismiss={() => { forget(tracked.id); setJobId(null); }}
        />
      )}
    </div>
  );
};

export default SearchBar;
