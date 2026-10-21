import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import StarRating from "./StarRating";
import { useAuth } from "../logic/AuthContext";
import { useSongNames } from "../logic/useSongNames";
import { achievementInfo } from "../logic/achievements";
import { completionText } from "../logic/scoreScale";
import { loadSaveRecordings } from "../logic/takes";
import { loadRecap, nightSummary, takeSource, type PartyRecapData } from "../logic/partyRecap";
import type { SongNamesSource } from "../logic/lyricsScripts";

/** Why the party page sent the joiner home (party:closed), and from which party */
export interface PartyRecapInfo {
  partyId: string;
  /** 'ended' by the host, else the host stayed gone */
  reason: string;
}

export interface PartyRecapProps {
  recap: PartyRecapInfo;
  onClose: () => void;
}

/** The take the player has, and what it is doing with it */
type PlayerNow = { id: string; state: 'loading' | 'playing' | 'paused' | 'error' };

/**
 * What a joiner's phone shows when the party is over (the host ended it, or
 * stayed gone): their night there — the songs they sang with score and
 * stars, the best of them, the achievements those songs earned, and the
 * recordings they kept (when "Save recordings" is on) to listen to — and
 * what comes next: hosting a party of their own, and for a guest keeping
 * the night with an account (signing up hands the browser's scores,
 * recordings and achievements to it, routes/auth.js).
 *
 * `recap`: { partyId, reason } from the party page (party:closed). The
 * night is loaded from what the party left saved (logic/partyRecap.js); a
 * play stopped by the party closing is saved a moment later, so a night
 * that looks short is asked for once more.
 */
const LOOK_AGAIN_MS = 3000;

const PlayIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" /></svg>;
const PauseIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>;
const Spinner = () => <span aria-hidden="true" className="block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />;

/** One <audio> for the night's takes: toggle(take) plays, pauses or switches; now = { id, state } */
function useTakePlayer(partyId: string, keptBy: PartyRecapData['keptBy'] | undefined) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<{ src: string; revoke: () => void } | null>(null);
  const [now, setNow] = useState<PlayerNow | null>(null);
  const stop = useCallback(() => {
    audioRef.current?.pause();
    sourceRef.current?.revoke();
    sourceRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const toggle = useCallback(async (id: string) => {
    const audio = audioRef.current ?? (audioRef.current = new Audio());
    if (now?.id === id && now.state === 'playing') { audio.pause(); setNow({ id, state: 'paused' }); return; }
    if (now?.id === id && now.state === 'paused') { audio.play().then(() => setNow({ id, state: 'playing' }), () => setNow({ id, state: 'error' })); return; }
    stop();
    setNow({ id, state: 'loading' });
    try {
      const source = await takeSource(partyId, id, { keptBy: keptBy! }); // (takes show once the night is loaded)
      sourceRef.current = source;
      audio.src = source.src;
      audio.onended = () => setNow(n => (n?.id === id ? null : n));
      await audio.play();
      setNow(n => (n?.id === id ? { id, state: 'playing' } : n));
    } catch {
      setNow(n => (n?.id === id ? { id, state: 'error' } : n));
    }
  }, [now, partyId, keptBy, stop]);
  return { now, toggle };
}

const PartyRecap = ({ recap, onClose }: PartyRecapProps) => {
  const { t, i18n } = useTranslation();
  const namesOf = useSongNames();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [night, setNight] = useState<PartyRecapData | null | undefined>(undefined); // undefined while loading, null when it could not be loaded
  const showTakes = loadSaveRecordings();
  const player = useTakePlayer(recap.partyId, night?.keptBy);
  // below the home page's hero on a phone: brought into view
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    loadRecap(recap.partyId).then(first => {
      if (!active) return;
      setNight(first);
      // the song the party closed on is saved as it stops, a moment after the page heard
      timer = setTimeout(() => {
        loadRecap(recap.partyId).then(again => {
          if (active && again && (again.songs?.length ?? 0) > (first?.songs?.length ?? 0)) setNight(again);
        });
      }, LOOK_AGAIN_MS);
    });
    return () => { active = false; clearTimeout(timer!); }; // (null clears nothing; the DOM lib takes no null)
  }, [recap.partyId]);

  const summary = nightSummary(night);
  const notice = recap.reason === 'ended' ? t('party.endedNotice') : t('party.hostLeftNotice');
  const fmt = (n: number) => Number(n).toLocaleString(i18n.language);
  const guest = night?.keptBy === 'guest' || (!night && !user);
  const achievements = (night?.achievements ?? []).map(achievementInfo).filter(Boolean) as NonNullable<ReturnType<typeof achievementInfo>>[]; // filter(Boolean) left out the unknown keys' nulls

  const hostOwn = () => {
    onClose();
    // the home page is where a party starts: its search, ready to pick a song
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLInputElement>('input[type="search"]');
      box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      box?.focus({ preventScroll: true });
    });
  };

  return (
    <section ref={sectionRef} data-party-recap="" aria-labelledby="party-recap-title"
      className="relative scroll-mt-4 mt-6 max-w-md mx-auto text-left rounded-3xl bg-panel border border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] p-5 sm:p-6">
      <button type="button" onClick={onClose} className="btn-icon w-8 h-8 text-white/50 absolute right-3 top-3" aria-label={t('share.close')}>✕</button>
      <h2 id="party-recap-title" className="text-2xl font-semibold tracking-[-0.02em] text-white pr-8">{t('party.recap.title')}</h2>
      <p className="mt-1 text-sm text-white/60 text-pretty">{notice}</p>

      {night === undefined ? (
        <div className="mt-5 h-24 rounded-2xl bg-white/[0.05] animate-pulse" aria-hidden="true" />
      ) : summary.sung > 0 && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white/[0.05] border border-white/[0.08] px-4 py-3">
              <div className="text-2xl font-semibold text-white tabular-nums">{summary.sung}</div>
              <div className="text-xs text-white/55">{t('party.recap.songs')}</div>
            </div>
            <div className="rounded-2xl bg-white/[0.05] border border-white/[0.08] px-4 py-3">
              {summary.best ? (
                <>
                  <div className="text-2xl font-semibold text-white tabular-nums">{fmt(summary.best.score)}</div>
                  <StarRating stars={summary.best.stars} size={14} className="mt-0.5" />
                  <div className="text-xs text-white/55 mt-0.5">{t('party.recap.best')}</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-semibold text-white/50">–</div>
                  <div className="text-xs text-white/55">{t('party.recap.best')}</div>
                </>
              )}
            </div>
          </div>

          <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t('party.recap.yourSongs')}</h3>
          <ul className="space-y-1.5">
            {night!.songs.map((s) => {
              const names = namesOf(s as SongNamesSource); // (a null title reads as none; SongNamesSource leaves null out)
              const take = showTakes ? s.takes?.[0] : null;
              const state = take && player.now?.id === take.id ? player.now.state : null;
              const label = state === 'playing' ? t('profile.pauseRecording') : state === 'error' ? t('profile.recordingFailed') : t('profile.playRecording');
              return (
                <li key={s.scoreId} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2">
                  {s.videoId
                    ? <img src={`https://i.ytimg.com/vi/${s.videoId}/default.jpg`} alt="" className="w-12 h-9 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                    : <div className="w-12 h-9 rounded-lg bg-white/[0.06] flex-shrink-0" aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate" lang={names.lang}>{names.title}</div>
                    <div className="text-xs text-white/50 truncate" lang={names.lang}>{names.artist}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-white tabular-nums">{fmt(s.score)}</div>
                    {s.partial
                      ? <div className="text-[11px] text-white/45">{t('profile.stoppedAt', { percent: completionText(s.completion ?? 0, i18n.language) })}</div>
                      : <StarRating stars={s.stars} size={11} />}
                  </div>
                  {take && (
                    <button type="button" onClick={() => player.toggle(take.id)} aria-label={label} title={label} data-recap-play=""
                      className={`btn-icon w-9 h-9 flex-shrink-0 ${state === 'error' ? 'text-red-300' : state ? 'text-hot' : ''}`}>
                      {state === 'loading' ? <Spinner /> : state === 'playing' ? <PauseIcon /> : <PlayIcon />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {achievements.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/50">
                {guest ? t('party.recap.achievementsGuest') : t('party.recap.achievements')}
              </h3>
              <ul className="flex flex-wrap gap-2">
                {achievements.map(a => (
                  <li key={a.key} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] pl-2 pr-3 py-1 text-sm text-white">
                    <span aria-hidden="true">{a.icon}</span>{a.name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={hostOwn} className="btn btn-primary btn-lg w-full" data-recap-host="">
          {t('party.recap.host')}
        </button>
        <p className="text-xs text-white/50 text-center text-pretty">{t('party.recap.hostHint')}</p>
        {summary.sung > 0 && (guest ? (
          <>
            <button type="button" onClick={() => navigate('/register?next=%2Fme')} className="btn btn-ghost btn-lg w-full mt-2" data-recap-keep="">{t('party.recap.keep')}</button>
            <p className="text-xs text-white/50 text-center text-pretty">{t('party.recap.keepHint')}</p>
          </>
        ) : user && (
          <Link to={`/u/${encodeURIComponent(user.username)}`} className="btn btn-ghost btn-lg w-full mt-2">{t('party.recap.profile')}</Link>
        ))}
      </div>
    </section>
  );
};

export default PartyRecap;
