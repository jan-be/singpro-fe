import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import NotFoundPage from './NotFoundPage';
import Avatar from '../components/Avatar';
import AdminChartJobs from '../components/AdminChartJobs';
import AdminTrends from '../components/AdminTrends';
import { btn, StatTile, Section, Badge, Thumb, Hint, Loading, Notice, FilterButtons, panel, list } from '../components/AdminParts';
import { useAuth } from '../logic/AuthContext';
import i18n from '../i18n/i18n';
import { timeAgo } from '../logic/timeAgo';
import { formatDuration } from '../logic/duration';
import { formatTime } from '../logic/songRegions';
import { deviceLabel } from '../logic/deviceLabel';
import { localizedHostNames, hostLabel } from '../logic/hostNames';
import { sourceRows as buildSourceRows } from '../logic/originRows';
import { deviceRows } from '../logic/deviceRows';
import {
  getAdminOverview, getAdminPlays, getAdminUsers, getAdminOrigins, getAdminDevices, getAdminDiscovery, adminSetAdmin, adminRevokeSessions, adminDeleteUser, adminRemoveAvatar, adminCloseParty,
  getAdminReports, adminReviewReport,
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

const input = 'field h-11 px-4 text-sm';

/** A small panel of its own inside a section, with an uppercase label */
const card = `${panel} p-4 min-w-0`;
const cardLabel = 'pop-label mb-3';

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

/** Flag and name for a two-letter country code; Cloudflare's XX (unknown) and T1 (Tor) stay as they are. */
const countryLabel = (code, lang) => {
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return code;
  const flag = String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0)));
  let name = code;
  try { name = new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { /* not a region the browser knows */ }
  return `${flag} ${name}`;
};

/**
 * A ranked list with a bar per row, the bar being the share of the first
 * number; `labels` name the two numbers. A row may carry a `hint` (shown on
 * hover), `own` (one of our own links: a magenta bar) and `inferred` (worked
 * out rather than recorded: in italics).
 */
const OriginList = ({ rows, empty, labels }) => {
  const { t } = useTranslation();
  const [unitA, unitB] = labels ?? [t('admin.origins.sessions'), t('admin.origins.plays')];
  if (rows.length === 0) return <p className="text-sm text-white/45">{empty}</p>;
  const max = Math.max(1, ...rows.map(r => r.sessions));
  return (
    <ul className="space-y-1">
      {rows.map(r => (
        <li key={r.key} className="relative rounded-lg overflow-hidden px-2.5 py-1.5">
          <div className={`absolute inset-y-0 left-0 rounded-lg ${r.own ? 'bg-hot/20' : 'bg-violet-300/[0.13]'}`} style={{ width: `${(r.sessions / max) * 100}%` }} aria-hidden="true" />
          <div className="relative flex items-center justify-between gap-3 text-sm" title={r.hint}>
            <span className={`truncate min-w-0 ${r.inferred ? 'text-white/55 italic' : 'text-white/90'}`}>{r.label}</span>
            <span className="text-xs text-white/70 flex-shrink-0 tabular-nums whitespace-nowrap">
              {r.sessions} <span className="text-white/40">{unitA}</span> · {r.plays} <span className="text-white/40">{unitB}</span>
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
    <div className={`${panel} p-4 space-y-3 min-w-0`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/join/${party.partyId}`} className="font-mono text-xl font-semibold text-neon-cyan hover:text-neon-cyan tracking-[0.2em] hover:underline underline-offset-4">{party.partyId}</Link>
            {!party.hostConnected && <Badge tone="red">{party.hostAway ? t('admin.parties.hostAway') : t('admin.parties.hostGone')}</Badge>}
          </div>
          <div className="text-xs text-white/55 truncate mt-0.5">{t('admin.parties.host', { username: name(party.owner) })} · {ago(party.createdAt)}</div>
        </div>
        <button type="button" disabled={busy} onClick={() => onClose(party)} className={btn.danger}>{t('admin.parties.close')}</button>
      </div>
      {song
        ? (
          <Link to={`/sing/${song.songId}`} className="flex items-center gap-3 rounded-xl -mx-2 px-2 py-1.5 no-underline hover:bg-white/[0.05] transition-colors">
            <Thumb videoId={song.videoId} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white truncate">{song.title}</div>
              <div className="text-xs text-white/55 truncate">{song.artist} · {song.isPlaying ? t('admin.parties.playing') : t('admin.parties.paused')}{song.startedAt ? ` · ${ago(song.startedAt)}` : ''}</div>
            </div>
          </Link>
        )
        : <div className="text-sm text-white/45">{t('admin.parties.idle')}</div>}
      <div className="flex flex-wrap gap-1.5">
        {party.players.map(p => (
          <span
            key={p.username}
            title={p.signedIn ? t('admin.parties.signedIn') : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${p.connected ? 'bg-white/[0.08] text-white/90' : 'bg-white/[0.04] text-white/45'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? 'bg-neon-green' : 'bg-white/25'}`} aria-hidden="true" />
            {name(p.username)}{p.signedIn ? ' ✓' : ''}
            {p.score > 0 && <span className="font-medium tabular-nums text-neon-cyan">{p.score.toLocaleString()}</span>}
            {p.connected && p.latencyMs > 0 && <span className="tabular-nums text-white/40">{p.latencyMs} ms</span>}
          </span>
        ))}
      </div>
      <div className="text-xs text-white/45">{t('admin.parties.players', { count: online })} · {t('admin.parties.queue', { count: party.queueLength })}</div>
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
  const device = deviceLabel(play.userAgent, play.os);
  return (
    // Phones: who sang and when go under the song, so the title keeps its room
    <Link to={`/sing/${play.songId}`} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2.5 no-underline hover:bg-white/[0.04] transition-colors">
      <Thumb videoId={play.videoId} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{play.title ?? play.songId}</div>
        <div className="text-xs text-white/55 truncate">{play.artist}{device ? <span className="text-white/35"> · {device}</span> : null}</div>
      </div>
      <div className="w-full sm:w-auto pl-[4.25rem] sm:pl-0 sm:text-right sm:flex-shrink-0 min-w-0">
        <div className="text-sm truncate sm:max-w-[14rem]">
          {play.nickname
            ? <span className={play.userId ? 'font-medium text-neon-cyan' : 'text-white/85'}>{name(play.nickname)}</span>
            : <span className="text-white/45">{t('admin.plays.guest')}</span>}
          {play.score != null && <span className="font-medium tabular-nums text-amber-300 ml-2">{play.score.toLocaleString()}</span>}
          {play.score == null && play.nickname && (
            <span className="text-xs text-white/35 ml-2">{play.userId ? t('admin.plays.noScore') : t('admin.plays.guest')}</span>
          )}
        </div>
        <div className="text-xs text-white/45">
          <span className={`tabular-nums ${play.seconds != null ? 'text-white/75' : 'text-white/35'}`}>{play.seconds != null ? formatTime(play.seconds) : '–:––'}</span>
          {play.ping != null ? ` · ${t('admin.ping', { ms: play.ping })}` : ''}
          {play.partyId ? ` · ${t('admin.plays.inParty', { partyId: play.partyId })}` : ''} · {ago(play.at)}
        </div>
      </div>
    </Link>
  );
};

/**
 * One song report (backend songReports.js): the song (opens it, where Fix
 * timing is), what is wrong, the reporter's note and what their device knew
 * then, and the buttons to settle it.
 */
const ReportRow = ({ report: r, busy, onReview }) => {
  const { t } = useTranslation();
  const ago = useAgo();
  const name = useName();
  const c = r.context ?? {};
  const facts = [
    c.videoTime != null ? t('admin.reports.at', { time: formatTime(c.videoTime) }) : null,
    c.gap != null ? t('admin.reports.gap', { ms: Math.round(c.gap) }) : null,
    c.delayMs != null ? t(c.delaySource === 'bleed' ? 'admin.reports.delayMeasured' : 'admin.reports.delayFixed', { ms: c.delayMs }) : null,
    c.isHost != null ? (c.isHost ? t('admin.reports.host') : t('admin.reports.joiner')) : null,
    r.userAgent ? deviceLabel(r.userAgent, r.os) : null,
  ].filter(Boolean);
  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link to={`/sing/${r.songId}`} className="flex items-center gap-3 min-w-0 rounded-xl -m-1.5 p-1.5 no-underline hover:bg-white/[0.05] transition-colors">
          <Thumb videoId={r.videoId} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{r.title ?? r.songId}</div>
            <div className="text-xs text-white/55 truncate">
              {r.artist}{r.openForSong > 1 && r.status === 'open' ? <span className="text-amber-300"> · {t('admin.reports.openForSong', { count: r.openForSong })}</span> : null}
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-2 flex-shrink-0">
          {r.status === 'open'
            ? (
              <>
                <button type="button" disabled={busy} onClick={() => onReview(r, 'resolved')} className={btn.primary}>{t('admin.reports.resolve')}</button>
                <button type="button" disabled={busy} onClick={() => onReview(r, 'dismissed')} className={btn.quiet}>{t('admin.reports.dismiss')}</button>
              </>
            )
            : <button type="button" disabled={busy} onClick={() => onReview(r, 'open')} className={btn.quiet}>{t('admin.reports.reopen')}</button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {r.kinds.map(k => <Badge key={k} tone={k === 'timing' ? 'magenta' : k === 'unavailable' ? 'red' : 'yellow'}>{t(`report.kinds.${k}`)}</Badge>)}
      </div>
      {r.comment && <p className="text-sm text-white/85 whitespace-pre-line break-words">{r.comment}</p>}
      <div className="text-xs text-white/45">
        {r.username
          ? <span className="font-medium text-neon-cyan">{r.username}</span>
          : <span>{r.nickname ? name(r.nickname) : t('admin.plays.guest')}</span>}
        {r.partyId ? ` · ${t('admin.plays.inParty', { partyId: r.partyId })}` : ''} · {ago(r.updatedAt ?? r.createdAt)}
        {facts.length ? ` · ${facts.join(' · ')}` : ''}
      </div>
      {r.status !== 'open' && (
        <div className="text-xs text-white/45">
          {t(`admin.reports.was.${r.status}`, { name: r.reviewedBy ?? '?', time: r.reviewedAt ? ago(r.reviewedAt) : '' })}
          {r.adminNote ? ` — ${r.adminNote}` : ''}
        </div>
      )}
    </li>
  );
};

/** One account with its numbers and its buttons (none on yourself); a picture can be taken down (moderation). */
const UserRow = ({ u, isMe, busy, onAct }) => {
  const { t } = useTranslation();
  const ago = useAgo();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-3 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        {/* Larger than elsewhere, so a picture can be judged from here */}
        <Avatar username={u.username} src={u.avatar} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/u/${encodeURIComponent(u.username)}`} className="text-white hover:text-white hover:underline decoration-white/30 underline-offset-4 font-semibold truncate">{u.username}</Link>
            {u.isAdmin && <Badge tone="magenta">{t('admin.users.admin')}</Badge>}
            {isMe && <Badge>{t('admin.users.you')}</Badge>}
            {!u.verified && <Badge tone="yellow">{t('admin.users.unverified')}</Badge>}
          </div>
          <div className="text-xs text-white/60 truncate">{u.email ?? '—'} · #{u.id}</div>
          <div className="text-xs text-white/40">
            {t('admin.users.joined', { time: ago(u.createdAt) })}
            {' · '}{u.lastLoginAt ? t('admin.users.lastLogin', { time: ago(u.lastLoginAt) }) : t('admin.users.neverSignedIn')}
            {' · '}{t('admin.users.scores', { count: u.scores ?? 0 })}
            {' · '}{t('admin.users.playsAsName', { count: u.playsAsName ?? 0 })}
            {' · '}{t('admin.users.passkeys', { count: u.passkeys })}
            {u.hasPassword ? ` · ${t('admin.users.password')}` : ''}
            {u.userAgent ? ` · ${deviceLabel(u.userAgent, u.os)}` : ''}
          </div>
        </div>
      </div>
      {!isMe && (
        <div className="flex items-center gap-1.5 sm:gap-2 max-w-full sm:flex-shrink-0 flex-wrap">
          <button type="button" disabled={busy} onClick={() => onAct('admin', u)} className={btn.quiet}>{u.isAdmin ? t('admin.users.removeAdmin') : t('admin.users.makeAdmin')}</button>
          <button type="button" disabled={busy} onClick={() => onAct('signout', u)} className={btn.quiet}>{t('admin.users.signOut')}</button>
          {u.avatar && <button type="button" disabled={busy} onClick={() => onAct('avatar', u)} className={btn.danger}>{t('admin.users.removeAvatar')}</button>}
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

  const [origins, setOrigins] = useState(null); // { days, referrers, arrivals, direct, countries }
  const [days, setDays] = useState(30);
  useEffect(() => {
    let active = true;
    setOrigins(null);
    getAdminOrigins(days).then(o => { if (active) setOrigins(o); }).catch(e => setErr(errorMessage(t, e)));
    return () => { active = false; };
  }, [days, t]);
  const sourceRows = buildSourceRows(origins, t); // sites, our own links (QR code, party and invite links) and direct visits
  const countryRows = origins ? origins.countries.map(c => ({ key: c.country, label: countryLabel(c.country, i18n.language), sessions: c.sessions, plays: c.plays })) : [];

  const [devices, setDevices] = useState(null); // { os, browsers, devices }
  useEffect(() => {
    let active = true;
    setDevices(null);
    getAdminDevices(days).then(d => { if (active) setDevices(d); }).catch(e => setErr(errorMessage(t, e)));
    return () => { active = false; };
  }, [days, t]);

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

  // Song reports: the open ones by default, reloaded when the overview (every
  // few seconds) counts a different number of open ones, so new ones show up
  const [reportStatus, setReportStatus] = useState('open');
  const [reports, setReports] = useState(null); // { rows, hasMore, counts }
  const loadReports = useCallback((status) => getAdminReports(status, 0, PAGE)
    .then(p => setReports({ rows: p.data, hasMore: p.hasMore, counts: p.counts, status }))
    .catch(e => setErr(errorMessage(t, e))), [t]);
  useEffect(() => { setReports(null); loadReports(reportStatus); }, [reportStatus, loadReports]);
  const openReports = overview?.reportsOpen;
  useEffect(() => {
    if (openReports == null || !reports || reports.counts?.open === openReports) return;
    loadReports(reportStatus);
  }, [openReports]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const moreReports = () => run(async () => {
    const p = await getAdminReports(reportStatus, reports.rows.length, PAGE);
    setReports(s => ({ ...s, rows: [...s.rows, ...p.data], hasMore: p.hasMore, counts: p.counts }));
  });
  const reviewReport = (r, status) => run(async () => {
    await adminReviewReport(r.id, status);
    setMsg(t(`admin.reports.marked.${status}`, { title: r.title ?? r.songId }));
    await loadReports(reportStatus);
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
    } else if (what === 'avatar') {
      if (!window.confirm(t('admin.users.removeAvatarConfirm', { username: u.username }))) return;
      run(async () => {
        await adminRemoveAvatar(u.id);
        replace({ ...u, avatar: null });
        setMsg(t('admin.users.avatarRemoved', { username: u.username }));
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

  const loading = <Loading>{t('sections.loading')}</Loading>;
  const aside = (text) => <span className="text-xs text-white/40">{text}</span>;

  return (
    <WrapperPage>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.025em] text-white">{t('admin.title')}</h1>
          <p className="mt-1 text-[15px] text-white/60">{t('admin.subtitle')}</p>
        </div>
        {updatedAt && <div className="text-xs text-white/40 tabular-nums">{t('admin.updated', { time: new Date(updatedAt).toLocaleTimeString(i18n.language) })}</div>}
      </div>

      {msg && <Notice className="mt-5">{msg}</Notice>}
      {err && <Notice tone="error" className="mt-5">{err}</Notice>}

      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 mt-6">
          <StatTile label={t('admin.stats.partiesRunning')} value={overview.partiesRunning} accent="text-neon-cyan" />
          <StatTile label={t('admin.stats.playersOnline')} value={overview.playersOnline} accent="text-neon-green" />
          <StatTile label={t('admin.stats.playsDay')} value={overview.playsDay ?? 0} />
          <StatTile label={t('admin.stats.playsWeek')} value={overview.playsWeek ?? 0} />
          <StatTile label={t('admin.stats.sungDay')} value={formatDuration(overview.secondsDay, i18n.language)} small />
          <StatTile label={t('admin.stats.sungWeek')} value={formatDuration(overview.secondsWeek, i18n.language)} small />
          <StatTile label={t('admin.stats.usersTotal')} value={overview.usersTotal ?? 0} accent="text-hot" />
          <StatTile label={t('admin.stats.usersDay')} value={overview.usersDay ?? 0} />
          <StatTile label={t('admin.stats.usersWeek')} value={overview.usersWeek ?? 0} />
          <StatTile label={t('admin.stats.scoresDay')} value={overview.scoresDay ?? 0} accent="text-amber-300" />
        </div>
      )}

      <AdminTrends />

      <Section title={t('admin.parties.title')} aside={overview && aside(t('admin.parties.count', { count: overview.parties.length }))}>
        {!overview
          ? loading
          : overview.parties.length === 0
            ? <p className="text-sm text-white/45">{t('admin.parties.none')}</p>
            : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{overview.parties.map(p => <PartyCard key={p.partyId} party={p} busy={busy} onClose={closeParty} />)}</div>}
      </Section>

      <Section
        title={t('admin.reports.title')}
        aside={(
          <FilterButtons
            options={['open', 'resolved', 'dismissed']}
            value={reportStatus}
            onChange={setReportStatus}
            label={s => t(`admin.reports.status.${s}`)}
            counts={reports?.counts}
          />
        )}
      >
        <Hint>{t('admin.reports.hint')}</Hint>
        {!reports
          ? loading
          : (
            <ul className={list}>
              {reports.rows.length === 0 && <li className="px-4 py-3 text-sm text-white/45">{t('admin.reports.none')}</li>}
              {reports.rows.map(r => <ReportRow key={r.id} report={r} busy={busy} onReview={reviewReport} />)}
            </ul>
          )}
        {reports?.hasMore && <button type="button" disabled={busy} onClick={moreReports} className={`${btn.quiet} mt-3`}>{t('admin.showMore')}</button>}
      </Section>

      <AdminChartJobs active={overview?.chartJobsActive} />

      <Section
        title={t('admin.origins.title')}
        aside={(
          <FilterButtons
            options={[7, 30, 365]}
            value={days}
            onChange={setDays}
            label={d => t('admin.origins.days', { count: d })}
          />
        )}
      >
        <Hint>{t('admin.origins.hint')}</Hint>
        {!origins
          ? loading
          : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className={card}>
                <div className={cardLabel}>{t('admin.origins.sources')}</div>
                <OriginList rows={sourceRows} empty={t('admin.origins.none')} />
              </div>
              <div className={card}>
                <div className={cardLabel}>{t('admin.origins.countries')}</div>
                <OriginList rows={countryRows} empty={t('admin.origins.noCountries')} />
              </div>
            </div>
          )}
      </Section>

      <Section title={t('admin.devices.title')} aside={aside(t('admin.origins.days', { count: days }))}>
        <Hint>{t('admin.devices.hint')}</Hint>
        {!devices
          ? loading
          : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {['os', 'versions', 'browsers', 'devices'].map(kind => (
                <div key={kind} className={card}>
                  <div className={cardLabel}>{t(`admin.devices.${kind}`)}</div>
                  <OriginList rows={deviceRows(kind === 'versions' ? devices[kind]?.slice(0, 20) : devices[kind], kind, t)} empty={t('admin.origins.none')} />
                </div>
              ))}
            </div>
          )}
      </Section>

      <Section title={t('admin.discovery.title')} aside={aside(t('admin.origins.days', { count: days }))}>
        <Hint>{t('admin.discovery.hint')}</Hint>
        {!discovery
          ? loading
          : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className={card}>
                <div className={cardLabel}>{t('admin.discovery.picks')}</div>
                <OriginList rows={pickRows} empty={t('admin.discovery.noPicks')} labels={[t('admin.discovery.picksUnit'), t('admin.discovery.browsersUnit')]} />
              </div>
              <div className={`${card} space-y-5`}>
                <div>
                  <div className={cardLabel}>{t('admin.discovery.searches')}</div>
                  {Object.keys(discovery.searches).length === 0 && <p className="text-sm text-white/45">{t('admin.discovery.noSearches')}</p>}
                  <div className="space-y-1">
                    {['entry', 'queue', 'youtube'].filter(s => discovery.searches[s]).map(s => {
                      const b = discovery.searches[s];
                      return (
                        <div key={s} className="text-sm text-white/65">
                          <span className="font-medium text-white">{t(`admin.discovery.sources.${s}`)}</span>
                          {': '}
                          {t('admin.discovery.searchLine', { sessions: b.sessions, hits: b.hits, pct: b.sessions ? Math.round((100 * b.hits) / b.sessions) : 0, empty: b.empty })}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className={cardLabel}>{t('admin.discovery.missed')}</div>
                  {discovery.topMissed.length === 0
                    ? <p className="text-sm text-white/45">{t('admin.discovery.noMissed')}</p>
                    : (
                      <ul className="text-sm divide-y divide-white/[0.07]">
                        {discovery.topMissed.map(m => (
                          <li key={m.q} className="flex justify-between gap-3 py-1.5 first:pt-0"><span className="text-white/85 truncate">{m.q}</span><span className="tabular-nums text-white/45 flex-shrink-0">{m.count}</span></li>
                        ))}
                      </ul>
                    )}
                </div>
                <div className="text-sm text-white/65 pt-3 border-t border-white/[0.07]">
                  {youtubeTotal === 0
                    ? <span className="text-white/45">{t('admin.discovery.noYoutube')}</span>
                    : t('admin.discovery.youtube', { lookups: youtubeTotal, exact: youtube.exact ?? 0, title: youtube.title ?? 0, none: youtube.none ?? 0 })}
                </div>
              </div>
            </div>
          )}
      </Section>

      <Section title={t('admin.plays.title')}>
        <Hint>{t('admin.plays.hint')}</Hint>
        {!plays
          ? loading
          : plays.rows.length === 0
            ? <p className="text-sm text-white/45">{t('admin.plays.none')}</p>
            : <div className={list}>{plays.rows.map(p => <PlayRow key={p.id} play={p} />)}</div>}
        {plays?.hasMore && <button type="button" disabled={busy} onClick={morePlays} className={`${btn.quiet} mt-3`}>{t('admin.showMore')}</button>}
      </Section>

      <Section title={t('admin.users.title')} aside={aside(users?.q ? '' : t('admin.users.newest'))}>
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
            <ul className={`mt-3 ${list}`}>
              {users.rows.length === 0 && <li className="px-4 py-3 text-sm text-white/45">{t('admin.users.none')}</li>}
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
  if (loading) return <WrapperPage><div className="text-white/40 text-sm text-center py-20 animate-pulse">{t('sections.loading')}</div></WrapperPage>;
  if (!user) return <Navigate to="/login?next=%2Fadmin" replace />;
  if (!user.isAdmin) return <NotFoundPage />;
  return <AdminConsole />;
};

export default AdminPage;
