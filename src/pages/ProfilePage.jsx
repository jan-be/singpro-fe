import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import StarRating from '../components/StarRating';
import Avatar from '../components/Avatar';
import { useAvatarEditor } from '../components/AvatarEditor';
import ReportPicture from '../components/ReportPicture';
import { GlobeIcon, LockIcon, DuetIcon as FriendsIcon } from '../components/Icons';
import { useNotifications } from '../logic/NotificationsContext';
import { STATS_VISIBILITY, statsVisibilityOf, isPrivateProfile } from '../logic/statsPrivacy';
import { useAuth } from '../logic/AuthContext';
import { completionText, starsFor } from '../logic/scoreScale';
import { creditLine, fraction, profileList, progressText } from '../logic/achievements';
import { profileView, sungTime } from '../logic/profileStats';
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

// Row and header buttons: the main action filled, the rest quiet; removing turns red only on hover
const btn = {
  primary: 'btn btn-primary no-underline',
  quiet: 'btn btn-ghost no-underline',
  danger: 'btn btn-ghost hover:text-red-300 hover:bg-red-500/10 hover:border-red-400/30',
};
const sm = (cls) => `${cls} btn-sm`;
const input = 'field h-10 px-4 text-sm';
// A list in a panel: hairline rows on violet
const listBox = 'rounded-2xl bg-panel border border-white/10 divide-y divide-white/[0.07] overflow-hidden';
const rowBox = 'flex items-center justify-between gap-3 px-4 py-2.5';
// The profile's header card, with a stage light from the top left like the page behind it
const headerCard = 'relative overflow-hidden rounded-3xl bg-panel border border-white/10 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)] p-5 sm:p-7 flex flex-wrap items-center gap-4 sm:gap-6';
const stageLight = 'absolute inset-0 pointer-events-none bg-[radial-gradient(520px_240px_at_0%_0%,rgba(255,79,216,0.18),transparent_70%)]';

// ── Pieces ─────────────────────────────────────────────────────────────

const StatTile = ({ label, value }) => (
  <div className="rounded-2xl bg-panel border border-white/10 px-3 py-3.5 text-center min-w-0">
    <div className="text-2xl font-semibold tracking-[-0.02em] tabular-nums leading-tight text-white truncate">{value}</div>
    <div className="text-xs text-white/55 mt-1 truncate">{label}</div>
  </div>
);

/**
 * One song: thumbnail, title, score and stars (and, for a duet, the part
 * sung); links to the song. A played song without a score says so, and a
 * partial play shows how far it got instead of stars.
 */
const SongRow = ({ row, date }) => {
  const { t, i18n } = useTranslation();
  // A play stopped too early to count as the song's (the server says which):
  // its score is out of the whole song, so it gets no stars, and the row says
  // how far it got instead
  const partial = row.partial && Number.isFinite(row.completion);
  return (
  <Link to={`/sing/${row.songId}`} className="flex items-center gap-3 px-3 py-2.5 no-underline hover:bg-white/[0.04] transition-colors">
    {row.videoId
      ? <img src={`https://i.ytimg.com/vi/${row.videoId}/mqdefault.jpg`} alt="" className="w-16 h-9 rounded-lg object-cover flex-shrink-0 bg-white/[0.06] ring-1 ring-inset ring-white/10" loading="lazy" />
      : <div className="w-16 h-9 rounded-lg bg-white/[0.06] flex-shrink-0" />}
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-white truncate">{row.title ?? row.songId}</div>
      <div className="text-xs text-white/50 truncate">
        {row.artist}
        {row.part ? <span className="text-hot/85"> · {row.part === 2 ? t('party.duetP2') : t('party.duetP1')}</span> : null}
        {partial ? <span className="text-white/70" title={t('profile.stoppedHint')}> · {t('profile.stoppedAt', { percent: completionText(row.completion, i18n.language) })}</span> : null}
        {date ? <span className="text-white/35"> · {date}</span> : null}
      </div>
    </div>
    {row.score == null ? (
      <div className="text-xs text-white/40 flex-shrink-0">{t('profile.notScored')}</div>
    ) : (
      <div className="text-right flex-shrink-0" title={partial ? t('profile.stoppedHint') : undefined}>
        <div className={`font-mono font-medium text-sm tabular-nums leading-tight ${partial ? 'text-white/60' : 'text-white'}`}>{row.score.toLocaleString()}</div>
        {!partial && <StarRating stars={row.stars ?? starsFor(row.score)} size={12} />}
      </div>
    )}
  </Link>
  );
};

/** Add / accept / cancel / remove, depending on the relation seen from the viewer. */
const FriendButton = ({ username, relation, onChange, compact = false }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  // In a list row the buttons are the small size; on the profile header the regular one
  const b = compact ? { primary: sm(btn.primary), quiet: sm(btn.quiet), danger: sm(btn.danger) } : btn;
  if (!user) {
    // ?add=1 sends the request as soon as they are signed in
    return <Link to={`/login?next=${encodeURIComponent(`/u/${username}?add=1`)}`} className={b.primary}>{t('friends.add')}</Link>;
  }
  const act = (fn) => async () => {
    setBusy(true);
    try { onChange(await fn(username)); } catch { /* transient; the page state stays */ } finally { setBusy(false); }
  };
  switch (relation) {
    case 'friends':
      return (
        <span className="inline-flex items-center gap-3">
          {!compact && <span className="text-sm text-emerald-300 font-medium">✓ {t('friends.friends')}</span>}
          <button type="button" disabled={busy} onClick={act(removeFriend)} className={b.danger}>{t('friends.remove')}</button>
        </span>
      );
    case 'outgoing':
      return <button type="button" disabled={busy} onClick={act(removeFriend)} className={b.quiet} title={t('friends.requested')}>{t('friends.cancelRequest')}</button>;
    case 'incoming':
      return (
        <span className="inline-flex items-center gap-2">
          <button type="button" disabled={busy} onClick={act(acceptFriend)} className={b.primary}>{t('friends.accept')}</button>
          <button type="button" disabled={busy} onClick={act(removeFriend)} className={b.quiet}>{t('friends.decline')}</button>
        </span>
      );
    default:
      return <button type="button" disabled={busy} onClick={act(requestFriend)} className={b.primary}>{t('friends.add')}</button>;
  }
};

const Section = ({ id, title, children, aside }) => (
  <section id={id} className="mt-10 scroll-mt-20">
    <div className="flex items-center justify-between gap-3 mb-3 min-h-8">
      <h2 className="text-lg font-semibold tracking-[-0.02em] text-white">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

// ── Achievements ───────────────────────────────────────────────────────

/**
 * One achievement: its icon, its name (a nod to a song, credited under it),
 * what it takes, and when it was earned or, on your own profile, how far
 * along you are.
 */
const AchievementCard = ({ item, date }) => {
  const { t, i18n } = useTranslation();
  const { info } = item;
  const done = Boolean(item.unlockedAt);
  const showProgress = !done && item.progress != null;
  return (
    <li
      className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 ${done ? 'bg-panel bg-[linear-gradient(135deg,rgba(255,92,214,0.11),rgba(192,75,255,0.04)_55%,transparent)] border-white/10' : 'bg-white/[0.025] border-white/[0.06]'}`}
      title={done ? t('achievements.unlockedOn', { date }) : t('achievements.locked')}
    >
      <span
        aria-hidden="true"
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xl ${done ? 'bg-gradient-to-br from-hot/30 to-neon-purple/25 ring-1 ring-inset ring-white/15' : 'bg-white/[0.06] grayscale opacity-40'}`}
      >
        {info.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm font-semibold tracking-[-0.01em] truncate ${done ? 'text-white' : 'text-white/55'}`}>{info.name}</span>
          {done && <span className="text-[11px] text-white/40 flex-shrink-0">{date}</span>}
          {showProgress && <span className="text-[11px] tabular-nums text-white/45 flex-shrink-0">{progressText(item, i18n.language)}</span>}
        </div>
        <div className={`text-[11px] truncate ${done ? 'text-hot/80' : 'text-white/35'}`}>♪ {creditLine(info)}</div>
        <div className={`text-xs mt-0.5 ${done ? 'text-white/65' : 'text-white/40'}`}>
          {!done && <span className="sr-only">{t('achievements.locked')}: </span>}
          {t(`achievements.desc.${item.key}`)}
        </div>
        {showProgress && (
          <div className="h-1 rounded-full bg-white/10 mt-2 overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full bg-gradient-to-r from-[#ff5cd6] to-[#c04bff]" style={{ width: `${Math.round(fraction(item) * 100)}%` }} />
          </div>
        )}
      </div>
    </li>
  );
};

/**
 * What the singer earned; on your own profile also the few you are closest
 * to. "Show all" unfolds the whole catalogue (the rest greyed out).
 */
const AchievementsSection = ({ items, isMe, username }) => {
  const { t } = useTranslation();
  const fmt = useDate();
  const [expanded, setExpanded] = useState(false);
  const all = profileList(items, { expanded: true });
  if (all.length === 0) return null;
  const shown = profileList(items, { expanded });
  const unlocked = all.filter(a => a.unlockedAt).length;
  return (
    <Section
      id="achievements"
      title={t('achievements.title')}
      aside={<span className="text-xs text-white/45 tabular-nums">{t('achievements.count', { unlocked, total: all.length })}</span>}
    >
      {unlocked === 0 && !expanded && (
        <p className="text-sm text-white/50 mb-3">{isMe ? t('achievements.none') : t('achievements.noneOther', { username })}</p>
      )}
      {shown.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {shown.map(a => <AchievementCard key={a.key} item={a} date={fmt(a.unlockedAt)} />)}
        </ul>
      )}
      {(expanded || shown.length < all.length) && (
        <button type="button" onClick={() => setExpanded(e => !e)} className={`${sm(btn.quiet)} mt-3`} aria-expanded={expanded}>
          {expanded ? t('achievements.showLess') : t('achievements.showAll')}
        </button>
      )}
    </Section>
  );
};

// ── Own profile: friends ───────────────────────────────────────────────

const FriendsSection = () => {
  const { t } = useTranslation();
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [suggested, setSuggested] = useState([]); // people you sang with, not friends yet
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const timer = useRef(null);
  // The bell answers requests too and notices new ones: reload when they change
  const { requestsKey, refresh: refreshNotifications } = useNotifications();

  const reload = useCallback(() => {
    getFriends().then(setData).catch(() => {});
    getSuggestions().then(setSuggested).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload, requestsKey]);

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
    refreshNotifications();
  };

  const nameLink = (username, avatar) => (
    <Link to={`/u/${encodeURIComponent(username)}`} className="flex items-center gap-2.5 min-w-0 text-sm font-medium text-white no-underline hover:text-white/75">
      <Avatar username={username} src={avatar} size={28} /><span className="truncate">{username}</span>
    </Link>
  );

  return (
    <Section id="friends" title={t('friends.title')} aside={<span className="text-xs text-white/45">{t('friends.count', { count: data.friends.length })}</span>}>
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/45 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('friends.search')}
          className={`${input} h-11 pl-10`}
          autoComplete="off"
        />
      </div>
      {results && (
        <ul className={`mt-2 ${listBox}`}>
          {results.length === 0 && <li className="px-4 py-3 text-sm text-white/45">{t('friends.noResults')}</li>}
          {results.map(r => (
            <li key={r.username} className={rowBox}>
              {nameLink(r.username, r.avatar)}
              <FriendButton username={r.username} relation={r.relation} onChange={changed(r.username)} compact />
            </li>
          ))}
        </ul>
      )}

      {suggested.length > 0 && (
        <div className="mt-5">
          <div className="pop-label mb-2">{t('profile.suggestions')}</div>
          <ul className={listBox}>
            {suggested.map(s => (
              <li key={s.username} className={rowBox}>
                {nameLink(s.username, s.avatar)}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-white/50 hidden sm:inline">{t('profile.songsTogether', { count: s.songsTogether })}</span>
                  <FriendButton username={s.username} relation={null} onChange={changed(s.username)} compact />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(data.incoming.length > 0 || data.outgoing.length > 0) && (
        <div className="mt-5">
          <div className="pop-label mb-2">{t('friends.requests')}</div>
          <ul className={listBox}>
            {data.incoming.map(r => (
              <li key={`in-${r.username}`} className={`${rowBox} bg-hot/[0.06]`}>
                {nameLink(r.username, r.avatar)}
                <FriendButton username={r.username} relation="incoming" onChange={changed(r.username)} compact />
              </li>
            ))}
            {data.outgoing.map(r => (
              <li key={`out-${r.username}`} className={rowBox}>
                {nameLink(r.username, r.avatar)}
                <FriendButton username={r.username} relation="outgoing" onChange={changed(r.username)} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5">
        {data.friends.length === 0
          ? <p className="text-sm text-white/50">{t('friends.none')}</p>
          : (
            <ul className={listBox}>
              {data.friends.map(f => (
                <li key={f.username} className={rowBox}>
                  {nameLink(f.username, f.avatar)}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* A friend who keeps their stats private comes without numbers */}
                    {f.private ? (
                      <span className="inline-flex items-center gap-1 text-xs text-white/45" title={t('privacy.profileTitle')}><LockIcon size={12} />{t('privacy.private')}</span>
                    ) : (
                      <>
                        <span className="text-xs text-white/50 hidden sm:inline">{t('profile.songsSung')}: <span className="text-white tabular-nums">{f.songsSung}</span></span>
                        <span className="text-xs text-white/70 tabular-nums"><span className="text-yellow-400">★</span> {f.totalStars}</span>
                      </>
                    )}
                    <FriendButton username={f.username} relation="friends" onChange={changed(f.username)} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Section>
  );
};

// ── Own profile: privacy ───────────────────────────────────────────────

const PRIVACY_ICONS = { public: GlobeIcon, friends: FriendsIcon, private: LockIcon };

/**
 * Who sees your stats: everyone, or only you (logic/statsPrivacy.js). Saved
 * as soon as one is picked. The score you sing in a party is the party's
 * either way, which the note under the choice says.
 */
const PrivacySection = () => {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { text, error? }
  const current = statsVisibilityOf(user);

  const choose = async (statsVisibility) => {
    if (statsVisibility === current) return;
    setBusy(true); setNote(null);
    try {
      setUser(await updateAccount({ statsVisibility }));
      setNote({ text: t('privacy.saved') });
    } catch (e) {
      setNote({ text: errorMessage(t, e), error: true });
    } finally { setBusy(false); }
  };

  return (
    <Section id="privacy" title={t('privacy.title')}>
      <div className="rounded-2xl bg-panel border border-white/10 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-3 min-h-5">
          <div id="privacy-stats-label" className="pop-label">{t('privacy.statsLabel')}</div>
          {note && <span role={note.error ? 'alert' : 'status'} className={`text-xs ${note.error ? 'text-red-300' : 'text-emerald-200'}`}>{note.text}</span>}
        </div>
        <div role="radiogroup" aria-labelledby="privacy-stats-label" className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {STATS_VISIBILITY.map(v => {
            const Icon = PRIVACY_ICONS[v];
            const on = current === v;
            return (
              <label
                key={v}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white/70 has-[:focus-visible]:outline-offset-2 ${
                  on ? 'border-hot/50 bg-hot/[0.09]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'} ${busy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
              >
                <input type="radio" name="stats-visibility" value={v} checked={on} disabled={busy} onChange={() => choose(v)} className="sr-only" />
                <span aria-hidden="true" className={`flex-shrink-0 w-9 h-9 rounded-full grid place-items-center ${on ? 'fill-hot' : 'bg-white/[0.07] text-white/65'}`}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{t(`privacy.${v}`)}</span>
                  <span className="block text-xs text-white/55 mt-0.5">{t(`privacy.${v}Hint`)}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-white/45 mt-3">{t('privacy.partyNote')}</p>
      </div>
    </Section>
  );
};

// ── Own profile: account ───────────────────────────────────────────────

/**
 * Your picture in the account panel: the circle as others see it, and the
 * buttons to add, change or remove it (the editor lives on the page, so the
 * header's camera button opens the same one).
 */
const PictureRow = ({ user, editor, note }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4">
      <Avatar username={user.username} src={user.avatar} size={56} className="text-2xl" />
      <div className="min-w-0 flex-1">
        <div className="pop-label">{t('avatar.title')}</div>
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" disabled={editor.busy} onClick={editor.choose} className={sm(user.avatar ? btn.quiet : btn.primary)}>
            {user.avatar ? t('avatar.change') : t('avatar.add')}
          </button>
          {user.avatar && <button type="button" disabled={editor.busy} onClick={editor.remove} className={sm(btn.danger)}>{t('avatar.remove')}</button>}
        </div>
        <p className="text-xs text-white/45 mt-1.5">{t('avatar.hint')}</p>
        {note && <p className={`text-xs mt-1.5 ${note.error ? 'text-red-300' : 'text-emerald-200'}`} role={note.error ? 'alert' : undefined}>{note.text}</p>}
      </div>
    </div>
  );
};

const AccountSection = ({ editor, avatarNote }) => {
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
    <Section id="account" title={t('profile.account')} aside={<button type="button" onClick={async () => { await logout(); navigate('/'); }} className={sm(btn.quiet)}>{t('auth.signOut')}</button>}>
      <div className="rounded-2xl bg-panel border border-white/10 p-5 sm:p-6 space-y-6">
        <PictureRow user={user} editor={editor} note={avatarNote} />

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pt-6 border-t border-white/[0.07]">
          <div className="min-w-0">
            <div className="pop-label">{t('auth.email')}</div>
            <div className="text-sm text-white truncate mt-1">{user.email}</div>
          </div>
          <div className="sm:text-right">
            <button type="button" onClick={copyInvite} className={btn.primary}>{t('profile.inviteLink')}</button>
            <div className="text-xs text-white/45 mt-1.5">{t('profile.inviteHint')}</div>
          </div>
        </div>

        <form className="space-y-2 pt-6 border-t border-white/[0.07]" onSubmit={rename}>
          <div className="pop-label">{t('auth.displayName')}</div>
          <div className="flex gap-2">
            <input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="nickname" autoCapitalize="none" spellCheck={false} maxLength={20} className={input} />
            <button type="submit" disabled={busy || !name.trim() || name.trim() === user.username} className={btn.quiet}>{t('profile.save')}</button>
          </div>
          <p className="text-xs text-white/45">{t('auth.usernameHint')}</p>
        </form>

        <div className="pt-6 border-t border-white/[0.07]">
          <div className="pop-label mb-2">{t('profile.passkeys')}</div>
          {user.passkeys.length === 0
            ? <p className="text-sm text-white/50">{t('profile.noPasskeys')}</p>
            : (
              <ul className="rounded-xl border border-white/10 divide-y divide-white/[0.07] overflow-hidden">
                {user.passkeys.map(k => (
                  <li key={k.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="text-white font-medium truncate">{k.name || t('profile.unnamedPasskey')}{k.backedUp ? ' ☁' : ''}</div>
                      <div className="text-xs text-white/45">{k.lastUsedAt ? t('profile.lastUsed', { date: fmt(k.lastUsedAt) }) : t('profile.neverUsed')}</div>
                    </div>
                    <button type="button" disabled={busy} onClick={() => run(async () => { await deletePasskey(k.id); await refresh(); })} className={sm(btn.danger)}>{t('profile.remove')}</button>
                  </li>
                ))}
              </ul>
            )}
          <form className="flex gap-2 mt-3" onSubmit={e => { e.preventDefault(); run(async () => { setUser(await registerPasskey({ name: keyName.trim() })); setKeyName(''); }); }}>
            <input type="text" value={keyName} onChange={e => setKeyName(e.target.value)} placeholder={t('profile.passkeyName')} maxLength={60} className={input} />
            <button type="submit" disabled={busy} className={btn.quiet}>{t('profile.addPasskey')}</button>
          </form>
        </div>

        <form className="space-y-2 pt-6 border-t border-white/[0.07]" onSubmit={e => { e.preventDefault(); run(async () => { setUser(await updateAccount({ newPassword: next })); setNext(''); setMsg(t('profile.passwordSaved')); }); }}>
          <div className="pop-label">{user.hasPassword ? t('profile.changePassword') : t('profile.setPassword')}</div>
          <div className="flex gap-2">
            <input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder={t('auth.newPassword')} autoComplete="new-password" minLength={8} className={input} />
            <button type="submit" disabled={busy || next.length < 8} className={btn.quiet}>{t('profile.save')}</button>
          </div>
          <p className="text-xs text-white/45">{t('auth.passwordHint')}</p>
        </form>

        {msg && <div className="rounded-xl bg-emerald-400/10 border border-emerald-400/20 px-3.5 py-2.5 text-sm text-emerald-200">{msg}</div>}
        {err && <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 text-sm text-red-300" role="alert">{err}</div>}

        <div className="pt-6 border-t border-white/[0.07]">
          <button
            type="button"
            disabled={busy}
            onClick={() => { if (window.confirm(t('profile.deleteConfirm'))) run(async () => { await deleteAccount(); setUser(null); navigate('/'); }); }}
            className="btn btn-sm btn-stop"
          >
            {t('profile.deleteAccount')}
          </button>
        </div>
      </div>
    </Section>
  );
};

// ── Someone else's private profile ─────────────────────────────────────

/**
 * A profile whose owner keeps their stats private (logic/statsPrivacy.js):
 * the header as everyone sees it, without the stars, and a note where the
 * numbers, achievements and songs would be. Friends see it the same way.
 */
const PrivateProfile = ({ data, onRelation }) => {
  const { t } = useTranslation();
  const fmt = useDate();
  const { user } = data;
  return (
    <WrapperPage>
      <div className={headerCard}>
        <div className={stageLight} aria-hidden="true" />
        <Avatar username={user.username} src={user.avatar} size={72} className="text-3xl relative" />
        <div className="relative flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-white truncate">{user.username}</h1>
          <div className="text-sm text-white/55 mt-0.5">{t('profile.memberSince', { date: fmt(user.createdAt) })}</div>
          {user.avatar && <ReportPicture path={user.avatar} where={{ place: 'profile' }} className="mt-1.5" />}
        </div>
        <div className="relative w-full pl-[88px] sm:w-auto sm:pl-0 sm:flex-shrink-0">
          <FriendButton username={user.username} relation={data.relation} onChange={onRelation} />
        </div>
      </div>

      <div className="mt-3 sm:mt-4 rounded-2xl bg-panel border border-white/10 px-6 py-10 text-center">
        <span aria-hidden="true" className="mx-auto w-12 h-12 rounded-full grid place-items-center bg-white/[0.07] ring-1 ring-inset ring-white/10 text-white/70">
          {data.friendsOnly ? <FriendsIcon size={20} /> : <LockIcon size={20} />}
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-white">{t(data.friendsOnly ? 'privacy.friendsOnlyTitle' : 'privacy.profileTitle')}</h2>
        <p className="mt-1 text-sm text-white/55 max-w-sm mx-auto">{t(data.friendsOnly ? 'privacy.friendsOnlyText' : 'privacy.profileText', { username: user.username })}</p>
      </div>
    </WrapperPage>
  );
};

// ── Page ───────────────────────────────────────────────────────────────

const ProfilePage = () => {
  const { t, i18n } = useTranslation();
  const fmt = useDate();
  const { username } = useParams();
  const [params, setParams] = useSearchParams();
  const { user, loading: authLoading, refresh: refreshMe } = useAuth();
  const [data, setData] = useState(null);
  // Your own picture: the header shows the new one at once, the account menu after /auth/me
  const [avatarNote, setAvatarNote] = useState(null);
  const editor = useAvatarEditor({
    onChange: (avatar) => { setData(d => (d ? { ...d, user: { ...d.user, avatar } } : d)); refreshMe(); },
    onMessage: (text) => setAvatarNote({ text }),
    onError: (text) => setAvatarNote({ text, error: true }),
  });
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

  // The bell links to #achievements and #friends: those sections exist once the profile is loaded
  const { hash } = useLocation();
  useEffect(() => {
    if (!data || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, hash]);

  const loadMore = async () => {
    const offset = history?.rows.length ?? data.recent.length;
    const page = await getMyScores(offset, 20);
    setHistory(h => ({ rows: [...(h?.rows ?? data.recent), ...page.data], hasMore: page.hasMore }));
  };

  if (error) {
    return (
      <WrapperPage>
        <div className="text-center py-20">
          <div className="text-6xl mb-4 text-white/40 font-semibold">:(</div>
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-white mb-6">{t('profile.notFound')}</h2>
          <Link to="/" className="btn btn-primary no-underline">{t('notFound.goHome')}</Link>
        </div>
      </WrapperPage>
    );
  }
  if (!data || authLoading) {
    return <WrapperPage><div className="text-white/40 text-sm text-center py-20 animate-pulse">{t('sections.loading')}</div></WrapperPage>;
  }

  // Someone else who keeps their stats private: the name and picture, nothing else
  if (isPrivateProfile(data)) return <PrivateProfile data={data} onRelation={(relation) => setData(d => ({ ...d, relation }))} />;

  const { stats, isMe } = data;
  const recentRows = history?.rows ?? data.recent;
  const hasMore = history ? history.hasMore : (isMe && data.recent.length >= 10);
  // Scores, songs played without a score yet, or nothing (logic/profileStats.js)
  const { kind, played } = profileView(stats);
  const hasScores = kind === 'scores';
  const playedRows = data.playedRecently ?? [];
  // Under the name: since when, and with scores also in how many parties and
  // how long on the mic (without, the parties have a tile of their own)
  const timeSung = sungTime(stats.secondsSung, i18n.language);
  const facts = [
    t('profile.memberSince', { date: fmt(data.user.createdAt) }),
    ...(hasScores && stats.parties > 0 ? [t('profile.partiesCount', { count: stats.parties })] : []),
    ...(timeSung ? [t('profile.timeSung', { time: timeSung })] : []),
  ];

  return (
    <WrapperPage>
      {/* Header */}
      <div className={headerCard}>
        <div className={stageLight} aria-hidden="true" />
        {isMe ? (
          // Your own: the picture opens the picker, the camera says so
          <button type="button" onClick={editor.choose} disabled={editor.busy} className="relative rounded-full flex-shrink-0 group" aria-label={data.user.avatar ? t('avatar.change') : t('avatar.add')} title={data.user.avatar ? t('avatar.change') : t('avatar.add')}>
            <Avatar username={data.user.username} src={data.user.avatar} size={72} className="text-3xl transition-opacity group-hover:opacity-85" />
            <span aria-hidden="true" className="absolute -right-0.5 -bottom-0.5 w-7 h-7 rounded-full fill-hot grid place-items-center ring-2 ring-panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            </span>
          </button>
        ) : (
          <Avatar username={data.user.username} src={data.user.avatar} size={72} className="text-3xl relative" />
        )}
        <div className="relative flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-white truncate">{data.user.username}</h1>
          {/* a phone breaks the line between the facts, not inside one */}
          <div className="text-sm text-white/55 mt-0.5">
            {facts.map((f, i) => <React.Fragment key={i}>{i > 0 && ' · '}<span className="whitespace-nowrap">{f}</span></React.Fragment>)}
          </div>
          {hasScores && <div className="mt-1.5"><StarRating stars={Math.min(3, Math.round((stats.averageBest / 10000) * 3))} size={18} label={`${stats.averageBest}`} /></div>}
          {/* Someone else's picture can be reported to the admins (guests too) */}
          {!isMe && data.user.avatar && <ReportPicture path={data.user.avatar} where={{ place: 'profile' }} className="mt-1.5" />}
          {/* Your stats kept private, or to friends: who else sees what follows */}
          {isMe && statsVisibilityOf(user) !== 'public' && (
            <a href="#privacy" title={t(statsVisibilityOf(user) === 'friends' ? 'privacy.onlyFriends' : 'privacy.onlyYou')} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/75 no-underline hover:bg-white/15 hover:text-white transition-colors">
              {statsVisibilityOf(user) === 'friends' ? <><FriendsIcon size={12} />{t('privacy.friends')}</> : <><LockIcon size={12} />{t('privacy.private')}</>}
            </a>
          )}
        </div>
        {/* On a phone the button gets its own row under the name, so the name keeps the width */}
        <div className="relative w-full pl-[88px] sm:w-auto sm:pl-0 sm:flex-shrink-0">
          {isMe
            ? <a href="#account" className={btn.quiet}>{t('profile.account')}</a>
            : <FriendButton username={data.user.username} relation={data.relation} onChange={(relation) => setData(d => ({ ...d, relation }))} />}
        </div>
      </div>

      {/* Numbers */}
      {hasScores ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mt-3 sm:mt-4">
          <StatTile label={t('profile.songsSung')} value={stats.songsSung} />
          <StatTile label={t('profile.totalStars')} value={<><span className="text-yellow-400">★</span> {stats.totalStars}</>} />
          <StatTile label={t('profile.threeStars')} value={stats.threeStars} />
          <StatTile label={t('profile.averageBest')} value={stats.averageBest.toLocaleString()} />
          <StatTile label={t('profile.played')} value={played} />
          <StatTile label={t('friends.title')} value={stats.friends} />
        </div>
      ) : kind === 'played' ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-3 sm:mt-4">
          <StatTile label={t('profile.played')} value={played} />
          <StatTile label={t('profile.parties')} value={stats.parties ?? 0} />
          <StatTile label={t('friends.title')} value={stats.friends} />
        </div>
      ) : (
        <div className="mt-3 sm:mt-4 rounded-2xl bg-panel border border-white/10 px-5 py-6 sm:px-7 text-center">
          {isMe ? (
            <>
              <div className="text-base font-semibold text-white">{t('profile.emptyTitle')}</div>
              <p className="text-sm text-white/55 mt-1 max-w-md mx-auto">{t('profile.emptyText')}</p>
              <Link to="/" className={`${btn.primary} mt-4`}>{t('profile.pickSong')}</Link>
            </>
          ) : (
            <p className="text-sm text-white/55">{t('profile.emptyOther', { username: data.user.username })}</p>
          )}
        </div>
      )}

      {/* Someone else's: only once there is one; before, the catalogue would only say that nothing was earned (yours shows how close you are) */}
      {(isMe || data.achievements.some(a => a.unlockedAt)) && <AchievementsSection items={data.achievements} isMe={isMe} username={data.user.username} />}

      {hasScores && (
        <>
          {/* Best songs */}
          <Section title={t('profile.bestSongs')}>
            <div className={listBox}>{data.topSongs.map(r => <SongRow key={r.songId} row={r} />)}</div>
          </Section>

          {/* Recent */}
          {recentRows.length > 0 && (
            <Section title={t('profile.recent')}>
              <div className={listBox}>
                {recentRows.map(r => <SongRow key={r.id ?? `${r.songId}-${r.sungAt}`} row={r} date={fmt(r.sungAt)} />)}
              </div>
              {hasMore && <button type="button" onClick={loadMore} className={`${sm(btn.quiet)} mt-3`}>{t('profile.showMore')}</button>}
            </Section>
          )}
        </>
      )}

      {/* Played, nothing scored yet: the songs, and how scores come about */}
      {kind === 'played' && playedRows.length > 0 && (
        <Section title={t('profile.playedRecently')}>
          <p className="text-sm text-white/50 mb-3">
            {isMe ? t('profile.playedHint', { button: t('party.joinSinging') }) : t('profile.noScoresOther', { username: data.user.username })}
          </p>
          <div className={listBox}>
            {playedRows.map(r => <SongRow key={`${r.songId}-${r.playedAt}`} row={r} date={fmt(r.playedAt)} />)}
          </div>
        </Section>
      )}

      {isMe && <FriendsSection />}
      {isMe && user && <PrivacySection />}
      {isMe && user && <AccountSection editor={editor} avatarNote={avatarNote} />}
      {isMe && editor.ui}
    </WrapperPage>
  );
};

export default ProfilePage;
