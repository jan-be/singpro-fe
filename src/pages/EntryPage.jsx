import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import JoinGameBox from "../components/JoinGameBox";
import SearchBar from "../components/SearchBar";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { DuetIcon, StemsIcon } from "../components/Icons";
import WrapperPage from "./WrapperPage";
import MyIcon from "../icon.svg?react";
import { apiUrl } from "../GlobalConsts";
import { loadPartySession, clearPartySession } from "./PartyPage";
import { useAuth } from "../logic/AuthContext";
import StarRating from "../components/StarRating";

// i18n locale code → USDB language name
const LOCALE_TO_LANGUAGE = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian',
  ja: 'Japanese', pl: 'Polish', nl: 'Dutch', pt: 'Portuguese', zh: 'Chinese',
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

// ── SongCard ───────────────────────────────────────────────────────────
const SongCard = ({ song }) => {
  const { best } = useAuth();
  const mine = best[song.songId]; // the signed-in user's best score on this song
  return (
    <Link
      to={`/sing/${song.songId}`}
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
        {song.hasStems && (
          <div className="absolute top-1.5 right-1.5 bg-neon-purple/80 text-white rounded px-1 py-0.5 flex items-center" title="Karaoke stems available">
            <StemsIcon size={10} strokeWidth={2.5} />
          </div>
        )}
        {song.isDuet && (
          <div className={`absolute top-1.5 ${song.hasStems ? 'right-14' : 'right-1.5'} bg-neon-magenta/80 text-white rounded px-1.5 py-0.5 flex items-center`} title="Duet">
            <DuetIcon size={10} strokeWidth={2.5} />
          </div>
        )}
        {mine && (
          <div className="absolute bottom-1.5 left-1.5 bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5 flex items-center gap-1" title={mine.score.toLocaleString()}>
            <StarRating stars={mine.stars} size={11} />
            <span className="text-[10px] font-mono text-gray-200">{mine.score.toLocaleString()}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-white font-medium text-sm truncate">{song.title}</div>
        <div className="text-gray-400 text-xs truncate">{song.artist}</div>
      </div>
    </Link>
  );
};

// ── CategoryPill ───────────────────────────────────────────────────────
const CategoryPill = ({ label, icon, active, onClick, color = 'neon-cyan' }) => {
  const colorMap = {
    'neon-cyan':    { bg: 'bg-neon-cyan/15', border: 'border-neon-cyan/70', text: 'text-neon-cyan', glow: 'shadow-[0_0_12px_rgba(0,229,255,0.25)]' },
    'neon-magenta': { bg: 'bg-neon-magenta/15', border: 'border-neon-magenta/70', text: 'text-neon-magenta', glow: 'shadow-[0_0_12px_rgba(255,0,229,0.25)]' },
    'neon-green':   { bg: 'bg-neon-green/15', border: 'border-neon-green/70', text: 'text-neon-green', glow: 'shadow-[0_0_12px_rgba(0,255,100,0.25)]' },
    'neon-purple':  { bg: 'bg-neon-purple/15', border: 'border-neon-purple/70', text: 'text-neon-purple', glow: 'shadow-[0_0_12px_rgba(180,74,255,0.25)]' },
  };
  const c = colorMap[color] || colorMap['neon-cyan'];

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-200 cursor-pointer whitespace-nowrap ${
        active
          ? `${c.bg} ${c.border} ${c.text} ${c.glow}`
          : 'bg-surface-light border-surface-lighter text-gray-400 hover:text-gray-200 hover:border-gray-500'
      }`}
    >
      {icon}
      {label}
    </button>
  );
};

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

  if (!loadedOnce) {
    return <div className="text-gray-400 text-center py-12 animate-pulse">{t('sections.loadingSongs')}</div>;
  }

  if (songs.length === 0 && !loading) {
    return <div className="text-gray-500 text-center py-12">{emptyMessage ?? t('sections.noSongs')}</div>;
  }

  return (
    <>
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 transition-opacity duration-200 ${loading && songs.length > 0 ? 'opacity-60' : ''}`}>
        {songs.map(song => <SongCard key={song.songId} song={song} />)}
      </div>
      {/* Sentinel for triggering next page load */}
      <div ref={sentinelRef} className="h-1" />
      {loading && (
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

  // The user's own language has its own pill; this dropdown holds the rest.
  // `active` is the currently selected language name (or null = all).
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
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            className={`w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer border-b border-surface-lighter ${
              !active ? 'text-neon-green bg-neon-green/10' : 'text-gray-300 hover:bg-surface-lighter hover:text-white'
            }`}
          >
            {t('sections.allLanguages')}
          </button>
          {languages.map(lang => (
            <button
              key={lang.name}
              onClick={() => { onSelect(lang.name === active ? null : lang.name); setOpen(false); }}
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
  const { user: authUser, loading: authLoading } = useAuth();

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

  return (
    <>
    <WrapperPage hideFooter>

      {/* Hero */}
      <div className="text-center py-12 relative">
        {/* Floating glow orbs — extend to full page width/height */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
          <div className="absolute -top-20 -left-20 w-[40vw] h-[40vw] max-w-[600px] max-h-[600px] rounded-full bg-neon-cyan/8 blur-3xl animate-float" />
          <div className="absolute -top-10 right-0 w-[35vw] h-[35vw] max-w-[500px] max-h-[500px] rounded-full bg-neon-purple/10 blur-3xl animate-float-reverse" />
          <div className="absolute top-1/3 left-1/4 w-[30vw] h-[30vw] max-w-[400px] max-h-[400px] rounded-full bg-neon-magenta/8 blur-3xl animate-float" style={{ animationDelay: '2s' }} />
          <div className="absolute bottom-1/4 right-1/6 w-[25vw] h-[25vw] max-w-[350px] max-h-[350px] rounded-full bg-neon-cyan/5 blur-3xl animate-float-reverse" style={{ animationDelay: '4s' }} />
        </div>

        <div className="relative flex items-center justify-center gap-3 mb-4">
          <MyIcon width="55" height="55" />
          <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent leading-normal drop-shadow-[0_0_40px_rgba(0,229,255,0.3)]">
            singpro.app
          </h1>
        </div>
        <p className="text-xl text-gray-300 max-w-lg mx-auto relative">
          {t('hero.tagline')}
        </p>
        {!authLoading && !authUser && (
          <p className="text-sm text-gray-500 mt-2 relative">
            <Link to="/register" className="text-gray-400 hover:text-neon-cyan transition-colors">{t('auth.heroNudge')}</Link>
          </p>
        )}

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

        {/* The host's party is still on while they pick the next song — worth
            mentioning only while somebody is actually in it */}
        {hostParty && hostParty.connected >= 1 && (
          <div className="mt-6 max-w-md mx-auto bg-surface-light rounded-lg border border-neon-cyan/40 px-4 py-3 flex items-center justify-between gap-4 shadow-[0_0_20px_rgba(0,229,255,0.1)]">
            <div className="text-left min-w-0">
              <div className="text-white text-sm font-semibold">
                {t('party.stillOn', { code: hostParty.partyId })}
                <span className="ml-2 text-neon-cyan font-normal">· {t('party.connectedCount', { count: hostParty.connected })}</span>
              </div>
              <div className="text-gray-400 text-xs mt-0.5">{t('party.pickNextHint')}</div>
            </div>
            <button
              type="button"
              onClick={endHostParty}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-surface-lighter text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-surface-lighter hover:border-red-500/40 transition-all text-sm cursor-pointer"
            >
              {t('party.endParty')}
            </button>
          </div>
        )}

        {/* Why the party page sent us here */}
        {partyNotice && (
          <div className="mt-6 max-w-md mx-auto bg-surface-light rounded-lg border border-surface-lighter px-4 py-3 flex items-center justify-between gap-4 text-sm text-gray-300">
            <span>{partyNotice === 'ended' ? t('party.endedNotice') : t('party.hostLeftNotice')}</span>
            <button type="button" onClick={() => setPartyNotice(null)} className="text-gray-500 hover:text-white cursor-pointer" aria-label="close">✕</button>
          </div>
        )}
      </div>

      {/* Search — drives the grid below via the q filter */}
      <div className="mb-8">
        <SearchBar value={filters.q ?? ''} onChange={(q) => updateFilters({ q: q || null })} />
      </div>

      {/* Filter pills (combinable tags) + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
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
            onClick={() => updateFilters({ duet: false, stems: false, language: null })}
            className="ml-1 text-xs text-gray-500 hover:text-neon-cyan transition-colors cursor-pointer"
          >
            {t('sections.clearFilters')}
          </button>
        )}

        {/* Sort — relevance takes over while searching, so it is disabled then */}
        <label
          className={`ml-auto flex items-center gap-1.5 text-xs text-gray-500 ${filters.q ? 'opacity-40' : ''}`}
          title={filters.q ? t('sections.sortedByRelevance') : undefined}
        >
          <span>{t('sections.sortBy')}</span>
          <select
            value={filters.sort}
            disabled={Boolean(filters.q)}
            onChange={(e) => updateFilters({ sort: e.target.value })}
            style={{ colorScheme: 'dark' }}
            className="bg-surface-light border border-surface-lighter rounded-md px-2 py-1 text-xs text-gray-300 cursor-pointer focus:outline-none focus:border-neon-cyan/60 disabled:cursor-not-allowed"
          >
            <option value="recommended">{t('sections.recommended')}</option>
            <option value="popular">{t('sections.popularAtParties')}</option>
          </select>
        </label>
      </div>

      {/* Song grid — search results or the browse list, same component */}
      <section className="mb-6 pb-10">
        <InfiniteScrollGrid
          query={query}
          emptyMessage={filters.q ? t('search.noResults', { query: filters.q }) : undefined}
        />
      </section>

    </WrapperPage>

    {/* Fixed footer — single bottom bar with compliance links + language switcher */}
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface/80 backdrop-blur-sm border-t border-surface-lighter">
      <div className="flex justify-center items-center gap-4 sm:gap-6 px-4 py-1.5 text-xs sm:text-sm">
        <Link to="/privacy-policy" className="text-gray-500 hover:text-neon-cyan transition-colors">
          {t('footer.privacyPolicy')}
        </Link>
        <Link to="/tos" className="text-gray-500 hover:text-neon-cyan transition-colors">
          {t('footer.termsOfService')}
        </Link>
        <Link to="/contact" className="text-gray-500 hover:text-neon-cyan transition-colors">
          {t('footer.contact')}
        </Link>
        <span className="text-surface-lighter">|</span>
        <LanguageSwitcher />
      </div>
    </div>
    </>
  );
};

export default EntryPage;
