import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../GlobalConsts";
import { useAuth } from "../logic/AuthContext";

const JoinGameBox = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [partyId, setPartyId] = useState("");
  const [username, setUsername] = useState("");
  // Signed in: the account name, no field to fill
  const name = user?.username ?? username.trim();
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
    if (!partyId || !name) return;
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
      navigate(song?.songId ? `/sing/${song.songId}` : '/sing/none', {
        state: { partyId: partyId.toUpperCase(), currentUserName: name, isHost: false },
      });
    } catch {
      setError(t('join.connectionFailed'));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="rounded-3xl bg-panel border border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]">
        <div className="p-6 space-y-4 text-left">
          <div>
            <label htmlFor="join-party-id" className="block text-xs font-medium text-white/55 mb-1.5">{t('join.partyCode')}</label>
            <input
              id="join-party-id"
              type="text"
              placeholder="ABCD"
              value={partyId}
              onChange={handlePartyIdChange}
              maxLength={4}
              className="field h-14 px-4 text-center font-mono text-2xl font-semibold tracking-[0.35em] uppercase"
            />
          </div>
          {!user && (
            <div>
              <label htmlFor="join-username" className="block text-xs font-medium text-white/55 mb-1.5">{t('join.yourName')}</label>
              <input
                id="join-username"
                type="text"
                placeholder={t('join.enterName')}
                value={username}
                onChange={handleUsernameChange}
                maxLength={20}
                className="field h-12 px-4"
              />
            </div>
          )}
          {error && (
            <div className="text-red-400 text-sm text-center">{error}</div>
          )}
          <button
            type="submit"
            disabled={partyId.length < 4 || !name || loading}
            className="btn btn-primary btn-lg w-full"
          >
            {loading ? t('join.joining') : t('join.joinButton')}
          </button>
        </div>
      </div>
    </form>
  );
};

export default JoinGameBox;
