import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import StarRating from '../components/StarRating';
import { Avatar } from '../components/AccountMenu';
import { useAuth } from '../logic/AuthContext';
import { starsFor } from '../logic/scoreScale';
import {
  getProfile, getFriends, getSuggestions, searchUsers, requestFriend, acceptFriend, removeFriend,
  registerPasskey, deletePasskey, updateAccount, deleteAccount, getMyScores, isCancelled,
} from '../logic/authApi';
import { appDomain } from '../GlobalConsts';
import { errorMessage } from './AuthPage';

const useDate = () => {
  const { i18n } = useTranslation();
  return (d) => (d ? new Date(d).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
};

const btn = {
  primary: 'px-3 py-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/40 hover:bg-neon-cyan/20 hover:border-neon-cyan text-sm font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  quiet: 'px-3 py-1.5 rounded-lg bg-surface-lighter/60 text-gray-300 border border-surface-lighter hover:text-white hover:border-gray-500 text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  danger: 'px-3 py-1.5 rounded-lg bg-surface-lighter/60 text-gray-400 border border-surface-lighter hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 text-sm transition-all cursor-pointer disabled:opacity-40',
};
const input = 'w-full px-3 py-2 rounded-lg bg-surface border border-surface-lighter text-white placeholder-gray-500 text-sm focus:outline-none focus:border-neon-cyan transition-all';

// ── Pieces ─────────────────────────────────────────────────────────────

const StatTile = ({ label, value, accent }) => (
  <div className="rounded-xl bg-surface-light border border-surface-lighter px-4 py-3 text-center">
    <div className={`text-2xl font-black font-mono leading-tight ${accent ?? 'text-white'}`}>{value}</div>
    <div className="text-xs text-gray-400 mt-0.5">{label}</div>
  </div>
);

/** One saved song: thumbnail, title, score and stars; links to the song. */
const SongRow = ({ row, date }) => (
  <Link to={`/sing/${row.songId}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5 transition-colors">
    {row.videoId
      ? <img src={`https://i.ytimg.com/vi/${row.videoId}/default.jpg`} alt="" className="w-14 h-10 rounded object-cover flex-shrink-0 bg-surface-lighter" loading="lazy" />
      : <div className="w-14 h-10 rounded bg-surface-lighter flex-shrink-0" />}
    <div className="flex-1 min-w-0">
      <div className="text-sm text-white truncate">{row.title ?? row.songId}</div>
      <div className="text-xs text-gray-400 truncate">{row.artist}{date ? <span className="text-gray-600"> · {date}</span> : null}</div>
    </div>
    <div className="text-right flex-shrink-0">
      <div className="font-mono font-bold text-neon-cyan text-sm leading-tight">{row.score.toLocaleString()}</div>
      <StarRating stars={row.stars ?? starsFor(row.score)} size={12} />
    </div>
  </Link>
);

/** Add / accept / cancel / remove, depending on the relation seen from the viewer. */
const FriendButton = ({ username, relation, onChange, compact = false }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) {
    // ?add=1 sends the request as soon as they are signed in
    return <Link to={`/login?next=${encodeURIComponent(`/u/${username}?add=1`)}`} className={btn.primary}>{t('friends.add')}</Link>;
  }
  const act = (fn) => async () => {
    setBusy(true);
    try { onChange(await fn(username)); } catch { /* transient; the page state stays */ } finally { setBusy(false); }
  };
  switch (relation) {
    case 'friends':
      return (
        <span className="inline-flex items-center gap-2">
          {!compact && <span className="text-sm text-neon-green font-semibold">✓ {t('friends.friends')}</span>}
          <button type="button" disabled={busy} onClick={act(removeFriend)} className={btn.danger}>{t('friends.remove')}</button>
        </span>
      );
    case 'outgoing':
      return <button type="button" disabled={busy} onClick={act(removeFriend)} className={btn.quiet} title={t('friends.requested')}>{t('friends.cancelRequest')}</button>;
    case 'incoming':
      return (
        <span className="inline-flex items-center gap-2">
          <button type="button" disabled={busy} onClick={act(acceptFriend)} className={btn.primary}>{t('friends.accept')}</button>
          <button type="button" disabled={busy} onClick={act(removeFriend)} className={btn.quiet}>{t('friends.decline')}</button>
        </span>
      );
    default:
      return <button type="button" disabled={busy} onClick={act(requestFriend)} className={btn.primary}>{t('friends.add')}</button>;
  }
};

const Section = ({ id, title, children, aside }) => (
  <section id={id} className="mt-8 scroll-mt-20">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

// ── Own profile: friends ───────────────────────────────────────────────

const FriendsSection = () => {
  const { t } = useTranslation();
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [suggested, setSuggested] = useState([]); // people you sang with, not friends yet
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const timer = useRef(null);

  const reload = useCallback(() => {
    getFriends().then(setData).catch(() => {});
    getSuggestions().then(setSuggested).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    if (!term) { setResults(null); return; }
    timer.current = setTimeout(() => searchUsers(term).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  const changed = (username) => (relation) => {
    setResults(r => r?.map(x => (x.username === username ? { ...x, relation } : x)) ?? r);
    reload();
  };

  const nameLink = (username) => (
    <Link to={`/u/${encodeURIComponent(username)}`} className="flex items-center gap-2 min-w-0 text-white hover:text-neon-cyan">
      <Avatar username={username} size={24} /><span className="truncate">{username}</span>
    </Link>
  );

  return (
    <Section id="friends" title={t('friends.title')} aside={<span className="text-xs text-gray-500">{t('friends.count', { count: data.friends.length })}</span>}>
      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={t('friends.search')}
        className={input}
        autoComplete="off"
      />
      {results && (
        <ul className="mt-2 rounded-lg border border-surface-lighter divide-y divide-surface-lighter bg-surface-light">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{t('friends.noResults')}</li>}
          {results.map(r => (
            <li key={r.username} className="flex items-center justify-between gap-3 px-3 py-2">
              {nameLink(r.username)}
              <FriendButton username={r.username} relation={r.relation} onChange={changed(r.username)} compact />
            </li>
          ))}
        </ul>
      )}

      {suggested.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">{t('profile.suggestions')}</div>
          <ul className="space-y-1.5">
            {suggested.map(s => (
              <li key={s.username} className="flex items-center justify-between gap-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/25 px-3 py-2">
                {nameLink(s.username)}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-gray-400 hidden sm:inline">{t('profile.songsTogether', { count: s.songsTogether })}</span>
                  <FriendButton username={s.username} relation={null} onChange={changed(s.username)} compact />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(data.incoming.length > 0 || data.outgoing.length > 0) && (
        <div className="mt-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">{t('friends.requests')}</div>
          <ul className="space-y-1.5">
            {data.incoming.map(r => (
              <li key={`in-${r.username}`} className="flex items-center justify-between gap-3 rounded-lg bg-neon-magenta/5 border border-neon-magenta/30 px-3 py-2">
                {nameLink(r.username)}
                <FriendButton username={r.username} relation="incoming" onChange={changed(r.username)} compact />
              </li>
            ))}
            {data.outgoing.map(r => (
              <li key={`out-${r.username}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface-light border border-surface-lighter px-3 py-2">
                {nameLink(r.username)}
                <FriendButton username={r.username} relation="outgoing" onChange={changed(r.username)} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-4 space-y-1.5">
        {data.friends.length === 0 && <li className="text-sm text-gray-500">{t('friends.none')}</li>}
        {data.friends.map(f => (
          <li key={f.username} className="flex items-center justify-between gap-3 rounded-lg bg-surface-light border border-surface-lighter px-3 py-2">
            {nameLink(f.username)}
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs text-gray-400 hidden sm:inline">{t('profile.songsSung')}: <span className="text-white">{f.songsSung}</span></span>
              <span className="text-xs text-yellow-400">★ {f.totalStars}</span>
              <FriendButton username={f.username} relation="friends" onChange={changed(f.username)} compact />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
};

// ── Own profile: account ───────────────────────────────────────────────

const AccountSection = () => {
  const { t } = useTranslation();
  const fmt = useDate();
  const navigate = useNavigate();
  const { user, setUser, refresh, logout } = useAuth();
  const [keyName, setKeyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [next, setNext] = useState('');
  const [name, setName] = useState(user.username);
  const inviteUrl = `https://${appDomain}/u/${encodeURIComponent(user.username)}?add=1`;

  const rename = (e) => {
    e.preventDefault();
    const wanted = name.trim();
    if (!wanted || wanted === user.username) return;
    run(async () => {
      const updated = await updateAccount({ username: wanted });
      setUser(updated);
      setMsg(t('profile.displayNameSaved'));
      navigate(`/u/${encodeURIComponent(updated.username)}#account`, { replace: true }); // the profile lives under the new name
    });
  };

  const run = async (fn) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); } catch (e) { if (!isCancelled(e)) setErr(errorMessage(t, e)); } finally { setBusy(false); }
  };

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setMsg(t('profile.inviteCopied')); }
    catch { window.prompt(t('profile.inviteLink'), inviteUrl); }
  };

  return (
    <Section id="account" title={t('profile.account')} aside={<button type="button" onClick={async () => { await logout(); navigate('/'); }} className={btn.quiet}>{t('auth.signOut')}</button>}>
      <div className="rounded-xl bg-surface-light border border-surface-lighter p-4 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-400 uppercase tracking-wider">{t('auth.email')}</div>
            <div className="text-sm text-white truncate">{user.email}</div>
          </div>
          <div className="text-right">
            <button type="button" onClick={copyInvite} className={btn.primary}>{t('profile.inviteLink')}</button>
            <div className="text-xs text-gray-500 mt-1">{t('profile.inviteHint')}</div>
          </div>
        </div>

        <form className="space-y-2" onSubmit={rename}>
          <div className="text-xs text-gray-400 uppercase tracking-wider">{t('auth.displayName')}</div>
          <div className="flex gap-2">
            <input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="nickname" autoCapitalize="none" spellCheck={false} maxLength={20} className={input} />
            <button type="submit" disabled={busy || !name.trim() || name.trim() === user.username} className={`${btn.primary} whitespace-nowrap`}>{t('profile.save')}</button>
          </div>
          <p className="text-xs text-gray-500">{t('auth.usernameHint')}</p>
        </form>

        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">{t('profile.passkeys')}</div>
          <ul className="space-y-1.5">
            {user.passkeys.length === 0 && <li className="text-sm text-gray-500">{t('profile.noPasskeys')}</li>}
            {user.passkeys.map(k => (
              <li key={k.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-white truncate">{k.name || t('profile.unnamedPasskey')}{k.backedUp ? ' ☁' : ''}</div>
                  <div className="text-xs text-gray-500">{k.lastUsedAt ? t('profile.lastUsed', { date: fmt(k.lastUsedAt) }) : t('profile.neverUsed')}</div>
                </div>
                <button type="button" disabled={busy} onClick={() => run(async () => { await deletePasskey(k.id); await refresh(); })} className={btn.danger}>{t('profile.remove')}</button>
              </li>
            ))}
          </ul>
          <form className="flex gap-2 mt-3" onSubmit={e => { e.preventDefault(); run(async () => { setUser(await registerPasskey({ name: keyName.trim() })); setKeyName(''); }); }}>
            <input type="text" value={keyName} onChange={e => setKeyName(e.target.value)} placeholder={t('profile.passkeyName')} maxLength={60} className={input} />
            <button type="submit" disabled={busy} className={`${btn.primary} whitespace-nowrap`}>{t('profile.addPasskey')}</button>
          </form>
        </div>

        <form className="space-y-2" onSubmit={e => { e.preventDefault(); run(async () => { setUser(await updateAccount({ newPassword: next })); setNext(''); setMsg(t('profile.passwordSaved')); }); }}>
          <div className="text-xs text-gray-400 uppercase tracking-wider">{user.hasPassword ? t('profile.changePassword') : t('profile.setPassword')}</div>
          <div className="flex gap-2">
            <input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder={t('auth.newPassword')} autoComplete="new-password" minLength={8} className={input} />
            <button type="submit" disabled={busy || next.length < 8} className={`${btn.primary} whitespace-nowrap`}>{t('profile.save')}</button>
          </div>
          <p className="text-xs text-gray-500">{t('auth.passwordHint')}</p>
        </form>

        {msg && <div className="text-sm text-neon-green">{msg}</div>}
        {err && <div className="text-sm text-red-400" role="alert">{err}</div>}

        <div className="pt-2 border-t border-surface-lighter">
          <button
            type="button"
            disabled={busy}
            onClick={() => { if (window.confirm(t('profile.deleteConfirm'))) run(async () => { await deleteAccount(); setUser(null); navigate('/'); }); }}
            className={btn.danger}
          >
            {t('profile.deleteAccount')}
          </button>
        </div>
      </div>
    </Section>
  );
};

// ── Page ───────────────────────────────────────────────────────────────

const ProfilePage = () => {
  const { t } = useTranslation();
  const fmt = useDate();
  const { username } = useParams();
  const [params, setParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null); // own profile: paged full history

  useEffect(() => {
    let active = true;
    setError(null);
    getProfile(username).then(d => { if (active) setData(d); }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, [username, user?.id]);

  // Invite link (/u/name?add=1): send the friend request as soon as we are signed in
  useEffect(() => {
    if (params.get('add') !== '1' || !user || !data || data.isMe) return;
    setParams(p => { const n = new URLSearchParams(p); n.delete('add'); return n; }, { replace: true });
    if (data.relation !== null && data.relation !== 'incoming') return; // a request from their side gets accepted
    requestFriend(data.user.username).then(relation => setData(d => ({ ...d, relation }))).catch(() => {});
  }, [params, user, data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.title = `${username} | singpro.app`; }, [username]);

  const loadMore = async () => {
    const offset = history?.rows.length ?? data.recent.length;
    const page = await getMyScores(offset, 20);
    setHistory(h => ({ rows: [...(h?.rows ?? data.recent), ...page.data], hasMore: page.hasMore }));
  };

  if (error) {
    return (
      <WrapperPage>
        <div className="text-center py-20">
          <div className="text-6xl mb-4">:(</div>
          <h2 className="text-2xl font-bold text-white mb-6">{t('profile.notFound')}</h2>
          <Link to="/" className="px-6 py-2 rounded-lg bg-surface-light border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 transition-all">{t('notFound.goHome')}</Link>
        </div>
      </WrapperPage>
    );
  }
  if (!data || authLoading) {
    return <WrapperPage><div className="text-neon-cyan text-center py-20 animate-pulse">{t('sections.loading')}</div></WrapperPage>;
  }

  const { stats, isMe } = data;
  const recentRows = history?.rows ?? data.recent;
  const hasMore = history ? history.hasMore : (isMe && data.recent.length >= 10);

  return (
    <WrapperPage>
      {/* Header */}
      <div className="rounded-2xl bg-surface-light border border-surface-lighter p-5 sm:p-6 flex flex-wrap items-center gap-4 sm:gap-6">
        <Avatar username={data.user.username} size={72} className="text-3xl" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-white truncate">{data.user.username}</h1>
          <div className="text-sm text-gray-400">{t('profile.memberSince', { date: fmt(data.user.createdAt) })}</div>
          <div className="mt-1"><StarRating stars={Math.min(3, Math.round((stats.averageBest / 10000) * 3))} size={18} label={`${stats.averageBest}`} /></div>
        </div>
        <div className="flex-shrink-0">
          {isMe
            ? <a href="#account" className={btn.quiet}>{t('profile.account')}</a>
            : <FriendButton username={data.user.username} relation={data.relation} onChange={(relation) => setData(d => ({ ...d, relation }))} />}
        </div>
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mt-4">
        <StatTile label={t('profile.songsSung')} value={stats.songsSung} />
        <StatTile label={t('profile.totalStars')} value={`★ ${stats.totalStars}`} accent="text-yellow-400" />
        <StatTile label={t('profile.threeStars')} value={stats.threeStars} accent="text-neon-magenta" />
        <StatTile label={t('profile.averageBest')} value={stats.averageBest.toLocaleString()} accent="text-neon-cyan" />
        <StatTile label={t('profile.plays')} value={stats.plays} />
        <StatTile label={t('friends.title')} value={stats.friends} accent="text-neon-green" />
      </div>

      {/* Best songs */}
      <Section title={t('profile.bestSongs')}>
        {data.topSongs.length === 0
          ? <p className="text-sm text-gray-500">{isMe ? t('profile.noScores') : t('profile.noScoresOther', { username: data.user.username })}</p>
          : <div className="rounded-xl bg-surface-light border border-surface-lighter p-1.5 space-y-0.5">{data.topSongs.map(r => <SongRow key={r.songId} row={r} />)}</div>}
      </Section>

      {/* Recent */}
      {recentRows.length > 0 && (
        <Section title={t('profile.recent')}>
          <div className="rounded-xl bg-surface-light border border-surface-lighter p-1.5 space-y-0.5">
            {recentRows.map(r => <SongRow key={r.id ?? `${r.songId}-${r.sungAt}`} row={r} date={fmt(r.sungAt)} />)}
          </div>
          {hasMore && <button type="button" onClick={loadMore} className={`${btn.quiet} mt-3`}>{t('profile.showMore')}</button>}
        </Section>
      )}

      {isMe && <FriendsSection />}
      {isMe && user && <AccountSection />}
    </WrapperPage>
  );
};

export default ProfilePage;
