import React, { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";
import { hueToCss, playerHue } from "../logic/playerColor";
import { isPendingEntry, usePartyJob } from "../logic/partyChartJobs";
import QueueAddSong from "./QueueAddSong";
import ChartJobProgress from "./ChartJobProgress";

const FAILED = new Set(['failed', 'rejected']);

/** Who added an entry: their colour dot and name ("you" for your own) */
const AddedBy = ({ name, mine, playerColors }) => {
  const { t } = useTranslation();
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full" title={t('queue.addedBy', { name })}>
      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: hueToCss(playerHue(playerColors, name)) }} />
      <span className={`truncate ${mine ? 'text-neon-cyan' : ''}`}>{mine ? t('queue.you') : name}</span>
    </span>
  );
};

/** A song still being charted: its progress (the freshest copy the party heard) */
const PendingProgress = ({ entry, waitsAtFront }) => {
  const { t } = useTranslation();
  const job = usePartyJob(entry.job);
  const failed = FAILED.has(job?.status);
  return (
    <div className="mt-1.5">
      <ChartJobProgress job={job} />
      {!failed && waitsAtFront && <p className="mt-1 text-[11px] text-gray-400 leading-snug">{t('queue.pendingFront')}</p>}
    </div>
  );
};

/**
 * The party's queue: who sings what next. The first entry that can play is
 * marked "Up next"; a song still being charted (a pasted link, made by AI)
 * shows its progress and keeps its place — passed over until it is ready, so
 * one at the front plays as soon as it is. Every entry says who added it.
 *
 * onSkip (host only): skip the current song — armed on first click, fires on the second.
 * onAddJob(jobId, videoTitle): queue a song being charted (QueueAddSong)
 * headerAction: a control next to the title (pop the queue out into its own window, or back in).
 */
const QueuePanel = ({ queue = [], isHost, currentUserName, playerColors, onRemove, onReorder, onAdd, onAddJob, onSkip, headerAction }) => {
  const { t } = useTranslation();
  const namesOf = useSongNames();
  const [skipArmed, setSkipArmed] = useState(false);

  // A skip affects everyone in the party, so a stray tap should not do it:
  // the button asks for a second click within 3 seconds.
  useEffect(() => {
    if (!skipArmed) return;
    const id = setTimeout(() => setSkipArmed(false), 3000);
    return () => clearTimeout(id);
  }, [skipArmed]);

  const handleSkipClick = () => {
    if (skipArmed) {
      setSkipArmed(false);
      onSkip?.();
    } else {
      setSkipArmed(true);
    }
  };

  // Drag state
  const dragIndexRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

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

  const nextIndex = queue.findIndex(e => e?.songId);
  // the first song still being charted ahead of the next one to play says why it is passed over
  const frontPending = queue.findIndex(e => isPendingEntry(e) && !FAILED.has(e.job.status));
  const pendingCount = queue.filter(e => isPendingEntry(e) && !FAILED.has(e.job.status)).length;

  return (
    // Solid tint, no backdrop blur: the drawer lies over the playing video
    <div className="bg-surface-light rounded-xl border border-surface-lighter shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
      {/* Header: title, the host's skip button on its own row (the sidebar is
          only 224-256px wide), and the always-present "add a song" box */}
      <div className="p-3 border-b border-surface-lighter space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-white font-bold text-sm flex items-center gap-2">
            {t('queue.title')}
            {queue.length > 0 && <span className="text-gray-400 font-normal">{queue.length}</span>}
          </h3>
          {headerAction}
        </div>
        {onSkip && (
          <button
            onClick={handleSkipClick}
            title={t('queue.skipHint')}
            aria-pressed={skipArmed}
            className={`w-full px-3 py-1 text-xs rounded border transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
              skipArmed
                ? 'bg-neon-magenta/20 text-neon-magenta border-neon-magenta/60 animate-pulse'
                : 'bg-surface-lighter/60 text-gray-300 border-transparent hover:text-white hover:bg-surface-lighter'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
            {skipArmed ? t('queue.skipConfirm') : t('queue.skipSong')}
          </button>
        )}
        <QueueAddSong onAdd={onAdd} onAddJob={onAddJob} pendingCount={pendingCount} />
      </div>

      {/* Queue items */}
      {queue.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <div className="text-gray-300 text-sm">{t('queue.empty')}</div>
          <div className="mt-1 text-gray-500 text-xs">{t('queue.emptyHint')}</div>
        </div>
      ) : (
        <ol className="divide-y divide-surface-lighter" aria-label={t('queue.title')}>
          {queue.map((item, index) => {
            const mine = item.addedBy === currentUserName;
            const canRemove = isHost || mine;
            const canDrag = isHost;
            const isDragOver = dragOverIndex === index;
            const pending = isPendingEntry(item);
            const failed = pending && FAILED.has(item.job.status);
            const isNext = index === nextIndex;
            const names = namesOf(item);

            return (
              <li
                key={item.job ? `job-${item.job.id}` : `${item.songId}-${index}`}
                className={`relative flex items-start gap-2.5 p-3 transition-colors ${
                  isDragOver ? 'bg-neon-purple/10 border-t-2 border-neon-purple/40' : ''
                } ${isNext ? 'bg-neon-green/[0.06]' : ''} ${pending && !failed ? 'bg-neon-purple/[0.07]' : ''}`}
                draggable={canDrag}
                onDragStart={canDrag ? (e) => handleDragStart(e, index) : undefined}
                onDragEnd={canDrag ? handleDragEnd : undefined}
                onDragOver={canDrag ? (e) => handleDragOver(e, index) : undefined}
                onDragLeave={canDrag ? handleDragLeave : undefined}
                onDrop={canDrag ? (e) => handleDrop(e, index) : undefined}
                onTouchStart={canDrag ? (e) => handleTouchStart(e, index) : undefined}
                onTouchEnd={canDrag ? handleTouchEnd : undefined}
              >
                {isNext && <span aria-hidden="true" className="absolute left-0 inset-y-0 w-0.5 bg-neon-green" />}
                {/* Position, or the drag handle for the host */}
                <span
                  className={`w-4 pt-2 text-center text-xs flex-shrink-0 select-none ${canDrag ? 'text-gray-500 cursor-grab active:cursor-grabbing' : 'text-gray-500 tabular-nums'}`}
                  title={canDrag ? t('queue.dragToReorder') : undefined}
                >
                  {canDrag ? <>&#9776;</> : index + 1}
                </span>

                <div className="relative flex-shrink-0">
                  {item.videoId
                    ? <img src={`https://i.ytimg.com/vi/${item.videoId}/default.jpg`} alt="" loading="lazy" className={`w-16 aspect-video rounded object-cover ${pending ? 'opacity-70' : ''}`} />
                    : <span className="block w-16 aspect-video rounded bg-surface-lighter" />}
                  {(pending || item.generated) && (
                    <span
                      title={t('chartJob.aiTitle')}
                      className="absolute -top-1 -left-1 px-1 rounded text-[9px] font-black leading-[14px] text-white bg-neon-purple shadow-[0_0_8px_rgba(180,74,255,0.6)]"
                    >
                      {t('chartJob.ai')}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {isNext && (
                    <div className="text-[10px] uppercase tracking-wider text-neon-green font-bold leading-tight">{t('queue.upNext')}</div>
                  )}
                  <div className={`text-sm truncate ${failed ? 'text-gray-400 line-through decoration-gray-500' : 'text-white'}`} lang={names.lang}>
                    {names.title || t('chartJob.pill.making')}
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-400 text-xs min-w-0">
                    {names.artist && <span className="truncate min-w-0" lang={names.lang}>{names.artist}</span>}
                    {names.artist && item.addedBy && <span aria-hidden="true">·</span>}
                    <AddedBy name={item.addedBy} mine={mine} playerColors={playerColors} />
                  </div>
                  {pending && <PendingProgress entry={item} waitsAtFront={index === frontPending && (nextIndex === -1 || index < nextIndex)} />}
                </div>
                {canRemove && (
                  <button
                    onClick={() => onRemove?.(index)}
                    className="w-7 h-7 -mr-1 rounded text-gray-400 hover:text-red-400 hover:bg-surface-lighter transition-colors text-xs cursor-pointer flex-shrink-0"
                    title={t('queue.remove')}
                    aria-label={`${t('queue.remove')}: ${names.title}`}
                  >
                    &#10005;
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

export default QueuePanel;
