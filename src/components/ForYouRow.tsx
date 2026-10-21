import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";
import { useAuth } from "../logic/AuthContext";
import { useSongNames } from "../logic/useSongNames";
import { historySongIds } from "../logic/partyHistory";
import { trackPick } from "../logic/track";
import { languageLabel } from "../logic/languageName";
import { DuetIcon } from "./Icons";
import type { TFunction } from "i18next";
import type { SongNamesSource } from "../logic/lyricsScripts";

/** A song of the row (backend recommendations.ts): the song card, and why it is here */
export interface ForYouSong extends SongNamesSource {
  songId: string;
  videoId: string;
  isDuet?: boolean;
  /** 'together' | 'artist' (from `because`), else the language's popular songs */
  reason?: string;
  /** the song of theirs it comes from */
  because?: SongNamesSource | null;
}

/** A song's names as this viewer reads them (useSongNames) */
type NamesOf = ReturnType<typeof useSongNames>;

const HIDE_KEY = 'singspree_for_you';
/** Fewer than this says too little to make a row of */
const MIN_SONGS = 4;

const storedGuestId = () => {
  try { return localStorage.getItem('singspree_guest'); } catch { return null; }
};

/** Phones scroll the whole row; wider screens show one line of 4 (6 on wide ones) */
const wideClass = (i: number) => (i >= 6 ? 'sm:hidden' : i >= 4 ? 'sm:hidden xl:block' : '');

/**
 * Why a song is here: the song of theirs it was sung with or shares an artist
 * with. One that is here for its language only (most of the row) says it is
 * popular in that language rather than pinning it on one song of theirs.
 */
function whyLine(song: ForYouSong, t: TFunction, names: NamesOf, locale: string) {
  if (song.because && (song.reason === 'together' || song.reason === 'artist')) return t('forYou.because', { song: names(song.because).title });
  return song.language ? `${t('forYou.popular')} · ${languageLabel(song.language, locale)}` : t('forYou.popular');
}

interface ForYouCardProps {
  song: ForYouSong;
  /** its place in the row, 0 first */
  position: number;
}

const ForYouCard = ({ song, position }: ForYouCardProps) => {
  const { t, i18n } = useTranslation();
  const names = useSongNames();
  const own = names(song);
  return (
    <Link
      to={`/sing/${song.songId}`}
      onClick={() => trackPick('for-you', { songId: song.songId, position })}
      className={`group block w-[180px] sm:w-auto flex-shrink-0 snap-start rounded-xl no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/70 ${wideClass(position)}`}
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.1] transition-transform duration-300 group-hover:-translate-y-0.5">
        <img
          src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`}
          alt={`${own.artist} - ${own.title}`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {song.isDuet && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
            <span className="h-5 px-1 rounded-full bg-black/65 text-white flex items-center"><DuetIcon size={11} strokeWidth={2.2} /></span>
          </div>
        )}
      </div>
      <div className="pt-2 px-0.5" lang={own.lang} title={own.roman}>
        <div className="text-white font-semibold text-[14px] leading-snug truncate">{own.title}</div>
        <div className="text-white/50 text-[12.5px] leading-snug truncate">{own.artist}</div>
        <div className="text-white/40 text-[12px] leading-snug line-clamp-2 mt-0.5" title={t(`forYou.reason.${song.reason}`, { defaultValue: '' }) || undefined}>
          {whyLine(song, t, names, i18n.language)}
        </div>
      </div>
    </Link>
  );
};

/**
 * "For you" above the entry page's grid, once this browser or account has
 * sung something: songs that go with theirs (backend recommendations.ts),
 * each with the song of theirs it comes from. Their own history only, and
 * the row can be hidden for good on this browser.
 */
export default function ForYouRow() {
  const { t } = useTranslation();
  // AuthContext's default value says user: null; signed in, it is the account
  const { user, loading } = useAuth();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === 'hidden'; } catch { return false; }
  });
  const [justHidden, setJustHidden] = useState(false);
  const [songs, setSongs] = useState<ForYouSong[] | null>(null);

  useEffect(() => {
    if (hidden || loading) return undefined;
    const local = historySongIds();
    const guestId = user ? null : storedGuestId(); // a browser that played before has one; none is made here
    if (!local.length && !user && !guestId) return undefined;
    let gone = false;
    fetch(`${apiUrl}/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs: local, ...(guestId ? { guestId } : {}), limit: 12 }),
    })
      .then(r => r.json())
      .then(j => { if (!gone) setSongs(j.data ?? []); })
      .catch(() => {});
    return () => { gone = true; };
  }, [hidden, loading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hide = (on: boolean) => {
    try { if (on) localStorage.setItem(HIDE_KEY, 'hidden'); else localStorage.removeItem(HIDE_KEY); } catch { /* this view only */ }
    setHidden(on);
    setJustHidden(on);
  };

  if (hidden) {
    if (!justHidden) return null;
    return (
      <div role="status" className="mb-6 text-sm text-white/50">
        {t('forYou.hidden')}{' '}
        <button type="button" onClick={() => hide(false)} className="text-white/80 hover:text-white underline decoration-white/30 underline-offset-4 cursor-pointer">
          {t('forYou.show')}
        </button>
      </div>
    );
  }
  if (!songs || songs.length < MIN_SONGS) return null;

  return (
    <section className="mb-8 sm:mb-10" aria-labelledby="for-you-title">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div className="min-w-0">
          <h2 id="for-you-title" className="m-0 text-white text-lg sm:text-xl font-semibold tracking-[-0.01em]">{t('forYou.title')}</h2>
          <p className="m-0 mt-0.5 text-white/45 text-[13px]">{t('forYou.explain')}</p>
        </div>
        <button
          type="button"
          onClick={() => hide(true)}
          className="flex-shrink-0 text-sm text-white/45 hover:text-white underline decoration-white/20 underline-offset-4 transition-colors cursor-pointer"
        >
          {t('forYou.hide')}
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:scroll-px-0 sm:pb-0 sm:overflow-visible sm:grid sm:grid-cols-4 xl:grid-cols-6 sm:gap-4 [scrollbar-width:none]">
        {songs.map((s, i) => <ForYouCard key={s.songId} song={s} position={i} />)}
      </div>
    </section>
  );
}
