import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiUrl, useLangPath } from "../GlobalConsts";

const JoinGameBox = () => {
  const { t } = useTranslation();
  const lp = useLangPath();
  const [partyId, setPartyId] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handlePartyIdChange = (event) => {
    const newVal = event.target.value.toUpperCase();
    if (newVal.match(/^[A-Z0-9]{0,4}$/)) {
      setPartyId(newVal);
      setError(null);
    }
  };

  const handleUsernameChange = (event) => {
    setUsername(event.target.value);
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!partyId || !username.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // Validate party exists
      const resp = await fetch(`${apiUrl}/parties/${partyId}`);
      if (!resp.ok) {
        setError(t('join.partyNotFound'));
        setLoading(false);
        return;
      }
      const data = await resp.json();
      const party = data.data ?? data;

      // Navigate directly to PartyPage with party state
      const song = party?.currentSong;
      if (song?.songId) {
        navigate(lp(`/sing/${song.songId}`), {
          state: { partyId: partyId.toUpperCase(), currentUserName: username.trim(), isHost: false },
        });
      } else {
        // No song playing yet — go to waiting state
        navigate(lp(`/sing/none`), {
          state: { partyId: partyId.toUpperCase(), currentUserName: username.trim(), isHost: false },
        });
      }
    } catch {
      setError(t('join.connectionFailed'));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="gradient-border-animated rounded-xl p-px">
        <div className="bg-surface-light rounded-xl p-6 space-y-4">
          <div>
            <label htmlFor="join-party-id" className="block text-sm text-gray-400 mb-1">{t('join.partyCode')}</label>
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
            <label htmlFor="join-username" className="block text-sm text-gray-400 mb-1">{t('join.yourName')}</label>
            <input
              id="join-username"
              type="text"
              placeholder={t('join.enterName')}
              value={username}
              onChange={handleUsernameChange}
              maxLength={20}
              className="w-full px-4 py-3 rounded-lg bg-surface border border-surface-lighter text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_10px_rgba(0,229,255,0.2)] transition-all"
            />
          </div>
          {error && (
            <div className="text-red-400 text-sm text-center">{error}</div>
          )}
          <button
            type="submit"
            disabled={partyId.length < 4 || !username.trim() || loading}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-neon-magenta/20 to-neon-purple/20 border border-neon-magenta/60 text-neon-magenta font-bold hover:from-neon-magenta/30 hover:to-neon-purple/30 hover:border-neon-magenta hover:shadow-[0_0_25px_rgba(255,0,229,0.3)] transition-all duration-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            {loading ? t('join.joining') : t('join.joinButton')}
          </button>
        </div>
      </div>
    </form>
  );
};

export default JoinGameBox;
