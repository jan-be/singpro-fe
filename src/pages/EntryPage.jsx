import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";
import JoinGameBox from "../components/JoinGameBox";
import SearchBar from "../components/SearchBar";
import LanguageSwitcher from "../components/LanguageSwitcher";
import SocialLinks from "../components/SocialLinks";
import { DuetIcon, StemsIcon } from "../components/Icons";
import WrapperPage from "./WrapperPage";
import Wordmark from "../components/Wordmark";
import { apiUrl } from "../GlobalConsts";
import { loadPartySession, clearPartySession } from "../logic/partySession";
import { useAuth } from "../logic/AuthContext";
import StarRating from "../components/StarRating";
import AiBadge from "../components/AiBadge";
import { trackSearch, trackPick, currentSearch, endSearch } from "../logic/track";
import { probeYouTube, inMainlandChinaTimeZone } from "../logic/youtubeReachable";

// i18n locale code → USDB language name
const LOCALE_TO_LANGUAGE = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian',
  ja: 'Japanese', pl: 'Polish', nl: 'Dutch', pt: 'Portuguese', zh: 'Mandarin',
  ko: 'Korean', hu: 'Hungarian', sv: 'Swedish', fi: 'Finnish', da: 'Danish',
  ru: 'Russian', tr: 'Turkish', cs: 'Czech', no: 'Norwegian', hr: 'Croatian',
  sl: 'Slovenian', hi: 'Hindi',
};

const PAGE_SIZE = 30;

// ── Filters ────────────────────────────────────────────────────────────
// One state drives the grid: the search text `q`, the ranking `sort` (ignored
// while searching — results are relevance-ranked) and the tag filters, which
// combine. It lives in the URL (?q=love&duet=1&language=German) so it survives
// reloads and can be shared.
const readFilters = (params) => ({
  q: (params.get('q') || '').trim() || null,
  sort: params.get('sort') === 'popular' ? 'popular' : 'recommended',
  duet: params.get('duet') === '1',
  stems: params.get('stems') === '1',
  language: params.get('language') || null,
});

const writeFilters = (params, filters) => {
  const next = new URLSearchParams(params);
  for (const key of ['q', 'sort', 'duet', 'stems', 'language']) next.delete(key);
  if (filters.q) next.set('q', filters.q);
  if (filters.sort === 'popular') next.set('sort', 'popular');
  if (filters.duet) next.set('duet', '1');
  if (filters.stems) next.set('stems', '1');
  if (filters.language) next.set('language', filters.language);
  return next;
};

/** Query string for /songs/browse (sort is meaningless while searching). */
const filtersToQuery = (filters) =>
  writeFilters(new URLSearchParams(), filters.q ? { ...filters, sort: 'recommended' } : filters).toString();

// ── Fetcher ────────────────────────────────────────────────────────────
const fetchPage = async (query, offset) => {
  const params = new URLSearchParams(query);
  params.set('offset', offset);
  params.set('limit', PAGE_SIZE);
  const r = await fetch(`${apiUrl}/songs/browse?${params}`);
  const j = await r.json();
  return { songs: j.data || [], hasMore: j.hasMore ?? false };
};

// ── HeroWall ───────────────────────────────────────────────────────────
// The wall the neon sign hangs on, as in the app icon: brick courses across
// the whole width, lit by the sign itself (pink from the S, cyan from "Pro")
// and fading into the page at the edges. Static SVG, painted once (no blur,
// no animation, no CSS mask).
const HeroWall = () => (
  <div className="absolute -top-10 bottom-0 left-1/2 -translate-x-1/2 w-screen -z-10 pointer-events-none" aria-hidden="true">
  <svg
    className="block w-full h-full"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <radialGradient id="hero-wall-base" cx="50%" cy="32%" r="64%">
        <stop offset="0" stopColor="#3a2a78" stopOpacity="0.95" />
        <stop offset="0.55" stopColor="#2a1f5c" stopOpacity="0.6" />
        <stop offset="1" stopColor="#1a1440" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hero-wall-pink" cx="37%" cy="30%" r="36%">
        <stop offset="0" stopColor="#ff4fd8" stopOpacity="0.42" />
        <stop offset="1" stopColor="#ff4fd8" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hero-wall-cyan" cx="64%" cy="30%" r="36%">
        <stop offset="0" stopColor="#00e5ff" stopOpacity="0.3" />
        <stop offset="1" stopColor="#00e5ff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hero-wall-fade" cx="50%" cy="36%" r="64%">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.55" stopColor="#fff" stopOpacity="0.7" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <mask id="hero-wall-mask">
        <rect width="100%" height="100%" fill="url(#hero-wall-fade)" />
      </mask>
      <pattern id="hero-wall-bricks" width="88" height="44" patternUnits="userSpaceOnUse" x="50%">
        <path d="M0 1H88M0 23H88M22 1V23M66 23V45" stroke="#0d0a24" strokeWidth="2.5" strokeOpacity="0.75" fill="none" />
      </pattern>
    </defs>
    <g mask="url(#hero-wall-mask)">
      <rect width="100%" height="100%" fill="url(#hero-wall-base)" />
      <rect width="100%" height="100%" fill="url(#hero-wall-pink)" />
      <rect width="100%" height="100%" fill="url(#hero-wall-cyan)" />
      <rect width="100%" height="100%" fill="url(#hero-wall-bricks)" />
    </g>
  </svg>
  </div>
);

// ── SongCard ───────────────────────────────────────────────────────────
const SongCard = ({ song, position, context }) => {
  const { best } = useAuth();
  const names = useSongNames()(song);
  const mine = best[song.songId]; // the signed-in user's best score on this song
  // A pick, with how the grid was showing it (a search, or browsing with sort and tags), for the admin page
  const picked = () => {
    const search = context?.q ? currentSearch('entry') : null;
    trackPick(context?.q ? 'search' : 'browse', {
      songId: song.songId, position,
      ...(context?.q ? { q: context.q } : {}), ...(search ? { searchId: search.id } : {}),
      sort: context?.sort, ...(context?.tags?.length ? { tags: context.tags } : {}), ...(context?.language ? { language: context.language } : {}),
    });
    if (search) endSearch('entry');
  };
  return (
    <Link
      to={`/sing/${song.songId}`}
      onClick={picked}
      className="group block rounded-2xl no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/70"
    >
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.1] transition-[box-shadow,transform] duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_18px_40px_-16px_rgba(255,79,216,0.5)] group-hover:ring-white/20">
        {song.videoId ? (
          <img
            src={`https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
            alt={`${names.artist} - ${names.title}`}
            className="w-full h-full object-cover scale-[1.01] group-hover:scale-[1.05] transition-transform duration-500 ease-out"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>
          </div>
        )}
        {/* the thumbnail's own edge, drawn over the picture */}
        <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 pointer-events-none" />
        {song.generated && <AiBadge look="pill" />}
        {(song.hasStems || song.isDuet) && (
          <div className="absolute top-2 right-2 flex items-center gap-1">
            {song.isDuet && (
              <span className="h-6 px-1.5 rounded-full bg-black/65 text-white flex items-center" title="Duet">
                <DuetIcon size={12} strokeWidth={2.2} />
              </span>
            )}
            {song.hasStems && (
              <span className="h-6 px-1.5 rounded-full bg-black/65 text-white flex items-center" title="Karaoke stems available">
                <StemsIcon size={12} strokeWidth={2.2} />
              </span>
            )}
          </div>
        )}
        {mine && (
          <div className="absolute bottom-2 left-2 h-6 px-2 rounded-full bg-black/70 flex items-center gap-1.5" title={mine.score.toLocaleString()}>
            <StarRating stars={mine.stars} size={11} />
            <span className="text-[11px] font-mono font-medium text-white/90 tabular-nums">{mine.score.toLocaleString()}</span>
          </div>
        )}
      </div>
      <div className="pt-2.5 px-0.5" lang={names.lang} title={names.roman}>
        <div className="text-white font-semibold text-[15px] leading-snug tracking-[-0.01em] truncate">{names.title}</div>
        <div className="text-white/50 text-[13px] leading-snug truncate">{names.artist}</div>
      </div>
    </Link>
  );
};

// ── CategoryPill ───────────────────────────────────────────────────────
// Chips are a little smaller on phones, where the pinned band must stay short
const CHIP_SIZE = 'h-8 px-3 text-[13px] sm:h-9 sm:px-[0.9rem] sm:text-sm';

// A combinable filter: quiet when off, lit pink when on
const CategoryPill = ({ label, icon, active, onClick }) => (
  <button type="button" onClick={onClick} aria-pressed={!!active} className={`chip ${CHIP_SIZE}`}>
    {icon}
    {label}
  </button>
);

// One column on phones, two on tablets, three on desktop
const GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-6 sm:gap-y-8';

const SongCardSkeleton = () => (
  <div aria-hidden="true">
    <div className="aspect-video rounded-2xl bg-white/[0.05] animate-pulse" />
    <div className="mt-3 h-3.5 w-3/4 rounded-full bg-white/[0.06] animate-pulse" />
    <div className="mt-2 h-3 w-1/2 rounded-full bg-white/[0.04] animate-pulse" />
  </div>
);

// ── InfiniteScrollGrid ─────────────────────────────────────────────────
// Shows one page of /songs/browse results and loads more as the sentinel
// scrolls into view. When `query` changes the first page is fetched and
// swapped in when it arrives — the previous cards stay visible meanwhile,
// so search-as-you-type does not flash an empty grid on every keystroke.
const InfiniteScrollGrid = ({ query, emptyMessage }) => {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const offsetRef = useRef(0);
  const queryRef = useRef(query);
  const inFlightRef = useRef(null); // token of the request in flight, if any
  const sentinelRef = useRef(null);
  const { t } = useTranslation();

  const load = useCallback(async (q, offset, replace) => {
    const token = `${q}@${offset}`;
    inFlightRef.current = token;
    setLoading(true);
    try {
      const result = await fetchPage(q, offset);
      if (q !== queryRef.current) return; // a newer query took over
      if (offset === 0) {
        const typed = new URLSearchParams(q).get('q');
        if (typed) trackSearch('entry', { q: typed, results: result.songs.length, hasMore: result.hasMore });
      }
      setSongs(prev => {
        if (replace) return result.songs;
        const existing = new Set(prev.map(s => s.songId));
        return [...prev, ...result.songs.filter(s => !existing.has(s.songId))];
      });
      setHasMore(result.hasMore);
      offsetRef.current = offset + result.songs.length;
    } catch (e) {
      if (q !== queryRef.current) return;
      console.error('[InfiniteScroll] fetch error', e);
      if (replace) setSongs([]);
      setHasMore(false);
    } finally {
      if (inFlightRef.current === token) {
        inFlightRef.current = null;
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, []);

  // New query → fetch its first page
  useEffect(() => {
    queryRef.current = query;
    offsetRef.current = 0;
    setHasMore(true);
    load(query, 0, true);
  }, [query, load]);

  // Sentinel scrolled into view → next page
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !inFlightRef.current) {
          load(queryRef.current, offsetRef.current, false);
        }
      },
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, load, songs.length]);

  // What the grid is showing, for the pick events
  const context = useMemo(() => {
    const p = new URLSearchParams(query);
    return {
      q: p.get('q') || null,
      sort: p.get('sort') === 'popular' ? 'popular' : 'recommended',
      tags: [p.get('duet') === '1' && 'duet', p.get('stems') === '1' && 'stems', p.get('language') && 'language'].filter(Boolean),
      language: p.get('language') || null,
    };
  }, [query]);

  if (!loadedOnce) {
    // The grid's shape while the first page loads
    return (
      <div className={GRID} aria-busy="true" aria-label={t('sections.loadingSongs')}>
        {Array.from({ length: 6 }, (_, i) => <SongCardSkeleton key={i} />)}
      </div>
    );
  }

  if (songs.length === 0 && !loading) {
    return <div className="text-white/45 text-center py-12">{emptyMessage ?? t('sections.noSongs')}</div>;
  }

  return (
    <>
      <div className={`${GRID} transition-opacity duration-200 ${loading && songs.length > 0 ? 'opacity-60' : ''}`}>
        {songs.map((song, i) => <SongCard key={song.songId} song={song} position={i} context={context} />)}
      </div>
      {/* Sentinel for triggering next page load */}
      <div ref={sentinelRef} className="h-1" />
      {loading && (
        <div className="text-white/40 text-sm text-center py-6 animate-pulse">{t('sections.loading')}</div>
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

  // The user's own language has its own pill; this dropdown holds the rest.
  // `active` is the currently selected language name (or null = all).
  const isLangActive = languages.some(l => l.name === active);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`chip ${CHIP_SIZE} ${isLangActive ? 'is-on' : ''}`}
      >
        {isLangActive ? active : t('sections.moreLanguages')}
        <svg className={`w-3.5 h-3.5 -mr-0.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {open && (
        <div className="pop absolute top-full mt-2 left-0 z-50 p-1.5 max-h-72 overflow-y-auto min-w-52">
          <button
            type="button"
            onClick={() => { onSelect(null); setOpen(false); }}
            className={`menu-item ${!active ? 'bg-white/10 text-white' : ''}`}
          >
            {t('sections.allLanguages')}
          </button>
          <div className="my-1 h-px bg-white/8" aria-hidden="true" />
          {languages.map(lang => (
            <button
              type="button"
              key={lang.name}
              onClick={() => { onSelect(lang.name === active ? null : lang.name); setOpen(false); }}
              className={`menu-item justify-between gap-4 ${lang.name === active ? 'bg-white/10 text-white' : ''} ${lang.name === userLang ? 'font-semibold' : ''}`}
            >
              <span>{lang.name}</span>
              <span className="text-xs text-white/40 tabular-nums">{lang.count.toLocaleString()}</span>
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
  const [joinOpen, setJoinOpen] = useState(false);
  const navigate = useNavigate();
  // A joiner who comes back to the menu has left the party: choosing a song
  // here starts their own. A host keeps the party (the joiners wait), sees it
  // here with the code and who is connected, and just picks the next song.
  const [hostParty, setHostParty] = useState(() => {
    const s = loadPartySession();
    if (s && !s.isHost) { clearPartySession(); return null; }
    return s ? { partyId: s.partyId, username: s.username, connected: null } : null;
  });
  useEffect(() => {
    if (!hostParty?.partyId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${apiUrl}/parties/${hostParty.partyId}`);
        if (cancelled) return;
        if (r.status === 404) { clearPartySession(); setHostParty(null); return; } // closed meanwhile
        const j = await r.json();
        const players = j?.data?.players ?? [];
        const connected = players.filter(p => p.connected && p.username !== j.data.owner).length;
        setHostParty(h => (h && h.connected !== connected ? { ...h, connected } : h));
      } catch { /* keep the last count */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [hostParty?.partyId]);
  const endHostParty = async () => {
    const p = hostParty;
    setHostParty(null);
    clearPartySession();
    try {
      await fetch(`${apiUrl}/parties/${p.partyId}/close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: p.username }),
      });
    } catch { /* the sweep closes it eventually */ }
  };
  // Why the party page sent us here (the host ended the party / stayed gone)
  const location = useLocation();
  const [partyNotice, setPartyNotice] = useState(location.state?.partyNotice ?? null);
  useEffect(() => {
    if (location.state?.partyNotice) navigate(location.pathname + location.search, { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [searchParams, setSearchParams] = useSearchParams();
  const [languages, setLanguages] = useState([]);

  const filters = readFilters(searchParams);
  const query = filtersToQuery(filters);
  const hasFilters = filters.duet || filters.stems || Boolean(filters.language);
  const updateFilters = (patch) =>
    setSearchParams(writeFilters(searchParams, { ...filters, ...patch }), { replace: true });

  const locale = i18n.language?.substring(0, 2);
  const userLang = LOCALE_TO_LANGUAGE[locale];

  // Fetch available languages on mount
  useEffect(() => {
    fetch(`${apiUrl}/songs/languages`)
      .then(r => r.json())
      .then(j => setLanguages(j.data || []))
      .catch(() => {});
  }, []);

  // Split languages: user's language gets its own pill, the rest go in the dropdown
  const userLangEntry = languages.find(l => l.name === userLang);
  const dropdownLangs = languages.filter(l => l.name !== userLang);

  // The search band is pinned once the spot it started in has scrolled away
  const pinSentinelRef = useRef(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const el = pinSentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([entry]) => setPinned(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Mainland China blocks YouTube, so no song would start there: visitors on
  // its clock are told before they pick one (if YouTube is out of reach)
  const [youtubeBlocked, setYoutubeBlocked] = useState(false);
  useEffect(() => {
    if (!inMainlandChinaTimeZone()) return undefined;
    let gone = false;
    probeYouTube().then(ok => { if (!gone) setYoutubeBlocked(!ok); });
    return () => { gone = true; };
  }, []);

  return (
    <>
    <WrapperPage hideFooter>

      {/* Hero: the neon sign on its brick wall, like the icon */}
      <div className="text-center pt-10 pb-12 sm:pt-14 sm:pb-16 relative isolate">
        <HeroWall />

        <div className="relative flex items-center justify-center mb-6">
          <h1 className="m-0 leading-none">
            <Wordmark height={104} className="max-w-full h-auto md:h-[140px] md:w-auto" />
          </h1>
        </div>
        <p className="text-[1.3rem] sm:text-2xl leading-snug font-medium tracking-[-0.015em] text-white/90 max-w-xl mx-auto text-balance relative">
          {t('hero.tagline')}
        </p>

        <div className="flex items-center justify-center mt-8 relative">
          <button
            onClick={() => setJoinOpen(!joinOpen)}
            aria-expanded={joinOpen}
            className="btn btn-primary btn-lg"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {t('hero.joinParty')}
          </button>
        </div>

        {joinOpen && (
          <div className="mt-6 max-w-md mx-auto">
            <JoinGameBox />
          </div>
        )}

        {/* The host's party is still on while they pick the next song — worth
            mentioning only while somebody is actually in it */}
        {hostParty && hostParty.connected >= 1 && (
          <div className="relative mt-6 max-w-md mx-auto rounded-2xl bg-panel border border-white/10 pl-4 pr-2.5 py-3 flex items-center justify-between gap-4">
            <div className="text-left min-w-0">
              <div className="text-white text-sm font-semibold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-neon-green flex-shrink-0" aria-hidden="true" />
                {t('party.stillOn', { code: hostParty.partyId })}
                <span className="text-white/50 font-normal">· {t('party.connectedCount', { count: hostParty.connected })}</span>
              </div>
              <div className="text-white/50 text-xs mt-0.5">{t('party.pickNextHint')}</div>
            </div>
            <button
              type="button"
              onClick={endHostParty}
              className="btn btn-sm btn-ghost hover:text-red-300 hover:bg-red-500/10 flex-shrink-0"
            >
              {t('party.endParty')}
            </button>
          </div>
        )}

        {/* Why the party page sent us here */}
        {partyNotice && (
          <div className="relative mt-6 max-w-md mx-auto rounded-2xl bg-panel border border-white/10 pl-4 pr-2 py-2.5 flex items-center justify-between gap-4 text-sm text-white/80">
            <span className="text-left">{partyNotice === 'ended' ? t('party.endedNotice') : t('party.hostLeftNotice')}</span>
            <button type="button" onClick={() => setPartyNotice(null)} className="btn-icon w-8 h-8 text-white/50" aria-label="close">✕</button>
          </div>
        )}

        {youtubeBlocked && (
          <div role="status" className="relative mt-6 max-w-md mx-auto rounded-2xl bg-panel border border-white/10 px-4 py-3 text-sm text-white/80 text-pretty">
            {t('party.youtubeBlocked')}
          </div>
        )}
      </div>

      {/* Search and filters stay at the top while the grid scrolls under them.
          A band across the whole width, tinted only once it is pinned (the
          sentinel above it has left the screen). */}
      <div ref={pinSentinelRef} aria-hidden="true" />
      <div className={`sticky top-0 z-30 mx-[calc(50%-50vw)] px-[calc(50vw-50%)] pt-3 pb-3 mb-4 transition-[background-color,border-color,box-shadow] duration-200 border-b ${
        pinned ? "bg-ink/85 backdrop-blur-md border-white/[0.08] shadow-[0_12px_30px_-18px_rgba(0,0,0,0.8)]" : "border-transparent"
      }`}>
      {/* Search — drives the grid below via the q filter */}
      <div className="mb-3 sm:mb-4">
        <SearchBar value={filters.q ?? ''} onChange={(q) => updateFilters({ q: q || null })} />
      </div>

      {/* Filter pills (combinable tags) + sort */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <CategoryPill
          label={t('sections.duets')}
          icon={<DuetIcon />}
          active={filters.duet}
          onClick={() => updateFilters({ duet: !filters.duet })}
          color="neon-purple"
        />
        <CategoryPill
          label={t('sections.instrumental')}
          icon={<StemsIcon />}
          active={filters.stems}
          onClick={() => updateFilters({ stems: !filters.stems })}
          color="neon-purple"
        />
        {userLangEntry && (
          <CategoryPill
            label={t('sections.songsInYourLanguage')}
            active={filters.language === userLang}
            onClick={() => updateFilters({ language: filters.language === userLang ? null : userLang })}
            color="neon-green"
          />
        )}
        {dropdownLangs.length > 0 && (
          <LanguageDropdown
            languages={dropdownLangs}
            active={filters.language}
            onSelect={(name) => updateFilters({ language: name })}
            userLang={userLang}
          />
        )}
        {hasFilters && (
          <button
            type="button"
            onClick={() => updateFilters({ duet: false, stems: false, language: null })}
            className="ml-1 text-sm text-white/45 hover:text-white underline decoration-white/20 underline-offset-4 transition-colors cursor-pointer"
          >
            {t('sections.clearFilters')}
          </button>
        )}

        {/* Sort — relevance takes over while searching, so it is disabled then */}
        <label
          className={`ml-auto flex items-center gap-2 text-sm text-white/45 ${filters.q ? 'opacity-40' : ''}`}
          title={filters.q ? t('sections.sortedByRelevance') : undefined}
        >
          <span className="hidden sm:inline">{t('sections.sortBy')}</span>
          {/* Phones: a round sort button (the native picker still opens on tap), so
              the pinned band keeps to two rows in every language */}
          <span className="relative">
            <select
              value={filters.sort}
              disabled={Boolean(filters.q)}
              onChange={(e) => updateFilters({ sort: e.target.value })}
              style={{ colorScheme: 'dark' }}
              aria-label={t('sections.sortBy')}
              title={filters.sort === 'popular' ? t('sections.popularAtParties') : t('sections.recommended')}
              className={`chip ${CHIP_SIZE} appearance-none pr-8! disabled:cursor-not-allowed max-sm:w-8 max-sm:p-0! max-sm:text-transparent`}
            >
              <option value="recommended">{t('sections.recommended')}</option>
              <option value="popular">{t('sections.popularAtParties')}</option>
            </select>
            <svg className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
            <svg className="sm:hidden absolute inset-0 m-auto w-4 h-4 text-white/80 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
            </svg>
          </span>
        </label>
      </div>
      </div>

      {/* Song grid — search results or the browse list, same component */}
      <section className="mb-6 pb-20 sm:pb-12">
        <InfiniteScrollGrid
          query={query}
          emptyMessage={filters.q ? t('search.noResults', { query: filters.q }) : undefined}
        />
      </section>

    </WrapperPage>

    {/* Fixed footer: compliance links, SingPro elsewhere, the language switcher.
        One line where it fits; on narrow phones the links take a line of their own */}
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-ink/80 backdrop-blur-md border-t border-white/[0.06]">
      <div className="flex flex-wrap justify-center items-center gap-x-4 sm:gap-x-6 gap-y-0 px-4 py-1 text-xs sm:text-[13px]">
        <div className="flex items-center gap-4 sm:gap-6">
          <Link to="/privacy-policy" className="text-white/45 hover:text-white transition-colors">
            {t('footer.privacyPolicy')}
          </Link>
          <Link to="/tos" className="text-white/45 hover:text-white transition-colors">
            {t('footer.termsOfService')}
          </Link>
          <Link to="/contact" className="text-white/45 hover:text-white transition-colors">
            {t('footer.contact')}
          </Link>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <SocialLinks size={15} />
          <span className="w-px h-3.5 bg-white/15" aria-hidden="true" />
          <LanguageSwitcher />
        </div>
      </div>
    </div>
    </>
  );
};

export default EntryPage;
