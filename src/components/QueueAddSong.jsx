import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";
import { apiUrl } from "../GlobalConsts";
import { trackSearch, currentSearch, endSearch } from "../logic/track";
import { extractYouTubeVideoId } from "../logic/youtubeLink";
import { startChartJob } from "../logic/chartJobs";
import { useChartOffer } from "../logic/useChartOffer";
import { usePartyChartState, clearPartyNotice } from "../logic/partyChartJobs";

const ERROR_KEYS = { limit_user: 'limitUser', limit_daily: 'limitDaily', unavailable: 'unavailable', unauthorized: 'signIn' };

/**
 * The queue's "add a song" box: the catalogue search (same as the home page,
 * capped to a short list), and a pasted YouTube link — its song if we have
 * it, else a karaoke chart made for it, which joins the queue right away and
 * plays once it is ready (who may: the backend's switch, useChartOffer; the
 * party's limit on songs being charted: maxPending).
 *
 * onAdd(song, source, searchId): queue a song; onAddJob(jobId, videoTitle): queue a song being charted
 * pendingCount: songs of this queue being charted right now
 */
const QueueAddSong = ({ onAdd, onAddJob, pendingCount = 0 }) => {
  const { t } = useTranslation();
  const namesOf = useSongNames();
  const offerKind = useChartOffer();
  const maxPending = usePartyChartState(s => s.maxPending);
  const refused = usePartyChartState(s => s.notice);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [link, setLink] = useState(null);     // { videoId, videoTitle, kind: looking | exact | title | none | error }
  const [chart, setChart] = useState(null);   // { state: 'starting' } | { state: 'error', key } while a chart is asked for
  const [added, setAdded] = useState(false);  // "it joins the queue": shown for a few seconds
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!added) return undefined;
    const id = setTimeout(() => setAdded(false), 6000);
    return () => clearTimeout(id);
  }, [added]);
  useEffect(() => {
    if (!refused) return undefined;
    const id = setTimeout(clearPartyNotice, 6000);
    return () => clearTimeout(id);
  }, [refused]);

  const reset = () => {
    abortRef.current?.abort();
    endSearch('queue');
    setTerm('');
    setResults([]);
    setLink(null);
    setChart(null);
  };

  const lookupVideo = async (videoId, controller) => {
    setLink({ videoId, kind: 'looking' });
    try {
      const json = await (await fetch(`${apiUrl}/songs/by-video/${videoId}`, { signal: controller.signal })).json();
      if (controller.signal.aborted) return;
      if (json.success && json.data && json.matchType === 'exact') {
        setResults([json.data]);
        setLink({ videoId, kind: 'exact' });
      } else if (json.success && json.searchQuery) {
        setResults(json.results ?? [json.data]);
        setLink({ videoId, videoTitle: json.videoTitle, kind: 'title' });
      } else if (json.videoTitle) {
        setLink({ videoId, videoTitle: json.videoTitle, kind: 'none' });
      } else {
        setLink({ videoId, kind: 'error' });
      }
    } catch (e) {
      if (e.name !== 'AbortError') setLink({ videoId, kind: 'error' });
    }
  };

  // Same search as the entry page (/songs/browse?q=…), just capped to a short list
  const handleChange = async (e) => {
    const next = e.target.value;
    setTerm(next);
    setChart(null);
    setAdded(false);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const videoId = extractYouTubeVideoId(next);
    setResults([]);
    setLink(null);
    if (videoId) { lookupVideo(videoId, controller); return; }
    if (next.trim().length < 2) {
      if (!next.trim()) endSearch('queue'); // an emptied box ends the search session
      return;
    }
    try {
      const params = new URLSearchParams({ q: next.trim(), limit: '10' });
      const json = await (await fetch(`${apiUrl}/songs/browse?${params}`, { signal: controller.signal })).json();
      if (!controller.signal.aborted) {
        setResults(json.data ?? []);
        trackSearch('queue', { q: next.trim(), results: (json.data ?? []).length });
      }
    } catch (err) {
      if (err.name !== 'AbortError') setResults([]);
    }
  };

  const handleAdd = (song) => {
    onAdd?.(song, 'queue-search', currentSearch('queue')?.id); // the search session that led to it
    reset();
  };

  const createChart = async () => {
    const { videoId, videoTitle } = link;
    setChart({ state: 'starting' });
    try {
      const r = await startChartJob(videoId);
      if (r.songId) {
        handleAdd(r.song ?? { songId: r.songId, title: videoTitle ?? '', artist: '', videoId });
        return;
      }
      onAddJob?.(r.job.id, videoTitle);
      reset();
      setAdded(true);
    } catch (e) {
      setChart({ state: 'error', key: ERROR_KEYS[e.code] ?? 'failed' });
    }
  };

  const linkOffer = link && (link.kind === 'none' || link.kind === 'title');
  const atLimit = maxPending > 0 && pendingCount >= maxPending;

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          placeholder={t('queue.searchOrPaste')}
          aria-label={t('queue.addSong')}
          value={term}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Escape') reset(); }}
          className="w-full pl-8 pr-3 py-2 rounded-lg bg-surface border border-surface-lighter text-white text-sm placeholder-gray-500 focus:outline-none focus:border-neon-cyan transition-colors"
        />
      </div>

      {link?.kind === 'looking' && <p className="px-1 text-xs text-gray-400 animate-pulse">{t('search.lookingUp')}</p>}
      {link?.kind === 'error' && <p className="px-1 text-xs text-red-400">{t('search.videoNotFound')}</p>}
      {link?.kind === 'none' && <p className="px-1 text-xs text-gray-300">{t('queue.notInSingpro', { title: link.videoTitle })}</p>}
      {link?.kind === 'title' && <p className="px-1 text-xs text-gray-400">{t('search.matchesFor', { title: link.videoTitle })}</p>}

      {results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto space-y-0.5" aria-label={t('queue.results')}>
          {results.map((song, i) => {
            const names = namesOf(song);
            return (
              <li key={song.songId ?? i}>
                <button
                  type="button"
                  onClick={() => handleAdd(song)}
                  className="group w-full flex items-center gap-2.5 text-left px-2 py-1.5 rounded-lg hover:bg-surface-lighter transition-colors cursor-pointer"
                >
                  {song.videoId
                    ? <img src={`https://i.ytimg.com/vi/${song.videoId}/default.jpg`} alt="" loading="lazy" className="w-12 aspect-video rounded object-cover flex-shrink-0" />
                    : <span className="w-12 aspect-video rounded bg-surface-lighter flex-shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-white truncate" lang={names.lang}>{names.title}</span>
                    <span className="block text-xs text-gray-400 truncate" lang={names.lang}>{names.artist}</span>
                  </span>
                  <span aria-hidden="true" className="w-6 h-6 rounded-full border border-neon-green/40 text-neon-green flex items-center justify-center text-base leading-none opacity-70 group-hover:opacity-100 flex-shrink-0">+</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* A karaoke chart for the pasted video: it joins the queue now and plays once it is ready */}
      {linkOffer && offerKind === 'offer' && maxPending > 0 && (
        <div className="rounded-lg border border-neon-purple/40 bg-neon-purple/10 p-2.5">
          {atLimit ? (
            <p className="text-xs text-gray-300">{t('queue.pendingLimit', { count: maxPending })}</p>
          ) : (
            <>
              <button
                type="button"
                onClick={createChart}
                disabled={chart?.state === 'starting'}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-neon-purple/40 to-neon-magenta/30 border border-neon-purple/60 hover:from-neon-purple/55 hover:to-neon-magenta/45 disabled:opacity-60 cursor-pointer disabled:cursor-wait transition-colors"
              >
                <span aria-hidden="true">✨</span>
                {link.kind === 'title' ? t('queue.chartOfferOther') : t('queue.chartOffer')}
              </button>
              <p className="mt-1.5 text-[11px] text-gray-300 leading-snug">{t('queue.chartOfferHint')}</p>
            </>
          )}
          {chart?.state === 'error' && <p className="mt-1.5 text-xs text-red-400">{t(`search.generate.${chart.key}`)}</p>}
        </div>
      )}
      {linkOffer && offerKind === 'signIn' && maxPending > 0 && (
        <a href="/login" target="_blank" rel="noopener" className="block px-1 text-xs text-neon-cyan hover:underline">{t('search.generate.signIn')}</a>
      )}

      {added && <p role="status" className="px-1 text-xs text-neon-green">{t('queue.chartAdded')}</p>}
      {refused && <p role="status" className="px-1 text-xs text-red-400">{t(`queue.refused.${refused.reason}`, { count: maxPending, defaultValue: t('queue.refused.unknown') })}</p>}
    </div>
  );
};

export default QueueAddSong;
