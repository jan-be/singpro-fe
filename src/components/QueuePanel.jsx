import React, { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";

const QueuePanel = ({ queue = [], isHost, currentUserName, onRemove, onReorder, onAdd }) => {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  // Drag state
  const dragIndexRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

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

  // --- Drag handlers (host only) ---
  const handleDragStart = useCallback((e, index) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image semi-transparent
    e.currentTarget.style.opacity = '0.5';
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '1';
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      setDragOverIndex(index);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((e, toIndex) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex !== null && fromIndex !== toIndex) {
      onReorder?.(fromIndex, toIndex);
    }
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, [onReorder]);

  // Touch drag support
  const touchStartRef = useRef(null);
  const touchIndexRef = useRef(null);

  const handleTouchStart = useCallback((e, index) => {
    touchStartRef.current = e.touches[0].clientY;
    touchIndexRef.current = index;
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (touchIndexRef.current === null || touchStartRef.current === null) return;
    const endY = e.changedTouches[0].clientY;
    const diff = endY - touchStartRef.current;
    const fromIndex = touchIndexRef.current;

    // Threshold: 30px vertical drag
    if (Math.abs(diff) > 30) {
      const direction = diff > 0 ? 1 : -1;
      const toIndex = fromIndex + direction;
      if (toIndex >= 0 && toIndex < queue.length) {
        onReorder?.(fromIndex, toIndex);
      }
    }
    touchStartRef.current = null;
    touchIndexRef.current = null;
  }, [queue.length, onReorder]);

  return (
    <div className="bg-surface-light/80 backdrop-blur-sm rounded-lg border border-surface-lighter">
      <div className="flex items-center justify-between p-3 border-b border-surface-lighter">
        <h3 className="text-white font-bold text-sm">{t('queue.title')}</h3>
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="px-3 py-1 text-xs rounded bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 transition-colors cursor-pointer"
        >
          {t('queue.addSong')}
        </button>
      </div>

      {/* Search overlay */}
      {searchOpen && (
        <div className="p-3 border-b border-surface-lighter">
          <input
            type="text"
            placeholder={t('queue.searchSongs')}
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
        <div className="p-4 text-center text-gray-500 text-sm">{t('queue.empty')}</div>
      ) : (
        <div className="divide-y divide-surface-lighter">
          {queue.map((item, index) => {
            const canRemove = isHost || item.addedBy === currentUserName;
            const canDrag = isHost;
            const isDragOver = dragOverIndex === index;

            return (
              <div
                key={index}
                className={`flex items-center gap-3 p-3 transition-colors ${isDragOver ? 'bg-neon-purple/10 border-t-2 border-neon-purple/40' : ''}`}
                draggable={canDrag}
                onDragStart={canDrag ? (e) => handleDragStart(e, index) : undefined}
                onDragEnd={canDrag ? handleDragEnd : undefined}
                onDragOver={canDrag ? (e) => handleDragOver(e, index) : undefined}
                onDragLeave={canDrag ? handleDragLeave : undefined}
                onDrop={canDrag ? (e) => handleDrop(e, index) : undefined}
                onTouchStart={canDrag ? (e) => handleTouchStart(e, index) : undefined}
                onTouchEnd={canDrag ? handleTouchEnd : undefined}
              >
                {/* Drag handle (host only) */}
                {canDrag && (
                  <span className="flex-shrink-0 text-gray-500 cursor-grab active:cursor-grabbing select-none text-sm" title={t('queue.dragToReorder')}>
                    &#9776;
                  </span>
                )}

                {index === 0 && (
                  <span className="text-[10px] uppercase tracking-wider text-neon-green font-bold flex-shrink-0">
                    {t('queue.upNext')}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm truncate">{item.title}</div>
                  <div className="text-gray-400 text-xs truncate">
                    {item.artist}
                    {item.addedBy && <span> &middot; {item.addedBy}</span>}
                  </div>
                </div>
                {canRemove && (
                  <button
                    onClick={() => onRemove?.(index)}
                    className="w-6 h-6 rounded text-gray-400 hover:text-red-400 hover:bg-surface-lighter transition-colors text-xs cursor-pointer flex-shrink-0"
                    title={t('queue.remove')}
                  >
                    &#10005;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default QueuePanel;
