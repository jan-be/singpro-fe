import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import JoinGameBox from "../components/JoinGameBox";
import SearchBar from "../components/SearchBar";
import WrapperPage from "./WrapperPage";
import MyIcon from "../icon.svg?react";
import { apiUrl, useLangPath } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";
import { loadPartySession, clearPartySession } from "./PartyPage";

// i18n locale code → USDB language name
const LOCALE_TO_LANGUAGE = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian',
  ja: 'Japanese', pl: 'Polish', nl: 'Dutch', pt: 'Portuguese', zh: 'Chinese',
  ko: 'Korean', hu: 'Hungarian', sv: 'Swedish', fi: 'Finnish', da: 'Danish',
  ru: 'Russian', tr: 'Turkish', cs: 'Czech', no: 'Norwegian', hr: 'Croatian',
  sl: 'Slovenian', hi: 'Hindi',
};

const PAGE_SIZE = 30;

// ── Fetcher functions ──────────────────────────────────────────────────
const fetchPage = async (category, offset) => {
  let url;
  if (category === 'recommended') {
    url = `${apiUrl}/recommended?offset=${offset}&limit=${PAGE_SIZE}`;
  } else if (category === 'popular') {
    url = `${apiUrl}/listens/popular?offset=${offset}&limit=${PAGE_SIZE}`;
  } else {
    // Language category — the value is the language name like "English"
    url = `${apiUrl}/songs/by-language/${encodeURIComponent(category)}?offset=${offset}&limit=${PAGE_SIZE}`;
  }
  const r = await fetch(url);
  const j = await r.json();
  return { songs: j.data || [], hasMore: j.hasMore ?? false };
};

// ── SongCard ───────────────────────────────────────────────────────────
const SongCard = ({ song }) => {
  const lp = useLangPath();
  const slug = urlEscapedTitle(song.artist, song.title);
  return (
    <Link
      to={lp(`/sing/${slug}/${song.songId}`)}
      className="group block rounded-xl overflow-hidden bg-surface-light border border-surface-lighter hover:border-neon-cyan/40 transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_25px_rgba(0,229,255,0.15)]"
    >
      <div className="relative aspect-video overflow-hidden bg-surface-lighter">
        {song.videoId ? (
          <img
            src={`https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
            alt={`${song.artist} - ${song.title}`}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-light/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>
      <div className="p-3">
        <div className="text-white font-medium text-sm truncate">{song.title}</div>
        <div className="text-gray-400 text-xs truncate">{song.artist}</div>
      </div>
    </Link>
  );
};

// ── CategoryPill ───────────────────────────────────────────────────────
const CategoryPill = ({ label, active, onClick, color = 'neon-cyan' }) => {
  const colorMap = {
    'neon-cyan':    { bg: 'bg-neon-cyan/15', border: 'border-neon-cyan/70', text: 'text-neon-cyan', glow: 'shadow-[0_0_12px_rgba(0,229,255,0.25)]' },
    'neon-magenta': { bg: 'bg-neon-magenta/15', border: 'border-neon-magenta/70', text: 'text-neon-magenta', glow: 'shadow-[0_0_12px_rgba(255,0,229,0.25)]' },
    'neon-green':   { bg: 'bg-neon-green/15', border: 'border-neon-green/70', text: 'text-neon-green', glow: 'shadow-[0_0_12px_rgba(0,255,100,0.25)]' },
  };
  const c = colorMap[color] || colorMap['neon-cyan'];

  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-200 cursor-pointer whitespace-nowrap ${
        active
          ? `${c.bg} ${c.border} ${c.text} ${c.glow}`
          : 'bg-surface-light border-surface-lighter text-gray-400 hover:text-gray-200 hover:border-gray-500'
      }`}
    >
      {label}
    </button>
  );
};

// ── InfiniteScrollGrid ─────────────────────────────────────────────────
const InfiniteScrollGrid = ({ category }) => {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const offsetRef = useRef(0);
  const sentinelRef = useRef(null);
  const categoryRef = useRef(category);
  const { t } = useTranslation();

  // Reset when category changes
  useEffect(() => {
    categoryRef.current = category;
    setSongs([]);
    setHasMore(true);
    setInitialLoad(true);
    offsetRef.current = 0;
  }, [category]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const currentCat = categoryRef.current;
      const result = await fetchPage(currentCat, offsetRef.current);
      // Guard against stale responses from a previous category
      if (currentCat !== categoryRef.current) return;
      setSongs(prev => [...prev, ...result.songs]);
      setHasMore(result.hasMore);
      offsetRef.current += result.songs.length;
    } catch (e) {
      console.error('[InfiniteScroll] fetch error', e);
      setHasMore(false);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [loading, hasMore]);

  // Load first page on mount / category change
  useEffect(() => {
    if (initialLoad) loadMore();
  }, [initialLoad, loadMore]);

  // IntersectionObserver on sentinel element
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loading && hasMore) loadMore(); },
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, hasMore, loadMore]);

  if (initialLoad) {
    return <div className="text-gray-400 text-center py-12 animate-pulse">{t('sections.loadingSongs')}</div>;
  }

  if (songs.length === 0 && !loading) {
    return <div className="text-gray-500 text-center py-12">{t('sections.noSongs')}</div>;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {songs.map(song => <SongCard key={song.songId} song={song} />)}
      </div>
      {/* Sentinel for triggering next page load */}
      <div ref={sentinelRef} className="h-1" />
      {loading && !initialLoad && (
        <div className="text-gray-400 text-center py-6 animate-pulse">{t('sections.loading')}</div>
      )}
    </>
  );
};

// ── LanguageDropdown ───────────────────────────────────────────────────
const LanguageDropdown = ({ languages, active, onSelect, userLang }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { t } = useTranslation();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter out the user's language (shown as a separate pill) and the top ones
  // shown directly as pills. This dropdown shows "More languages..."
  const isLangActive = languages.some(l => l.name === active);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-200 cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
          isLangActive
            ? 'bg-neon-green/15 border-neon-green/70 text-neon-green shadow-[0_0_12px_rgba(0,255,100,0.25)]'
            : 'bg-surface-light border-surface-lighter text-gray-400 hover:text-gray-200 hover:border-gray-500'
        }`}
      >
        {isLangActive ? active : t('sections.moreLanguages')}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 z-50 bg-surface-light border border-surface-lighter rounded-xl shadow-xl max-h-64 overflow-y-auto min-w-48">
          {languages.map(lang => (
            <button
              key={lang.name}
              onClick={() => { onSelect(lang.name); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer flex items-center justify-between gap-4 ${
                lang.name === active
                  ? 'text-neon-green bg-neon-green/10'
                  : 'text-gray-300 hover:bg-surface-lighter hover:text-white'
              } ${lang.name === userLang ? 'font-semibold' : ''}`}
            >
              <span>{lang.name}</span>
              <span className="text-xs text-gray-500">{lang.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── EntryPage ──────────────────────────────────────────────────────────
const EntryPage = () => {
  const { t, i18n } = useTranslation();
  const lp = useLangPath();
  const [joinOpen, setJoinOpen] = useState(false);
  const navigate = useNavigate();
  const [activeSession, setActiveSession] = useState(loadPartySession);
  const [category, setCategory] = useState('recommended');
  const [languages, setLanguages] = useState([]);

  const locale = i18n.language?.substring(0, 2);
  const userLang = LOCALE_TO_LANGUAGE[locale];

  // Fetch available languages on mount
  useEffect(() => {
    fetch(`${apiUrl}/songs/languages`)
      .then(r => r.json())
      .then(j => setLanguages(j.data || []))
      .catch(() => {});
  }, []);

  // Check if the saved party still exists on the server
  useEffect(() => {
    if (!activeSession?.partyId) return;
    fetch(`${apiUrl}/parties/${activeSession.partyId}`)
      .then(r => {
        if (!r.ok) {
          clearPartySession();
          setActiveSession(null);
        }
      })
      .catch(() => {});
  }, [activeSession?.partyId]);

  // Split languages: user's language gets its own pill, the rest go in the dropdown
  const userLangEntry = languages.find(l => l.name === userLang);
  const dropdownLangs = languages.filter(l => l.name !== userLang);

  return (
    <WrapperPage>

      {/* Hero */}
      <div className="text-center py-12 relative overflow-hidden">
        {/* Floating glow orbs */}
        <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-neon-cyan/8 blur-3xl animate-float pointer-events-none" />
        <div className="absolute -top-10 -right-20 w-60 h-60 rounded-full bg-neon-purple/10 blur-3xl animate-float-reverse pointer-events-none" />
        <div className="absolute -bottom-10 left-1/3 w-48 h-48 rounded-full bg-neon-magenta/8 blur-3xl animate-float pointer-events-none" style={{ animationDelay: '2s' }} />

        <div className="relative flex items-center justify-center gap-3 mb-4">
          <MyIcon width="55" height="55" />
          <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent leading-normal drop-shadow-[0_0_40px_rgba(0,229,255,0.3)]">
            singpro.app
          </h1>
        </div>
        <p className="text-xl text-gray-300 max-w-lg mx-auto relative">
          {t('hero.tagline')}
        </p>

        <div className="flex items-center justify-center mt-8 relative">
          <button
            onClick={() => setJoinOpen(!joinOpen)}
            className="px-8 py-3 rounded-lg bg-gradient-to-r from-neon-magenta/20 to-neon-purple/20 border border-neon-magenta/60 text-neon-magenta font-bold text-lg hover:from-neon-magenta/30 hover:to-neon-purple/30 hover:border-neon-magenta hover:shadow-[0_0_30px_rgba(255,0,229,0.3)] transition-all duration-300 cursor-pointer"
          >
            {t('hero.joinParty')}
          </button>
        </div>

        {joinOpen && (
          <div className="mt-6 max-w-md mx-auto">
            <JoinGameBox />
          </div>
        )}

        {/* Active party banner */}
        {activeSession && (
          <div className="mt-6 max-w-md mx-auto bg-surface-light rounded-lg border border-neon-cyan/30 p-4 flex items-center justify-between gap-4 shadow-[0_0_20px_rgba(0,229,255,0.08)]">
            <div className="text-left">
              <div className="text-xs text-gray-400 uppercase tracking-wider">{t('activeSession.label')}</div>
              <div className="text-neon-cyan font-mono font-bold text-lg">{activeSession.partyId}</div>
              <div className="text-gray-400 text-xs">
                {t('activeSession.asUser', {
                  username: activeSession.username,
                  role: activeSession.isHost ? t('activeSession.host') : t('activeSession.joiner'),
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    const r = await fetch(`${apiUrl}/parties/${activeSession.partyId}`);
                    if (!r.ok) {
                      clearPartySession();
                      setActiveSession(null);
                      return;
                    }
                  } catch { /* network error — let PartyPage handle it */ }
                  navigate(lp(`/sing/rejoin/none`), {
                    state: {
                      partyId: activeSession.partyId,
                      currentUserName: activeSession.username,
                      isHost: activeSession.isHost,
                    },
                  });
                }}
                className="px-4 py-2 rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 hover:border-neon-cyan/60 transition-all text-sm font-semibold cursor-pointer"
              >
                {t('activeSession.rejoin')}
              </button>
              <button
                onClick={() => {
                  clearPartySession();
                  setActiveSession(null);
                }}
                className="px-4 py-2 rounded-lg bg-surface-lighter text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-surface-lighter hover:border-red-500/40 transition-all text-sm cursor-pointer"
              >
                {t('activeSession.leave')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="mb-8">
        <SearchBar />
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <CategoryPill
          label={t('sections.recommended')}
          active={category === 'recommended'}
          onClick={() => setCategory('recommended')}
          color="neon-cyan"
        />
        <CategoryPill
          label={t('sections.popularAtParties')}
          active={category === 'popular'}
          onClick={() => setCategory('popular')}
          color="neon-magenta"
        />
        {userLangEntry && (
          <CategoryPill
            label={t('sections.songsInYourLanguage')}
            active={category === userLang}
            onClick={() => setCategory(userLang)}
            color="neon-green"
          />
        )}
        {dropdownLangs.length > 0 && (
          <LanguageDropdown
            languages={dropdownLangs}
            active={category}
            onSelect={setCategory}
            userLang={userLang}
          />
        )}
      </div>

      {/* Infinite scroll song grid */}
      <section className="mb-12">
        <InfiniteScrollGrid key={category} category={category} />
      </section>

    </WrapperPage>
  );
};

export default EntryPage;
