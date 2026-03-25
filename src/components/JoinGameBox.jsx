import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const JoinGameBox = () => {
  const [partyId, setPartyId] = useState("");
  const [username, setUsername] = useState("");
  const navigate = useNavigate();

  const handlePartyIdChange = (event) => {
    const newVal = event.target.value.toUpperCase();
    if (newVal.match(/^[A-Z0-9]{0,4}$/)) {
      setPartyId(newVal);
    }
  };

  const handleUsernameChange = (event) => setUsername(event.target.value);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!partyId || !username.trim()) return;
    navigate(`/mic/${partyId}/${username.trim()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-surface-light rounded-xl p-6 border border-surface-lighter">
      <div>
        <label htmlFor="join-party-id" className="block text-sm text-gray-400 mb-1">Party Code</label>
        <input
          id="join-party-id"
          type="text"
          placeholder="ABCD"
          value={partyId}
          onChange={handlePartyIdChange}
          maxLength={4}
          className="w-full px-4 py-3 rounded-lg bg-surface border border-surface-lighter text-white placeholder-gray-500 text-center font-mono text-2xl tracking-[0.3em] uppercase focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_10px_rgba(0,229,255,0.2)] transition-all"
        />
      </div>
      <div>
        <label htmlFor="join-username" className="block text-sm text-gray-400 mb-1">Your Name</label>
        <input
          id="join-username"
          type="text"
          placeholder="Enter your name"
          value={username}
          onChange={handleUsernameChange}
          maxLength={20}
          className="w-full px-4 py-3 rounded-lg bg-surface border border-surface-lighter text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_10px_rgba(0,229,255,0.2)] transition-all"
        />
      </div>
      <button
        type="submit"
        disabled={partyId.length < 4 || !username.trim()}
        className="w-full py-3 rounded-lg border-2 border-neon-magenta text-neon-magenta font-bold hover:bg-neon-magenta/10 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Join
      </button>
    </form>
  );
};

export default JoinGameBox;
