import React, { useState } from "react";
import { apiUrl } from "../GlobalConsts";
import { Link } from "react-router-dom";
import { urlEscapedTitle } from "../logic/RandomUtility";

const SearchBar = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);

  const handleSearchTermChange = async (event) => {
    const newTerm = event.target.value;
    setSearchTerm(newTerm);

    if (newTerm.length >= 2) {
      try {
        const resp = await fetch(`${apiUrl}/search/${newTerm}`);
        const jsonObj = await resp.json();
        setResults(jsonObj.data ?? []);
      } catch {
        setResults([]);
      }
    } else {
      setResults([]);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search songs..."
        value={searchTerm}
        onChange={handleSearchTermChange}
        className="w-full px-5 py-3 rounded-lg bg-surface-light border border-surface-lighter text-white placeholder-gray-500 text-lg focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_15px_rgba(0,229,255,0.15)] transition-all"
      />

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
