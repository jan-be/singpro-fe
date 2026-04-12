import React, { useState, useRef } from "react";
import { apiUrl } from "../GlobalConsts";
import { Link, useNavigate } from "react-router-dom";
import { urlEscapedTitle } from "../logic/RandomUtility";

/** Extract a YouTube video ID from a URL, or return null. */
function extractYouTubeVideoId(text) {
  const trimmed = text.trim();
  // youtube.com/watch?v=ID or youtube.com/watch/ID
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com'
      || url.hostname === 'm.youtube.com') {
      const v = url.searchParams.get('v');
      if (v) return v;
      // /watch/ID form
      const match = url.pathname.match(/^\/watch\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
    // youtu.be/ID
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split(/[/?]/)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {
    // Not a URL — that's fine
  }
  return null;
}

const SearchBar = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [urlError, setUrlError] = useState(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const navigate = useNavigate();
  const abortRef = useRef(null);

  const handleSearchTermChange = async (event) => {
    const newTerm = event.target.value;
    setSearchTerm(newTerm);
    setUrlError(null);

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
          const song = json.data;
          const slug = urlEscapedTitle(song.artist, song.title);
          navigate(`/sing/${slug}/${song.songId}`);
        } else {
          setUrlError("This YouTube video is not in our song database yet.");
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          setUrlLoading(false);
          setUrlError("Failed to look up this video. Please try again.");
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
        placeholder="Search songs or paste a YouTube URL..."
        value={searchTerm}
        onChange={handleSearchTermChange}
        className="w-full px-5 py-3 rounded-lg bg-surface-light border border-surface-lighter text-white placeholder-gray-500 text-lg focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_15px_rgba(0,229,255,0.15)] transition-all"
      />

      {/* YouTube URL loading indicator */}
      {urlLoading && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-surface-light border border-surface-lighter shadow-2xl px-4 py-3 text-gray-400 text-sm">
          Looking up video...
        </div>
      )}

      {/* YouTube URL error */}
      {urlError && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-surface-light border border-red-500/40 shadow-2xl px-4 py-3 text-red-400 text-sm">
          {urlError}
        </div>
      )}

      {results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-surface-light border border-surface-lighter shadow-2xl max-h-80 overflow-y-auto">
          {results.map((e, i) => {
            const slug = urlEscapedTitle(e.artist, e.title);
            return (
              <Link
                key={i}
                to={`/sing/${slug}/${e.songId}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-lighter transition-colors text-white no-underline border-b border-surface-lighter last:border-b-0"
              >
                {e.videoId && (
                  <img
                    src={`https://i.ytimg.com/vi/${e.videoId}/default.jpg`}
                    alt=""
                    className="w-12 h-9 rounded object-cover flex-shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="font-medium truncate">{e.title}</div>
                  <div className="text-sm text-gray-400 truncate">{e.artist}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
