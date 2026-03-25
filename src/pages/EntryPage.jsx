import React, { Suspense, use, useState } from "react";
import { Link } from "react-router-dom";
import JoinGameBox from "../components/JoinGameBox";
import SearchBar from "../components/SearchBar";
import WrapperPage from "./WrapperPage";
import MyIcon from "../icon.svg?react";
import { apiUrl } from "../GlobalConsts";
import { urlEscapedTitle } from "../logic/RandomUtility";

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
