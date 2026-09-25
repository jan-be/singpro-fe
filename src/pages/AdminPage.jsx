import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import NotFoundPage from './NotFoundPage';
import { Avatar } from '../components/AccountMenu';
import { useAuth } from '../logic/AuthContext';
import i18n from '../i18n/i18n';
import { timeAgo } from '../logic/timeAgo';
import { formatDuration } from '../logic/duration';
import { formatTime } from '../logic/songRegions';
import { deviceLabel } from '../logic/deviceLabel';
import { localizedHostNames, hostLabel } from '../logic/hostNames';
import {
  getAdminOverview, getAdminPlays, getAdminUsers, getAdminOrigins, getAdminDiscovery, adminSetAdmin, adminRevokeSessions, adminDeleteUser, adminCloseParty,
} from '../logic/authApi';
import { errorMessage } from './AuthPage';

/**
 * /admin, for accounts with the admin flag (backend routes/admin.js): the
 * parties running right now, recently sung songs, the newest accounts, and
 * the buttons that go with them. Everyone else gets the 404 page, so the
 * URL gives nothing away.
 */

const REFRESH_MS = 5000; // parties come and go; the numbers ride along
const PAGE = 20;
const HOST_NAMES = localizedHostNames(i18n.options?.resources ?? i18n.store?.data); // "Gastgeber", "ホスト", …

const btn = {
  primary: 'px-3 py-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/40 hover:bg-neon-cyan/20 hover:border-neon-cyan text-sm font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  quiet: 'px-3 py-1.5 rounded-lg bg-surface-lighter/60 text-gray-300 border border-surface-lighter hover:text-white hover:border-gray-500 text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  danger: 'px-3 py-1.5 rounded-lg bg-surface-lighter/60 text-gray-400 border border-surface-lighter hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 text-sm transition-all cursor-pointer disabled:opacity-40',
};
const input = 'w-full px-3 py-2 rounded-lg bg-surface border border-surface-lighter text-white placeholder-gray-500 text-sm focus:outline-none focus:border-neon-cyan transition-all';

const useAgo = () => {
  const { i18n: inst } = useTranslation();
  return (d) => timeAgo(d, { lang: inst.language });
};

/** A player's name, with "(host)" after a default host name in another language. */
const useName = () => {
  const { t } = useTranslation();
  return (name) => hostLabel(name, HOST_NAMES, t('admin.host'));
};

// ── Pieces ─────────────────────────────────────────────────────────────

const StatTile = ({ label, value, accent, small }) => (
  <div className="rounded-xl bg-surface-light border border-surface-lighter px-4 py-3 text-center">
    <div className={`${small ? 'text-lg' : 'text-2xl'} font-black font-mono leading-tight ${accent ?? 'text-white'}`}>{value}</div>
    <div className="text-xs text-gray-400 mt-0.5">{label}</div>
  </div>
);

const Section = ({ title, children, aside }) => (
  <section className="mt-8">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

const TONES = {
  gray: 'border-surface-lighter text-gray-400',
  magenta: 'border-neon-magenta/50 text-neon-magenta',
  yellow: 'border-yellow-400/50 text-yellow-400',
  red: 'border-red-400/50 text-red-400',
};
const Badge = ({ tone = 'gray', children }) => (
  <span className={`inline-block rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wider whitespace-nowrap ${TONES[tone]}`}>{children}</span>
);

const Thumb = ({ videoId }) => (videoId
  ? <img src={`https://i.ytimg.com/vi/${videoId}/default.jpg`} alt="" className="w-14 h-10 rounded object-cover flex-shrink-0 bg-surface-lighter" loading="lazy" />
  : <div className="w-14 h-10 rounded bg-surface-lighter flex-shrink-0" />);

/** Flag and name for a two-letter country code; Cloudflare's XX (unknown) and T1 (Tor) stay as they are. */
const countryLabel = (code, lang) => {
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return code;
  const flag = String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0)));
  let name = code;
  try { name = new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { /* not a region the browser knows */ }
  return `${flag} ${name}`;
};

/** A ranked list with a bar per row, the bar being the share of the first number; `labels` name the two numbers. */
const OriginList = ({ rows, empty, labels }) => {
  const { t } = useTranslation();
  const [unitA, unitB] = labels ?? [t('admin.origins.sessions'), t('admin.origins.plays')];
  if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  const max = Math.max(1, ...rows.map(r => r.sessions));
  return (
    <ul className="space-y-1">
      {rows.map(r => (
        <li key={r.key} className="relative rounded-md overflow-hidden px-2 py-1">
          <div className="absolute inset-y-0 left-0 bg-neon-cyan/10" style={{ width: `${(r.sessions / max) * 100}%` }} aria-hidden="true" />
          <div className="relative flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-200 truncate">{r.label}</span>
            <span className="text-xs text-gray-400 flex-shrink-0 font-mono whitespace-nowrap">
              {r.sessions} <span className="text-gray-600">{unitA}</span> · {r.plays} <span className="text-gray-600">{unitB}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
};

/** One running party: code, host, what is playing, who is in. */
const PartyCard = ({ party, busy, onClose }) => {
  const { t } = useTranslation();
  const ago = useAgo();
  const name = useName();
  const song = party.currentSong;
  const online = party.players.filter(p => p.connected).length;
  return (
    <div className="rounded-xl bg-surface-light border border-surface-lighter p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/join/${party.partyId}`} className="font-mono text-xl font-black text-neon-cyan tracking-widest hover:underline">{party.partyId}</Link>
            {!party.hostConnected && <Badge tone="red">{party.hostAway ? t('admin.parties.hostAway') : t('admin.parties.hostGone')}</Badge>}
          </div>
          <div className="text-xs text-gray-400 truncate">{t('admin.parties.host', { username: name(party.owner) })} · {ago(party.createdAt)}</div>
        </div>
        <button type="button" disabled={busy} onClick={() => onClose(party)} className={btn.danger}>{t('admin.parties.close')}</button>
      </div>
      {song
        ? (
          <Link to={`/sing/${song.songId}`} className="flex items-center gap-3 rounded-lg -mx-2 px-2 py-1 hover:bg-white/5 transition-colors">
            <Thumb videoId={song.videoId} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white truncate">{song.title}</div>
              <div className="text-xs text-gray-400 truncate">{song.artist} · {song.isPlaying ? t('admin.parties.playing') : t('admin.parties.paused')}{song.startedAt ? ` · ${ago(song.startedAt)}` : ''}</div>
            </div>
          </Link>
        )
        : <div className="text-sm text-gray-500">{t('admin.parties.idle')}</div>}
      <div className="flex flex-wrap gap-1.5">
        {party.players.map(p => (
          <span
            key={p.username}
            title={p.signedIn ? t('admin.parties.signedIn') : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs border ${p.connected ? 'border-surface-lighter text-gray-200' : 'border-surface-lighter/60 text-gray-500'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? 'bg-neon-green' : 'bg-gray-600'}`} aria-hidden="true" />
            {name(p.username)}{p.signedIn ? ' ✓' : ''}
            {p.score > 0 && <span className="font-mono text-neon-cyan">{p.score.toLocaleString()}</span>}
            {p.connected && p.latencyMs > 0 && <span className="font-mono text-gray-500">{p.latencyMs} ms</span>}
          </span>
        ))}
      </div>
      <div className="text-xs text-gray-500">{t('admin.parties.players', { count: online })} · {t('admin.parties.queue', { count: party.queueLength })}</div>
    </div>
  );
};

/**
 * One song_play: who sang what, where, for how long, and what it left
 * behind. A name in cyan belongs to an account; a guest's is grey with a
 * tag, since a guest can never leave a score.
 */
const PlayRow = ({ play }) => {
  const { t } = useTranslation();
  const ago = useAgo();
  const name = useName();
  const device = deviceLabel(play.userAgent);
  return (
    <Link to={`/sing/${play.songId}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5 transition-colors">
      <Thumb videoId={play.videoId} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{play.title ?? play.songId}</div>
        <div className="text-xs text-gray-400 truncate">{play.artist}{device ? <span className="text-gray-600"> · {device}</span> : null}</div>
      </div>
      <div className="text-right flex-shrink-0 min-w-0">
        <div className="text-sm truncate max-w-[14rem]">
          {play.nickname
            ? <span className={play.userId ? 'text-neon-cyan' : 'text-gray-200'}>{name(play.nickname)}</span>
            : <span className="text-gray-500">{t('admin.plays.guest')}</span>}
          {play.score != null && <span className="font-mono text-yellow-400 ml-2">{play.score.toLocaleString()}</span>}
          {play.score == null && play.nickname && (
            <span className="text-xs text-gray-600 ml-2">{play.userId ? t('admin.plays.noScore') : t('admin.plays.guest')}</span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          <span className={`font-mono ${play.seconds != null ? 'text-gray-300' : 'text-gray-600'}`}>{play.seconds != null ? formatTime(play.seconds) : '–:––'}</span>
          {play.ping != null ? ` · ${t('admin.ping', { ms: play.ping })}` : ''}
          {play.partyId ? ` · ${t('admin.plays.inParty', { partyId: play.partyId })}` : ''} · {ago(play.at)}
        </div>
      </div>
    </Link>
  );
};

/** One account with its numbers and the three buttons (none on yourself). */
const UserRow = ({ u, isMe, busy, onAct }) => {
  const { t } = useTranslation();
  const ago = useAgo();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-light border border-surface-lighter px-3 py-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar username={u.username} size={32} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/u/${encodeURIComponent(u.username)}`} className="text-white hover:text-neon-cyan font-semibold truncate">{u.username}</Link>
            {u.isAdmin && <Badge tone="magenta">{t('admin.users.admin')}</Badge>}
            {isMe && <Badge>{t('admin.users.you')}</Badge>}
            {!u.verified && <Badge tone="yellow">{t('admin.users.unverified')}</Badge>}
          </div>
          <div className="text-xs text-gray-400 truncate">{u.email ?? '—'} · #{u.id}</div>
          <div className="text-xs text-gray-500">
            {t('admin.users.joined', { time: ago(u.createdAt) })}
            {' · '}{u.lastLoginAt ? t('admin.users.lastLogin', { time: ago(u.lastLoginAt) }) : t('admin.users.neverSignedIn')}
            {' · '}{t('admin.users.scores', { count: u.scores ?? 0 })}
            {' · '}{t('admin.users.playsAsName', { count: u.playsAsName ?? 0 })}
            {' · '}{t('admin.users.passkeys', { count: u.passkeys })}
            {u.hasPassword ? ` · ${t('admin.users.password')}` : ''}
            {u.userAgent ? ` · ${deviceLabel(u.userAgent)}` : ''}
          </div>
        </div>
      </div>
      {!isMe && (
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <button type="button" disabled={busy} onClick={() => onAct('admin', u)} className={btn.quiet}>{u.isAdmin ? t('admin.users.removeAdmin') : t('admin.users.makeAdmin')}</button>
          <button type="button" disabled={busy} onClick={() => onAct('signout', u)} className={btn.quiet}>{t('admin.users.signOut')}</button>
          <button type="button" disabled={busy} onClick={() => onAct('delete', u)} className={btn.danger}>{t('admin.users.delete')}</button>
        </div>
      )}
    </li>
  );
};

// ── The console ────────────────────────────────────────────────────────

const AdminConsole = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [plays, setPlays] = useState(null); // { rows, hasMore }
  const [users, setUsers] = useState(null); // { rows, hasMore, q }
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const timer = useRef(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await getAdminOverview());
      setUpdatedAt(Date.now());
    } catch (e) { setErr(errorMessage(t, e)); }
  }, [t]);

  useEffect(() => {
    loadOverview();
    const id = setInterval(() => { if (document.visibilityState === 'visible') loadOverview(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadOverview]);

  useEffect(() => {
    getAdminPlays(0, PAGE).then(p => setPlays({ rows: p.data, hasMore: p.hasMore })).catch(e => setErr(errorMessage(t, e)));
  }, [t]);

  const [origins, setOrigins] = useState(null); // { days, referrers, direct, countries }
  const [days, setDays] = useState(30);
  useEffect(() => {
    let active = true;
    setOrigins(null);
    getAdminOrigins(days).then(o => { if (active) setOrigins(o); }).catch(e => setErr(errorMessage(t, e)));
    return () => { active = false; };
  }, [days, t]);
  const sourceRows = origins
    ? [
      ...(origins.direct.plays > 0 ? [{ key: 'direct', label: t('admin.origins.direct'), sessions: origins.direct.sessions, plays: origins.direct.plays }] : []),
      ...origins.referrers.map(r => ({ key: r.source, label: r.source, sessions: r.sessions, plays: r.plays })),
    ].sort((a, b) => b.sessions - a.sessions || b.plays - a.plays)
    : [];
  const countryRows = origins ? origins.countries.map(c => ({ key: c.country, label: countryLabel(c.country, i18n.language), sessions: c.sessions, plays: c.plays })) : [];

  const [discovery, setDiscovery] = useState(null); // { picks, searches, topMissed, topAsked, youtube }
  useEffect(() => {
    let active = true;
    setDiscovery(null);
    getAdminDiscovery(days).then(d => { if (active) setDiscovery(d); }).catch(e => setErr(errorMessage(t, e)));
    return () => { active = false; };
  }, [days, t]);
  const WAYS = ['search', 'browse', 'youtube-url', 'queue-search', 'queue-similar', 'auto-similar'];
  const pickRows = discovery
    ? discovery.picks.map(p => ({ key: p.source, label: WAYS.includes(p.source) ? t(`admin.discovery.ways.${p.source}`) : p.source, sessions: p.picks, plays: p.browsers }))
    : [];
  const youtube = discovery ? Object.fromEntries(discovery.youtube.map(y => [y.match, y.lookups])) : {};
  const youtubeTotal = Object.values(youtube).reduce((a, b) => a + b, 0);

  const findUsers = useCallback((term) => getAdminUsers(term, 0, PAGE)
    .then(p => setUsers({ rows: p.data, hasMore: p.hasMore, q: term }))
    .catch(e => setErr(errorMessage(t, e))), [t]);

  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    timer.current = setTimeout(() => findUsers(term), term ? 250 : 0);
    return () => clearTimeout(timer.current);
  }, [q, findUsers]);

  const run = async (fn) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); } catch (e) { setErr(errorMessage(t, e)); } finally { setBusy(false); }
  };

  const morePlays = () => run(async () => {
    const p = await getAdminPlays(plays.rows.length, PAGE);
    setPlays(s => ({ rows: [...s.rows, ...p.data], hasMore: p.hasMore }));
  });
  const moreUsers = () => run(async () => {
    const p = await getAdminUsers(users.q, users.rows.length, PAGE);
    setUsers(s => ({ ...s, rows: [...s.rows, ...p.data], hasMore: p.hasMore }));
  });

  const closeParty = (party) => {
    if (!window.confirm(t('admin.parties.closeConfirm', { partyId: party.partyId }))) return;
    run(async () => {
      await adminCloseParty(party.partyId);
      setMsg(t('admin.parties.closed', { partyId: party.partyId }));
      await loadOverview();
    });
  };

  const act = (what, u) => {
    const replace = (next) => setUsers(s => ({ ...s, rows: s.rows.map(r => (r.id === u.id ? next : r)) }));
    if (what === 'admin') {
      if (!window.confirm(t(u.isAdmin ? 'admin.users.removeAdminConfirm' : 'admin.users.makeAdminConfirm', { username: u.username }))) return;
      run(async () => {
        replace((await adminSetAdmin(u.id, !u.isAdmin)) ?? { ...u, isAdmin: !u.isAdmin });
        setMsg(t(u.isAdmin ? 'admin.users.adminRemoved' : 'admin.users.adminMade', { username: u.username }));
      });
    } else if (what === 'signout') {
      run(async () => {
        await adminRevokeSessions(u.id);
        setMsg(t('admin.users.signedOut', { username: u.username }));
      });
    } else if (what === 'delete') {
      if (!window.confirm(t('admin.users.deleteConfirm', { username: u.username }))) return;
      run(async () => {
        await adminDeleteUser(u.id);
        setUsers(s => ({ ...s, rows: s.rows.filter(r => r.id !== u.id) }));
        setMsg(t('admin.users.deleted', { username: u.username }));
        loadOverview();
      });
    }
  };

  const loading = <div className="text-neon-cyan text-center py-6 animate-pulse">{t('sections.loading')}</div>;

  return (
    <WrapperPage>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">{t('admin.title')}</h1>
          <p className="text-sm text-gray-400">{t('admin.subtitle')}</p>
        </div>
        {updatedAt && <div className="text-xs text-gray-500">{t('admin.updated', { time: new Date(updatedAt).toLocaleTimeString(i18n.language) })}</div>}
      </div>

      {msg && <div className="mt-4 text-sm text-neon-green" role="status">{msg}</div>}
      {err && <div className="mt-4 text-sm text-red-400" role="alert">{err}</div>}

      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 mt-4">
          <StatTile label={t('admin.stats.partiesRunning')} value={overview.partiesRunning} accent="text-neon-cyan" />
          <StatTile label={t('admin.stats.playersOnline')} value={overview.playersOnline} accent="text-neon-green" />
          <StatTile label={t('admin.stats.playsDay')} value={overview.playsDay ?? 0} />
          <StatTile label={t('admin.stats.playsWeek')} value={overview.playsWeek ?? 0} />
          <StatTile label={t('admin.stats.sungDay')} value={formatDuration(overview.secondsDay, i18n.language)} small />
          <StatTile label={t('admin.stats.sungWeek')} value={formatDuration(overview.secondsWeek, i18n.language)} small />
          <StatTile label={t('admin.stats.usersTotal')} value={overview.usersTotal ?? 0} accent="text-neon-magenta" />
          <StatTile label={t('admin.stats.usersDay')} value={overview.usersDay ?? 0} />
          <StatTile label={t('admin.stats.usersWeek')} value={overview.usersWeek ?? 0} />
          <StatTile label={t('admin.stats.scoresDay')} value={overview.scoresDay ?? 0} accent="text-yellow-400" />
        </div>
      )}

      <Section title={t('admin.parties.title')} aside={overview && <span className="text-xs text-gray-500">{t('admin.parties.count', { count: overview.parties.length })}</span>}>
        {!overview
          ? loading
          : overview.parties.length === 0
            ? <p className="text-sm text-gray-500">{t('admin.parties.none')}</p>
            : <div className="grid gap-3 lg:grid-cols-2">{overview.parties.map(p => <PartyCard key={p.partyId} party={p} busy={busy} onClose={closeParty} />)}</div>}
      </Section>

      <Section
        title={t('admin.origins.title')}
        aside={(
          <div className="flex gap-1">
            {[7, 30, 365].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-2 py-1 rounded-md text-xs border cursor-pointer transition-colors ${days === d ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10' : 'border-surface-lighter text-gray-400 hover:text-white'}`}
              >
                {t('admin.origins.days', { count: d })}
              </button>
            ))}
          </div>
        )}
      >
        <p className="text-xs text-gray-500 mb-3">{t('admin.origins.hint')}</p>
        {!origins
          ? loading
          : (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-surface-light border border-surface-lighter p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('admin.origins.sources')}</div>
                <OriginList rows={sourceRows} empty={t('admin.origins.none')} />
              </div>
              <div className="rounded-xl bg-surface-light border border-surface-lighter p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('admin.origins.countries')}</div>
                <OriginList rows={countryRows} empty={t('admin.origins.noCountries')} />
              </div>
            </div>
          )}
      </Section>

      <Section title={t('admin.discovery.title')} aside={<span className="text-xs text-gray-500">{t('admin.origins.days', { count: days })}</span>}>
        <p className="text-xs text-gray-500 mb-3">{t('admin.discovery.hint')}</p>
        {!discovery
          ? loading
          : (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-surface-light border border-surface-lighter p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('admin.discovery.picks')}</div>
                <OriginList rows={pickRows} empty={t('admin.discovery.noPicks')} labels={[t('admin.discovery.picksUnit'), t('admin.discovery.browsersUnit')]} />
              </div>
              <div className="rounded-xl bg-surface-light border border-surface-lighter p-3 space-y-3">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('admin.discovery.searches')}</div>
                  {Object.keys(discovery.searches).length === 0 && <p className="text-sm text-gray-500">{t('admin.discovery.noSearches')}</p>}
                  {['entry', 'queue', 'youtube'].filter(s => discovery.searches[s]).map(s => {
                    const b = discovery.searches[s];
                    return (
                      <div key={s} className="text-sm text-gray-300">
                        <span className="text-white">{t(`admin.discovery.sources.${s}`)}</span>
                        {': '}
                        {t('admin.discovery.searchLine', { sessions: b.sessions, hits: b.hits, pct: b.sessions ? Math.round((100 * b.hits) / b.sessions) : 0, empty: b.empty })}
                      </div>
                    );
                  })}
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('admin.discovery.missed')}</div>
                  {discovery.topMissed.length === 0
                    ? <p className="text-sm text-gray-500">{t('admin.discovery.noMissed')}</p>
                    : (
                      <ul className="text-sm space-y-0.5">
                        {discovery.topMissed.map(m => (
                          <li key={m.q} className="flex justify-between gap-3"><span className="text-gray-200 truncate">{m.q}</span><span className="font-mono text-gray-500 flex-shrink-0">{m.count}</span></li>
                        ))}
                      </ul>
                    )}
                </div>
                <div className="text-sm text-gray-300">
                  {youtubeTotal === 0
                    ? <span className="text-gray-500">{t('admin.discovery.noYoutube')}</span>
                    : t('admin.discovery.youtube', { lookups: youtubeTotal, exact: youtube.exact ?? 0, title: youtube.title ?? 0, none: youtube.none ?? 0 })}
                </div>
              </div>
            </div>
          )}
      </Section>

      <Section title={t('admin.plays.title')}>
        <p className="text-xs text-gray-500 mb-3">{t('admin.plays.hint')}</p>
        {!plays
          ? loading
          : plays.rows.length === 0
            ? <p className="text-sm text-gray-500">{t('admin.plays.none')}</p>
            : <div className="rounded-xl bg-surface-light border border-surface-lighter p-1.5 space-y-0.5">{plays.rows.map(p => <PlayRow key={p.id} play={p} />)}</div>}
        {plays?.hasMore && <button type="button" disabled={busy} onClick={morePlays} className={`${btn.quiet} mt-3`}>{t('admin.showMore')}</button>}
      </Section>

      <Section title={t('admin.users.title')} aside={<span className="text-xs text-gray-500">{users?.q ? '' : t('admin.users.newest')}</span>}>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('admin.users.search')}
          className={input}
          autoComplete="off"
        />
        {!users
          ? loading
          : (
            <ul className="mt-3 space-y-1.5">
              {users.rows.length === 0 && <li className="text-sm text-gray-500">{t('admin.users.none')}</li>}
              {users.rows.map(u => <UserRow key={u.id} u={u} isMe={u.id === user.id} busy={busy} onAct={act} />)}
            </ul>
          )}
        {users?.hasMore && <button type="button" disabled={busy} onClick={moreUsers} className={`${btn.quiet} mt-3`}>{t('admin.showMore')}</button>}
      </Section>
    </WrapperPage>
  );
};

const AdminPage = () => {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  useEffect(() => { document.title = 'Admin | singpro.app'; }, []);
  if (loading) return <WrapperPage><div className="text-neon-cyan text-center py-20 animate-pulse">{t('sections.loading')}</div></WrapperPage>;
  if (!user) return <Navigate to="/login?next=%2Fadmin" replace />;
  if (!user.isAdmin) return <NotFoundPage />;
  return <AdminConsole />;
};

export default AdminPage;
