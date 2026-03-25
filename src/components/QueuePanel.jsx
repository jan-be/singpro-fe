import React, { useState } from "react";
import { apiUrl } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";

const QueuePanel = ({ queue = [], isHost, onRemove, onReorder, onAdd }) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const handleSearch = async (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    if (term.length >= 2) {
      try {
        const resp = await fetch(`${apiUrl}/search/${term}`);
        const json = await resp.json();
        setSearchResults(json.data ?? []);
      } catch {
        setSearchResults([]);
      }
    } else {
      setSearchResults([]);
    }
  };

  const handleAddSong = (song) => {
    onAdd?.(song);
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResults([]);
  };

  return (
    <div className="bg-surface-light/80 backdrop-blur-sm rounded-lg border border-surface-lighter">
      <div className="flex items-center justify-between p-3 border-b border-surface-lighter">
        <h3 className="text-white font-bold text-sm">Queue</h3>
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="px-3 py-1 text-xs rounded bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 transition-colors cursor-pointer"
        >
          + Add Song
        </button>
      </div>

      {/* Search overlay */}
      {searchOpen && (
        <div className="p-3 border-b border-surface-lighter">
          <input
            type="text"
            placeholder="Search songs..."
            value={searchTerm}
            onChange={handleSearch}
            autoFocus
            className="w-full px-3 py-2 rounded bg-surface border border-surface-lighter text-white text-sm placeholder-gray-500 focus:outline-none focus:border-neon-cyan transition-all"
          />
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {searchResults.map((song, i) => (
                <button
                  key={i}
                  onClick={() => handleAddSong(song)}
                  className="w-full text-left px-3 py-2 rounded hover:bg-surface-lighter transition-colors text-sm cursor-pointer"
                >
                  <div className="text-white truncate">{song.title}</div>
                  <div className="text-gray-400 text-xs truncate">{song.artist}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Queue items */}
      {queue.length === 0 ? (
        <div className="p-4 text-center text-gray-500 text-sm">Queue is empty</div>
      ) : (
        <div className="divide-y divide-surface-lighter">
          {queue.map((item, index) => (
            <div key={index} className="flex items-center gap-3 p-3">
              {index === 0 && (
                <span className="text-[10px] uppercase tracking-wider text-neon-green font-bold flex-shrink-0">
                  Up next
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm truncate">{item.title}</div>
                <div className="text-gray-400 text-xs truncate">
                  {item.artist}
                  {item.addedBy && <span> &middot; {item.addedBy}</span>}
                </div>
              </div>
              {isHost && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {index > 0 && (
                    <button
                      onClick={() => onReorder?.(index, index - 1)}
                      className="w-6 h-6 rounded text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors text-xs cursor-pointer"
                      title="Move up"
                    >
                      &#9650;
                    </button>
                  )}
                  {index < queue.length - 1 && (
                    <button
                      onClick={() => onReorder?.(index, index + 1)}
                      className="w-6 h-6 rounded text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors text-xs cursor-pointer"
                      title="Move down"
                    >
                      &#9660;
                    </button>
                  )}
                  <button
                    onClick={() => onRemove?.(index)}
                    className="w-6 h-6 rounded text-gray-400 hover:text-red-400 hover:bg-surface-lighter transition-colors text-xs cursor-pointer"
                    title="Remove"
                  >
                    &#10005;
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default QueuePanel;
