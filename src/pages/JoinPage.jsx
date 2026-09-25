import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import WrapperPage from "./WrapperPage";
import { apiUrl } from "../GlobalConsts";
import { useAuth } from "../logic/AuthContext";

const JoinPage = () => {
  const { t } = useTranslation();
  const { partyId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [party, setParty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [username, setUsername] = useState("");

  // Into the party: the current song's page, or the waiting page when nothing plays yet
  const join = useCallback((name) => {
    const song = party?.currentSong;
    navigate(song?.songId ? `/sing/${song.songId}` : '/sing/none', {
      state: { partyId, currentUserName: name, isHost: false },
    });
  }, [party, partyId, navigate]);

  // A name that is on stage right now belongs to someone else's device: the
  // server seats one player per name, so joining under it would take over that
  // seat (the host's big screen loses its socket, both microphones feed one
  // score, and a duet part picked on one device silently applies to the other)
  const nameTaken = useCallback((name) => {
    const wanted = name.trim().toLowerCase();
    return !!party?.players?.some(p => p.connected && p.username.trim().toLowerCase() === wanted);
  }, [party]);

  // Signed in: no name to ask for, straight into the party under the account
  // name, unless that name is already singing here (the host, on their big
  // screen): then this device is asked for a name of its own
  const accountNameTaken = !!user?.username && !!party && nameTaken(user.username);
  const autoJoined = useRef(false);
  useEffect(() => {
    if (loading || authLoading || error || !party || !user?.username || accountNameTaken || autoJoined.current) return;
    autoJoined.current = true;
    join(user.username);
  }, [loading, authLoading, error, party, user?.username, accountNameTaken, join]);

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

  const typedNameTaken = username.trim() !== '' && nameTaken(username);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username.trim() || typedNameTaken) return;
    join(username.trim());
  };

  if (loading || authLoading || (user?.username && !accountNameTaken && !error)) {
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
            onClick={() => navigate('/')}
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
              {(accountNameTaken || typedNameTaken) && (
                <p className="mt-2 text-sm text-neon-magenta" role="alert">
                  {t('join.nameTaken', { name: typedNameTaken ? username.trim() : user.username })}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={!username.trim() || typedNameTaken}
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
