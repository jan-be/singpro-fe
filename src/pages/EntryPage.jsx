import React, { Suspense, use, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import JoinGameBox from "../components/JoinGameBox";
import SearchBar from "../components/SearchBar";
import WrapperPage from "./WrapperPage";
import MyIcon from "../icon.svg?react";
import { apiUrl, useLangPath } from "../GlobalConsts";
import { urlEscapedTitle, shuffle } from "../logic/RandomUtility";
import { loadPartySession, clearPartySession } from "./PartyPage";

// Module-level cached promises — but invalidated every CACHE_MS so returning
// to the main page after being elsewhere refreshes the Recommended/Popular lists
// instead of showing the same stale data from the initial page load.
const CACHE_MS = 30_000;
let recommendedCache = { at: 0, promise: null };
let popularCache = { at: 0, promise: null };

const getRecommended = () => {
  const now = Date.now();
  if (!recommendedCache.promise || now - recommendedCache.at > CACHE_MS) {
    recommendedCache = {
      at: now,
      promise: fetch(`${apiUrl}/recommended`).then(r => r.json()).then(j => j.data),
    };
  }
  return recommendedCache.promise;
};
const getPopular = () => {
  const now = Date.now();
  if (!popularCache.promise || now - popularCache.at > CACHE_MS) {
    popularCache = {
      at: now,
      promise: fetch(`${apiUrl}/listens/popular`).then(r => r.json()).then(j => j.data),
    };
  }
  return popularCache.promise;
};

const SongCard = ({ song }) => {
  const lp = useLangPath();
  const slug = urlEscapedTitle(song.artist, song.title);
  return (
    <Link
      to={lp(`/sing/${slug}/${song.songId}`)}
      className="group block rounded-lg overflow-hidden bg-surface-light hover:bg-surface-lighter transition-all hover:scale-[1.03] hover:shadow-[0_0_20px_rgba(0,229,255,0.2)]"
    >
      <div className="relative aspect-video overflow-hidden">
        <img
          src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`}
          alt={`${song.artist} - ${song.title}`}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
      <div className="p-3">
        <div className="text-white font-medium text-sm truncate">{song.title}</div>
        <div className="text-gray-400 text-xs truncate">{song.artist}</div>
      </div>
    </Link>
  );
};

const RecommendedSongs = ({ promise }) => {
  const songs = use(promise);
  // Shuffle once per mount so users see a different order each time they visit
  // the main page — avoids always clicking the same top songs.
  const shuffled = React.useMemo(() => shuffle(songs), [songs]);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {shuffled.map((song, i) => <SongCard key={i} song={song} />)}
    </div>
  );
};

const PopularSongs = ({ promise }) => {
  const songs = use(promise);
  if (!songs || songs.length === 0) return null;
  const shuffled = React.useMemo(() => shuffle(songs), [songs]);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {shuffled.map((song, i) => <SongCard key={i} song={song} />)}
    </div>
  );
};

const EntryPage = () => {
  const { t } = useTranslation();
  const lp = useLangPath();
  const [joinOpen, setJoinOpen] = useState(false);
  const navigate = useNavigate();
  const [activeSession, setActiveSession] = useState(loadPartySession);

  // Resolve the cached promises once per mount. The cache is invalidated after
  // 30s so returning to the main page refreshes the lists instead of showing
  // stale data forever (previously module-scoped promises only fired once per
  // full page load).
  const recommendedPromise = React.useMemo(() => getRecommended(), []);
  const popularPromise = React.useMemo(() => getPopular(), []);

  // Check if the saved party still exists on the server
  useEffect(() => {
    if (!activeSession?.partyId) return;
    fetch(`${apiUrl}/parties/${activeSession.partyId}`)
      .then(r => {
        if (!r.ok) {
          // Party no longer exists on the server — clear stale session
          clearPartySession();
          setActiveSession(null);
        }
      })
      .catch(() => {});
  }, [activeSession?.partyId]);

  return (
    <WrapperPage>

      {/* Hero */}
      <div className="text-center py-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <MyIcon width="55" height="55" />
          <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent pb-1">
            singpro.app
          </h1>
        </div>
        <p className="text-xl text-gray-300 max-w-lg mx-auto">
          {t('hero.tagline')}
        </p>

        <div className="flex items-center justify-center mt-8">
          <button
            onClick={() => setJoinOpen(!joinOpen)}
            className="px-8 py-3 rounded-lg border-2 border-neon-magenta text-neon-magenta font-bold text-lg hover:bg-neon-magenta/10 transition-all cursor-pointer"
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
          <div className="mt-6 max-w-md mx-auto bg-surface-light rounded-lg border border-neon-cyan/30 p-4 flex items-center justify-between gap-4">
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
                  // Verify the party still exists on the server before navigating.
                  // This prevents "/sing/rejoin/none" landing on a dead party where
                  // the host is stuck on a "waiting for host" screen.
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
      <div className="mb-12">
        <SearchBar />
      </div>

      {/* Recommended */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-white mb-6">
          <span className="border-b-2 border-neon-cyan pb-1">{t('sections.recommended')}</span>
        </h2>
        <Suspense
          fallback={
            <div className="text-gray-400 text-center py-8">{t('sections.loadingSongs')}</div>
          }
        >
          <RecommendedSongs promise={recommendedPromise} />
        </Suspense>
      </section>

      {/* Popular at Parties */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-white mb-6">
          <span className="border-b-2 border-neon-magenta pb-1">{t('sections.popularAtParties')}</span>
        </h2>
        <Suspense
          fallback={
            <div className="text-gray-400 text-center py-8">{t('sections.loading')}</div>
          }
        >
          <PopularSongs promise={popularPromise} />
        </Suspense>
      </section>
    </WrapperPage>
  );
};

export default EntryPage;
