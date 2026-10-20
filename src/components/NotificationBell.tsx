import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '../logic/AuthContext';
import { useNotifications } from '../logic/NotificationsContext';
import { acceptFriend, removeFriend } from '../logic/authApi';
import { achievementInfo, creditLine } from '../logic/achievements';
import { timeAgo } from '../logic/timeAgo';
import Avatar from './Avatar';

const POLL_MS = 60_000;
const BADGE_MAX = 9;

const btn = {
  primary: 'btn btn-sm btn-primary',
  quiet: 'btn btn-sm btn-ghost',
};
// The footer's two ways onwards
const footLink = 'flex-1 px-3 py-3 text-sm font-medium text-center text-white/70 no-underline hover:text-white hover:bg-white/[0.06] transition-colors';

const BellIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/** One list, newest first: friend requests and achievements, each with an id for the "new" marks. */
const feed = (friendRequests, achievements) => [
  ...friendRequests.map(r => ({ id: `r:${r.username}`, at: r.createdAt, isNew: r.isNew, request: r })),
  ...achievements.filter(a => achievementInfo(a.key)).map(a => ({ id: `a:${a.key}`, at: a.unlockedAt, isNew: a.isNew, achievement: a })),
].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

/**
 * The bell next to the avatar in the page header (signed in only). Its badge
 * counts the friend requests and achievements that arrived since the panel
 * was last opened; the panel lists every pending request with accept and
 * decline, and the achievements earned lately. Opening it marks what it
 * shows as seen, so a request left pending stops lighting the badge but
 * stays in the list until it is answered.
 *
 * The panel is positioned against the nearest positioned ancestor, the
 * header's account cluster, so on a phone it lines up with the page edge.
 */
const NotificationBell = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { friendRequests, achievements = [], unseen, refresh, markSeen } = useNotifications();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null); // username being answered
  const [fresh, setFresh] = useState(() => new Set()); // new when the panel opened: stays marked while it is open
  const ref = useRef(null);

  // Fresh while on screen: on mount, every minute, and when the tab comes back
  useEffect(() => {
    refresh();
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const newIds = (data) => new Set(feed(data.friendRequests ?? [], data.achievements ?? []).filter(item => item.isNew).map(item => item.id));

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setFresh(newIds({ friendRequests, achievements }));
    setOpen(true);
    // What is marked seen is what the panel shows: the latest, not the last poll
    const data = await refresh();
    if (data) {
      setFresh(newIds(data));
      markSeen(data);
    }
  };

  const answer = (fn, username) => async () => {
    setBusy(username);
    try { await fn(username); } catch { /* transient; the list below says what is still pending */ }
    finally { setBusy(null); refresh(); }
  };

  const close = () => setOpen(false);
  const profile = (username) => `/u/${encodeURIComponent(username)}`;
  const items = feed(friendRequests, achievements);

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unseen > 0 ? t('notifications.labelNew', { count: unseen }) : t('notifications.title')}
        title={t('notifications.title')}
        className={`btn-icon ${unseen > 0 ? 'text-white' : ''}`}
      >
        <BellIcon className="w-5 h-5" />
        {unseen > 0 && (
          <span
            aria-hidden="true"
            className="fill-hot absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-[18px] text-center tabular-nums ring-2 ring-[#1c1640]"
          >
            {unseen > BADGE_MAX ? `${BADGE_MAX}+` : unseen}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="pop absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] z-50 overflow-hidden"
        >
          <div className="px-4 pt-3.5 pb-3 border-b border-white/[0.07] text-sm font-semibold tracking-[-0.01em] text-white">{t('notifications.title')}</div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-sm text-white/45 text-center">{t('notifications.none')}</p>
          ) : (
            <ul className="max-h-[min(20rem,60vh)] overflow-y-auto divide-y divide-white/[0.07]">
              {items.map(({ id, at, request: r, achievement: a }) => {
                const isFresh = fresh.has(id);
                const when = (
                  <p className="text-xs text-white/40 mt-0.5 flex items-center gap-1.5">
                    {isFresh && <span className="w-1.5 h-1.5 rounded-full bg-hot" aria-hidden="true" />}
                    {timeAgo(at, { lang: i18n.language })}
                  </p>
                );
                if (a) {
                  const info = achievementInfo(a.key);
                  return (
                    <li key={id} className={isFresh ? 'bg-hot/[0.06]' : ''}>
                      <Link to={`${profile(user.username)}#achievements`} onClick={close} className="flex gap-3 px-4 py-3 no-underline hover:bg-white/[0.04] transition-colors">
                        <span aria-hidden="true" className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-hot/30 to-neon-purple/25 ring-1 ring-inset ring-white/15 flex items-center justify-center text-base">{info.icon}</span>
                        <span className="min-w-0 flex-1 block">
                          <span className="block text-sm text-white/75 break-words">
                            <Trans i18nKey="notifications.achievement" values={{ name: info.name }} components={{ name: <span className="font-semibold text-white" /> }} />
                          </span>
                          <span className="block text-[11px] text-hot/80 truncate">♪ {creditLine(info)}</span>
                          {when}
                        </span>
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={id} className={`flex gap-3 px-4 py-3 ${isFresh ? 'bg-hot/[0.06]' : ''}`}>
                    <Link to={profile(r.username)} onClick={close} className="flex-shrink-0" tabIndex={-1}>
                      <Avatar username={r.username} src={r.avatar} size={32} />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/75 break-words">
                        <Trans
                          i18nKey="notifications.friendRequest"
                          values={{ username: r.username }}
                          components={{ name: <Link to={profile(r.username)} onClick={close} className="font-semibold text-white no-underline hover:text-white hover:underline underline-offset-2" /> }}
                        />
                      </p>
                      {when}
                      <div className="flex gap-2 mt-2.5">
                        <button type="button" disabled={busy === r.username} onClick={answer(acceptFriend, r.username)} className={btn.primary}>{t('friends.accept')}</button>
                        <button type="button" disabled={busy === r.username} onClick={answer(removeFriend, r.username)} className={btn.quiet}>{t('friends.decline')}</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex border-t border-white/[0.07] divide-x divide-white/[0.07]">
            <Link
              to={`${profile(user.username)}#friends`}
              onClick={close}
              className={footLink}
            >
              {t('notifications.allFriends')}
            </Link>
            <Link
              to={`${profile(user.username)}#achievements`}
              onClick={close}
              className={footLink}
            >
              {t('notifications.allAchievements')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
