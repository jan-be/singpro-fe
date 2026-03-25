import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import WrapperPage from "./WrapperPage";
import { apiUrl } from "../GlobalConsts";

const JoinPage = () => {
  const { partyId } = useParams();
  const navigate = useNavigate();

  const [party, setParty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [username, setUsername] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${apiUrl}/parties/${partyId}`);
        if (!resp.ok) {
          setError("Party not found");
          setLoading(false);
          return;
        }
        const data = await resp.json();
        setParty(data.data ?? data);
        setLoading(false);
      } catch (e) {
        setError("Failed to connect to server");
        setLoading(false);
      }
    })();
  }, [partyId]);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username.trim()) return;

    navigate(`/mic/${partyId}/${username.trim()}`);
  };

  if (loading) {
    return (
      <WrapperPage>
        <div className="flex items-center justify-center py-20">
          <div className="text-neon-cyan text-xl animate-pulse">Loading party...</div>
        </div>
      </WrapperPage>
    );
  }

  if (error) {
    return (
      <WrapperPage>
        <div className="text-center py-20">
          <div className="text-6xl mb-4">:(</div>
          <h2 className="text-2xl font-bold text-white mb-2">{error}</h2>
          <p className="text-gray-400 mb-6">
            The party code <span className="text-neon-magenta font-mono font-bold">{partyId}</span> doesn't match any active party.
          </p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-2 rounded-lg bg-surface-light border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 transition-all cursor-pointer"
          >
            Go Home
          </button>
        </div>
      </WrapperPage>
    );
  }

  return (
    <WrapperPage>
      <div className="max-w-md mx-auto py-12">
        <div className="bg-surface-light rounded-xl p-8 border border-surface-lighter">
          <h1 className="text-3xl font-bold text-white text-center mb-2">Join Party</h1>
          <p className="text-center text-neon-cyan font-mono text-2xl font-bold mb-6">{partyId}</p>

          {party && (
            <div className="bg-surface rounded-lg p-4 mb-6 space-y-2 text-sm">
              {party.owner && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Host</span>
                  <span className="text-white">{party.owner}</span>
                </div>
              )}
              {party.currentSong && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Now playing</span>
                  <span className="text-white">{party.currentSong.title}</span>
                </div>
              )}
              {party.playerCount !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Players</span>
                  <span className="text-white">{party.playerCount}</span>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm text-gray-400 mb-1">
                Your name
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name"
                maxLength={20}
                autoFocus
                className="w-full px-4 py-3 rounded-lg bg-surface border border-surface-lighter text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_10px_rgba(0,229,255,0.2)] transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!username.trim()}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-purple text-white font-bold text-lg hover:shadow-[0_0_25px_rgba(0,229,255,0.4)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Join
            </button>
          </form>
        </div>
      </div>
    </WrapperPage>
  );
};

export default JoinPage;
