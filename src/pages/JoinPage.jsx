import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import WrapperPage from "./WrapperPage";
import { apiUrl, useLangPath } from "../GlobalConsts";

const JoinPage = () => {
  const { t } = useTranslation();
  const { partyId } = useParams();
  const lp = useLangPath();
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
          setError(t('join.partyNotFound'));
          setLoading(false);
          return;
        }
        const data = await resp.json();
        setParty(data.data ?? data);
        setLoading(false);
      } catch (e) {
        setError(t('join.connectionFailed'));
        setLoading(false);
      }
    })();
  }, [partyId]);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username.trim()) return;

    // Navigate to the PartyPage for the current song (or a waiting route if no song)
    const song = party?.currentSong;
    if (song?.songId) {
      const slug = `${(song.artist || '').replace(/\s+/g, '-')}-${(song.title || '').replace(/\s+/g, '-')}`
        .toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
      navigate(lp(`/sing/${slug}/${song.songId}`), {
        state: { partyId, currentUserName: username.trim(), isHost: false },
      });
    } else {
      // No song playing yet — go to a placeholder PartyPage that will wait for song:started
      navigate(lp(`/sing/waiting/none`), {
        state: { partyId, currentUserName: username.trim(), isHost: false },
      });
    }
  };

  if (loading) {
    return (
      <WrapperPage>
        <div className="flex items-center justify-center py-20">
          <div className="text-neon-cyan text-xl animate-pulse">{t('join.loadingParty')}</div>
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
            {t('join.partyNotFoundDesc', { partyId }).split('<1>').map((part, i) => {
              if (i === 0) return part;
              const [code, rest] = part.split('</1>');
              return <React.Fragment key={i}><span className="text-neon-magenta font-mono font-bold">{code}</span>{rest}</React.Fragment>;
            })}
          </p>
          <button
            onClick={() => navigate(lp('/'))}
            className="px-6 py-2 rounded-lg bg-surface-light border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 transition-all cursor-pointer"
          >
            {t('join.goHome')}
          </button>
        </div>
      </WrapperPage>
    );
  }

  return (
    <WrapperPage>

      <div className="max-w-md mx-auto py-12">
        <div className="gradient-border rounded-xl p-px">
        <div className="bg-surface-light rounded-xl p-8">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan to-neon-purple text-center mb-2 leading-normal">{t('join.title')}</h1>
          <p className="text-center text-neon-cyan font-mono text-2xl font-bold mb-6">{partyId}</p>

          {party && (
            <div className="bg-surface rounded-lg p-4 mb-6 space-y-2 text-sm">
              {party.owner && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t('activeSession.host')}</span>
                  <span className="text-white">{party.owner}</span>
                </div>
              )}
              {party.currentSong && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t('join.nowPlaying')}</span>
                  <span className="text-white">{party.currentSong.title}</span>
                </div>
              )}
              {party.playerCount !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t('join.players')}</span>
                  <span className="text-white">{party.playerCount}</span>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm text-gray-400 mb-1">
                {t('join.yourName')}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('join.enterName')}
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
              {t('join.joinButton')}
            </button>
          </form>
        </div>
        </div>
      </div>
    </WrapperPage>
  );
};

export default JoinPage;
