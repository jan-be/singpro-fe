import React, { Suspense, use, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import JoinGameBox from "../components/JoinGameBox";
import SearchBar from "../components/SearchBar";
import WrapperPage from "./WrapperPage";
import MyIcon from "../icon.svg?react";
import { apiUrl } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";
import { loadPartySession, clearPartySession } from "./PartyPage";

const recommendedPromise = fetch(`${apiUrl}/recommended`).then(r => r.json()).then(j => j.data);
const popularPromise = fetch(`${apiUrl}/listens/popular`).then(r => r.json()).then(j => j.data);

const SongCard = ({ song }) => {
  const slug = urlEscapedTitle(song.artist, song.title);
  return (
    <Link
      to={`/sing/${slug}/${song.songId}`}
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

const RecommendedSongs = () => {
  const songs = use(recommendedPromise);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {songs.map((song, i) => <SongCard key={i} song={song} />)}
    </div>
  );
};

const PopularSongs = () => {
  const songs = use(popularPromise);
  if (!songs || songs.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {songs.map((song, i) => <SongCard key={i} song={song} />)}
    </div>
  );
};

const EntryPage = () => {
  const [joinOpen, setJoinOpen] = useState(false);
  const navigate = useNavigate();
  const [activeSession, setActiveSession] = useState(loadPartySession);

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
          <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent">
            SingPro
          </h1>
        </div>
        <p className="text-xl text-gray-300 max-w-lg mx-auto">
          Sing all your favourite songs and compete with your friends!
        </p>

        <div className="flex items-center justify-center mt-8">
          <button
            onClick={() => setJoinOpen(!joinOpen)}
            className="px-8 py-3 rounded-lg border-2 border-neon-magenta text-neon-magenta font-bold text-lg hover:bg-neon-magenta/10 transition-all cursor-pointer"
          >
            Join Party
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
              <div className="text-xs text-gray-400 uppercase tracking-wider">Active Party</div>
              <div className="text-neon-cyan font-mono font-bold text-lg">{activeSession.partyId}</div>
              <div className="text-gray-400 text-xs">as {activeSession.username} ({activeSession.isHost ? 'host' : 'joiner'})</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Navigate back to the party — use a waiting route, the WS will
                  // receive the current song from party:state on reconnect
                  navigate(`/sing/rejoin/none`, {
                    state: {
                      partyId: activeSession.partyId,
                      currentUserName: activeSession.username,
                      isHost: activeSession.isHost,
                    },
                  });
                }}
                className="px-4 py-2 rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 hover:border-neon-cyan/60 transition-all text-sm font-semibold cursor-pointer"
              >
                Rejoin
              </button>
              <button
                onClick={() => {
                  clearPartySession();
                  setActiveSession(null);
                }}
                className="px-4 py-2 rounded-lg bg-surface-lighter text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-surface-lighter hover:border-red-500/40 transition-all text-sm cursor-pointer"
              >
                Leave
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
          <span className="border-b-2 border-neon-cyan pb-1">Recommended</span>
        </h2>
        <Suspense
          fallback={
            <div className="text-gray-400 text-center py-8">Loading songs...</div>
          }
        >
          <RecommendedSongs />
        </Suspense>
      </section>

      {/* Popular at Parties */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-white mb-6">
          <span className="border-b-2 border-neon-magenta pb-1">Popular at Parties</span>
        </h2>
        <Suspense
          fallback={
            <div className="text-gray-400 text-center py-8">Loading...</div>
          }
        >
          <PopularSongs />
        </Suspense>
      </section>
    </WrapperPage>
  );
};

export default EntryPage;
