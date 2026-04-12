import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl, useLangPath } from "../GlobalConsts";
import { Link, useNavigate } from "react-router-dom";
import { urlEscapedTitle } from "../logic/RandomUtility";

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

const SongResult = ({ song }) => {
  const lp = useLangPath();
  const slug = urlEscapedTitle(song.artist, song.title);
  return (
    <Link
      to={lp(`/sing/${slug}/${song.songId}`)}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-lighter transition-colors text-white no-underline border-b border-surface-lighter last:border-b-0"
    >
      {song.videoId && (
        <img
          src={`https://i.ytimg.com/vi/${song.videoId}/default.jpg`}
          alt=""
          className="w-12 h-9 rounded object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0">
        <div className="font-medium truncate">{song.title}</div>
        <div className="text-sm text-gray-400 truncate">{song.artist}</div>
      </div>
    </Link>
  );
};

const SearchBar = () => {
  const { t } = useTranslation();
  const lp = useLangPath();
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [urlError, setUrlError] = useState(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [videoTitle, setVideoTitle] = useState(null);
  const navigate = useNavigate();
  const abortRef = useRef(null);

  const handleSearchTermChange = async (event) => {
    const newTerm = event.target.value;
    setSearchTerm(newTerm);
    setUrlError(null);
    setVideoTitle(null);

    // Cancel any pending request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const videoId = extractYouTubeVideoId(newTerm);

    if (videoId) {
      // YouTube URL detected — look up by videoId
      setResults([]);
      setUrlLoading(true);
      try {
        const resp = await fetch(`${apiUrl}/songs/by-video/${videoId}`, { signal: controller.signal });
        const json = await resp.json();
        setUrlLoading(false);
        if (controller.signal.aborted) return;

        if (json.success && json.data) {
          if (json.matchType === 'exact') {
            // Exact videoId match — navigate directly
            const song = json.data;
            const slug = urlEscapedTitle(song.artist, song.title);
            navigate(lp(`/sing/${slug}/${song.songId}`));
          } else {
            // Title-based matches — show results so user can pick
            setVideoTitle(json.videoTitle);
            setResults(json.results ?? [json.data]);
          }
        } else {
          setVideoTitle(json.videoTitle ?? null);
          setUrlError(json.videoTitle
            ? t('search.noMatch', { title: json.videoTitle })
            : (json.error ?? t('search.videoNotFound')));
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          setUrlLoading(false);
          setUrlError(t('search.lookupFailed'));
        }
      }
      return;
    }

    // Normal text search
    setUrlLoading(false);
    if (newTerm.length >= 2) {
      try {
        const resp = await fetch(`${apiUrl}/search/${newTerm}`, { signal: controller.signal });
        const jsonObj = await resp.json();
        if (!controller.signal.aborted) setResults(jsonObj.data ?? []);
      } catch (e) {
        if (e.name !== 'AbortError') setResults([]);
      }
    } else {
      setResults([]);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        placeholder={t('search.placeholder')}
        value={searchTerm}
        onChange={handleSearchTermChange}
        className="w-full px-5 py-3 rounded-lg bg-surface-light border border-surface-lighter text-white placeholder-gray-500 text-lg focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_15px_rgba(0,229,255,0.15)] transition-all"
      />

      {/* YouTube URL loading indicator */}
      {urlLoading && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-surface-light border border-surface-lighter shadow-2xl px-4 py-3 text-gray-400 text-sm">
          {t('search.lookingUp')}
        </div>
      )}

      {/* YouTube URL error */}
      {urlError && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-surface-light border border-red-500/40 shadow-2xl px-4 py-3 text-red-400 text-sm">
          {urlError}
        </div>
      )}

      {/* Search results (normal search or YouTube title matches) */}
      {results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-surface-light border border-surface-lighter shadow-2xl max-h-80 overflow-y-auto">
          {videoTitle && (
            <div className="px-4 py-2 text-xs text-gray-500 border-b border-surface-lighter">
              {t('search.matchesFor', { title: videoTitle })}
            </div>
          )}
          {results.map((e, i) => <SongResult key={i} song={e} />)}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
