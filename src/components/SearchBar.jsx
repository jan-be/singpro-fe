import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";
import { useNavigate } from "react-router-dom";
import { trackPick, searchSession, endSearch } from "../logic/track";

/** Extract a YouTube video ID from a URL, or return null. */
function extractYouTubeVideoId(text) {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com'
      || url.hostname === 'm.youtube.com') {
      const v = url.searchParams.get('v');
      if (v) return v;
      const match = url.pathname.match(/^\/watch\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split(/[/?]/)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {
    // Not a URL
  }
  return null;
}

const DEBOUNCE_MS = 200;

/**
 * The entry page's search box. It does not render results itself: typing
 * updates the page's `q` filter (debounced) and the song grid below shows
 * the matches. Pasting a YouTube URL jumps straight to an exact match, or
 * searches the grid for the video's title.
 *
 * @param {string}   value    current `q` from the URL
 * @param {function} onChange called with the new (trimmed) query
 */
const SearchBar = ({ value = '', onChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState(value);
  const [status, setStatus] = useState(null); // { kind: 'loading' | 'info' | 'error', message }
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
        return;
      }
      setStatus({
        kind: 'error',
        message: json.videoTitle
          ? t('search.noMatch', { title: json.videoTitle })
          : (json.error ?? t('search.videoNotFound')),
      });
    } catch (e) {
      if (e.name !== 'AbortError') setStatus({ kind: 'error', message: t('search.lookupFailed') });
    }
  };

  const handleChange = (event) => {
    const next = event.target.value;
    setText(next);
    setStatus(null);
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
    push('');
    inputRef.current?.focus();
  };

  const statusColor = { loading: 'text-gray-400', info: 'text-gray-400', error: 'text-red-400' };

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
    </div>
  );
};

export default SearchBar;
