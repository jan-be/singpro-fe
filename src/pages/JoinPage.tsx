import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";
import WrapperPage from "./WrapperPage";
import { apiUrl } from "../GlobalConsts";
import { useAuth } from "../logic/AuthContext";
import { LockIcon } from "../components/Icons";

const JoinPage = () => {
  const { t } = useTranslation();
  const namesOf = useSongNames();
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

  // The host switched joining off (the QR code card): only someone already in
  // the party gets back in (the server knows their browser or account), so
  // the page says so and offers that instead of joining at once
  const closed = party?.joiningOpen === false;

  // Signed in: no name to ask for, straight into the party under the account
  // name, unless that name is already singing here (the host, on their big
  // screen): then this device is asked for a name of its own
  const accountNameTaken = !!user?.username && !!party && nameTaken(user.username);
  const autoJoined = useRef(false);
  useEffect(() => {
    if (loading || authLoading || error || !party || closed || !user?.username || accountNameTaken || autoJoined.current) return;
    autoJoined.current = true;
    join(user.username);
  }, [loading, authLoading, error, party, closed, user?.username, accountNameTaken, join]);

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

  if (loading || authLoading || (user?.username && !accountNameTaken && !error && !closed)) {
    return (
      <WrapperPage>
        <div className="flex items-center justify-center py-20">
          <div className="text-white/55 text-lg font-medium animate-pulse">{t('join.loadingParty')}</div>
        </div>
      </WrapperPage>
    );
  }

  if (error) {
    return (
      <WrapperPage>
        <div className="text-center py-12 sm:py-20 max-w-md mx-auto">
          <div className="mx-auto mb-6 w-20 h-20 rounded-full bg-panel border border-white/10 grid place-items-center text-3xl font-semibold text-white/60" aria-hidden="true">:(</div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white mb-3 text-balance">{error}</h2>
          <p className="text-white/55 leading-relaxed mb-8 text-pretty">
            {t('join.partyNotFoundDesc', { partyId }).split('<1>').map((part, i) => {
              if (i === 0) return part;
              const [code, rest] = part.split('</1>');
              return <React.Fragment key={i}><span className="text-neon-cyan font-mono font-semibold tracking-[0.12em]">{code}</span>{rest}</React.Fragment>;
            })}
          </p>
          <button
            onClick={() => navigate('/')}
            className="btn btn-primary btn-lg"
          >
            {t('join.goHome')}
          </button>
        </div>
      </WrapperPage>
    );
  }

  return (
    <WrapperPage>

      <div className="max-w-md mx-auto sm:py-6">
        <div className="rounded-3xl bg-panel border border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] p-6 sm:p-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white text-center mb-2">{t('join.title')}</h1>
          <p className="text-center text-neon-cyan font-mono text-2xl font-semibold tracking-[0.35em] pl-[0.35em] mb-6">{partyId}</p>

          {party && (
            <div className="rounded-2xl bg-white/[0.05] border border-white/[0.08] px-4 py-3.5 mb-6 space-y-2.5 text-sm">
              {party.owner && (
                <div className="flex justify-between gap-4">
                  <span className="text-white/55 flex-shrink-0">{t('activeSession.host')}</span>
                  <span className="text-white font-medium min-w-0 truncate">{party.owner}</span>
                </div>
              )}
              {party.currentSong && (
                <div className="flex justify-between gap-4">
                  <span className="text-white/55 flex-shrink-0">{t('join.nowPlaying')}</span>
                  <span className="text-white font-medium min-w-0 truncate" lang={namesOf(party.currentSong).lang}>{namesOf(party.currentSong).title}</span>
                </div>
              )}
              {party.playerCount !== undefined && (
                <div className="flex justify-between gap-4">
                  <span className="text-white/55 flex-shrink-0">{t('join.players')}</span>
                  <span className="text-white font-medium tabular-nums">{party.playerCount}</span>
                </div>
              )}
            </div>
          )}

          {closed && (
            <div role="status" data-joining-closed="" className="flex items-start gap-3 rounded-2xl bg-white/[0.05] border border-white/[0.08] px-4 py-3.5 mb-5 text-sm">
              <LockIcon size={18} className="mt-0.5 flex-shrink-0 text-white/70" />
              <div className="min-w-0">
                <div className="text-white font-semibold">{t('party.joiningClosed')}</div>
                <p className="mt-1 text-white/60 leading-snug text-pretty">{t('party.joiningClosedRefused')}</p>
              </div>
            </div>
          )}

          {closed && user?.username && !accountNameTaken ? (
            <button type="button" onClick={() => join(user.username)} className="btn btn-ghost btn-lg w-full">
              {t('join.backInAs', { name: user.username })}
            </button>
          ) : (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              {closed && <p className="text-sm text-white/70 mb-3 text-pretty">{t('join.backIn')}</p>}
              <label htmlFor="username" className="block text-xs font-medium text-white/55 mb-1.5">
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
                className="field h-12 px-4"
              />
              {(accountNameTaken || typedNameTaken) && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {t('join.nameTaken', { name: typedNameTaken ? username.trim() : user.username })}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={!username.trim() || typedNameTaken}
              className={`btn btn-lg w-full ${closed ? 'btn-ghost' : 'btn-primary'}`}
            >
              {closed ? t('join.backInButton') : t('join.joinButton')}
            </button>
          </form>
          )}
        </div>
      </div>
    </WrapperPage>
  );
};

export default JoinPage;
