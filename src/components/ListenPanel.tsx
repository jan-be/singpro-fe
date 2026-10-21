import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";
import { MAX_SECONDS } from "../logic/songListener";
import type { SongNamesSource } from "../logic/lyricsScripts";

/** A song the server recognised (recognize/recognizer.ts): the song and where in it the room is, s */
export interface ListenResult extends SongNamesSource {
  songId: string;
  videoId?: string | null;
  offset: number;
}

export type ListenPhase = ListenState['phase'];

/** What the panel shows (SearchBar keeps it) */
export type ListenState =
  /** heard: seconds heard so far */
  | { phase: 'starting' | 'listening' | 'looking'; heard: number }
  /** the song, or two charts of one video */
  | { phase: 'found'; results: ListenResult[] }
  | { phase: 'none' }
  /** why ('denied', 'noDevice', 'rate', 'off', …) */
  | { phase: 'error'; error?: string };

/** Where the panel puts its level setter (songListener's onLevel calls it) */
export type ListenMeter = React.RefObject<((level: number) => void) | null>;

export interface ListenPanelProps {
  state: ListenState | null;
  meter: ListenMeter;
  onStop: () => void;
  onRetry: () => void;
  onClose: () => void;
  /** `fromHere`: sing from where the room is */
  onOpen: (result: ListenResult, fromHere: boolean) => void;
}

/**
 * The entry page's listen card (SearchBar's microphone button): while the
 * microphone listens, a level meter, how long it has listened and Stop; then
 * the song (or songs: two charts of one video) with "Sing from 1:23" and
 * "From the start", or why nothing came back.
 *
 * state: { phase: 'starting' | 'listening' | 'looking' | 'found' | 'none' | 'error', heard, results, error }
 * meter: a ref the panel puts its level setter in (songListener's onLevel, ~30 a second)
 */
const CARD = 'mt-3 rounded-2xl bg-panel border border-white/10 p-3 sm:p-4 animate-slide-up';

export const formatTime = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

// Five bars that follow the microphone's level (a voice or music near it moves them)
const LevelBars = ({ meter }: { meter: ListenMeter }) => {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    meter.current = (v: number) => setLevel(prev => Math.max(v, prev * 0.8));
    return () => { meter.current = null; };
  }, [meter]);
  // raw mic levels: ~0.003 a quiet room, ~0.05 music nearby, 0.3 loud
  const norm = Math.min(1, Math.log10(1 + level * 400) / Math.log10(121));
  return (
    <div className="flex items-end gap-1 h-8" aria-hidden="true">
      {[0.55, 0.8, 1, 0.8, 0.55].map((k, i) => (
        <span
          key={i}
          className="w-1.5 rounded-full bg-gradient-to-t from-[#8b5cf6] to-[#ff4fd8] transition-[height] duration-100"
          style={{ height: `${Math.round(18 + 82 * Math.min(1, norm * k * 1.25))}%` }}
        />
      ))}
    </div>
  );
};

const ResultRow = ({ result, onOpen }: { result: ListenResult; onOpen: ListenPanelProps['onOpen'] }) => {
  const { t } = useTranslation();
  const names = useSongNames()(result);
  return (
    <div className="flex gap-3 sm:gap-4 items-center">
      <div className="w-28 sm:w-36 flex-shrink-0">
        {result.videoId
          ? <img src={`https://i.ytimg.com/vi/${result.videoId}/mqdefault.jpg`} alt="" className="w-full aspect-video rounded-xl object-cover ring-1 ring-white/10" />
          : <span className="block w-full aspect-video rounded-xl bg-white/[0.06]" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-white font-semibold leading-snug truncate">{names.title}</div>
        <div className="text-sm text-white/60 truncate">{names.artist}</div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen(result, true)}>
            {t('listen.singFrom', { time: formatTime(result.offset) })}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpen(result, false)}>
            {t('listen.fromStart')}
          </button>
        </div>
      </div>
    </div>
  );
};

const ListenPanel = ({ state, meter, onStop, onRetry, onClose, onOpen }: ListenPanelProps) => {
  const { t } = useTranslation();
  if (!state) return null;
  const { phase } = state;

  if (state.phase === 'starting' || state.phase === 'listening' || state.phase === 'looking') {
    const heard = Math.min(MAX_SECONDS, state.heard);
    return (
      <div className={`${CARD} flex items-center gap-4`} role="status" aria-live="polite">
        <span className="relative flex-shrink-0 grid place-items-center w-11 h-11 rounded-full bg-gradient-to-br from-[#ff4fd8] to-[#8b5cf6] text-white">
          {phase !== 'starting' && <span className="absolute inset-0 rounded-full bg-[#ff4fd8]/40 animate-ping" aria-hidden="true" />}
          <svg className="relative w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="22" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-white font-semibold leading-snug">
            {phase === 'starting' ? t('listen.starting') : phase === 'looking' ? t('listen.looking') : t('listen.listening')}
          </div>
          <p className="mt-0.5 text-sm text-white/60 leading-snug">{t('listen.hint')}</p>
          {phase === 'listening' && (
            <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
              <div className="h-full bg-white/50 transition-[width] duration-500" style={{ width: `${(heard / MAX_SECONDS) * 100}%` }} />
            </div>
          )}
        </div>
        {phase === 'listening' && <LevelBars meter={meter} />}
        <button type="button" className="btn btn-sm btn-ghost flex-shrink-0" onClick={onStop}>{t('listen.stop')}</button>
      </div>
    );
  }

  if (state.phase === 'found') {
    return (
      <div className={CARD}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="text-white font-semibold">{t('listen.found', { count: state.results.length })}</div>
          <button type="button" onClick={onClose} title={t('listen.close')} aria-label={t('listen.close')} className="btn-icon w-8 h-8 -mt-1 -mr-1 text-white/50">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="space-y-3">
          {state.results.map(r => <ResultRow key={r.songId} result={r} onOpen={onOpen} />)}
        </div>
      </div>
    );
  }

  const error = state.phase === 'error' ? state.error : undefined;
  const message = phase === 'none' ? t('listen.none')
    : error === 'denied' ? t('listen.denied')
    : error === 'noDevice' ? t('listen.noDevice')
    : error === 'rate' ? t('listen.rate')
    : t('listen.failed');
  return (
    <div className={`${CARD} flex flex-col sm:flex-row sm:items-center gap-3`} role="status">
      <div className="min-w-0 flex-1">
        <div className="text-white font-semibold leading-snug">{phase === 'none' ? t('listen.noneTitle') : t('listen.errorTitle')}</div>
        <p className="mt-0.5 text-sm text-white/60 leading-snug">{message}</p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {error !== 'denied' && error !== 'off' && (
          <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>{t('listen.retry')}</button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('listen.close')}</button>
      </div>
    </div>
  );
};

export default ListenPanel;
