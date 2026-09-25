import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '../logic/AuthContext';
import { useNotifications } from '../logic/NotificationsContext';
import { acceptFriend, removeFriend } from '../logic/authApi';
import { timeAgo } from '../logic/timeAgo';
import Avatar from './Avatar';

const POLL_MS = 60_000;
const BADGE_MAX = 9;

const btn = {
  primary: 'px-2.5 py-1 rounded-md bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/40 hover:bg-neon-cyan/20 hover:border-neon-cyan text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  quiet: 'px-2.5 py-1 rounded-md bg-surface-lighter/60 text-gray-300 border border-surface-lighter hover:text-white hover:border-gray-500 text-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
};

const BellIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/**
 * The bell next to the avatar in the page header (signed in only). Its badge
 * counts the friend requests that arrived since the panel was last opened;
 * the panel lists every pending one with accept and decline. Opening it marks
 * what it shows as seen, so a request left pending stops lighting the badge
 * but stays in the list until it is answered.
 *
 * The panel is positioned against the nearest positioned ancestor, the
 * header's account cluster, so on a phone it lines up with the page edge.
 */
const NotificationBell = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { friendRequests, unseen, refresh, markSeen } = useNotifications();
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

  const newNames = (requests) => new Set(requests.filter(r => r.isNew).map(r => r.username));

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setFresh(newNames(friendRequests));
    setOpen(true);
    // What is marked seen is what the panel shows: the latest, not the last poll
    const data = await refresh();
    if (data) {
      setFresh(newNames(data.friendRequests));
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

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unseen > 0 ? t('notifications.labelNew', { count: unseen }) : t('notifications.title')}
        title={t('notifications.title')}
        className={`relative flex items-center justify-center w-9 h-9 rounded-full transition-colors cursor-pointer hover:bg-white/5 ${open || unseen > 0 ? 'text-white' : 'text-gray-400 hover:text-white'}`}
      >
        <BellIcon className="w-5 h-5" />
        {unseen > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-neon-magenta text-white text-[11px] font-bold leading-[18px] text-center shadow-[0_0_8px_rgba(255,0,170,0.6)]"
          >
            {unseen > BADGE_MAX ? `${BADGE_MAX}+` : unseen}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-surface-light border border-surface-lighter rounded-lg shadow-xl z-50 overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-surface-lighter text-sm font-semibold text-white">{t('notifications.title')}</div>
          {friendRequests.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">{t('notifications.none')}</p>
          ) : (
            <ul className="max-h-[min(20rem,60vh)] overflow-y-auto divide-y divide-surface-lighter">
              {friendRequests.map(r => (
                <li key={r.username} className={`flex gap-3 px-4 py-3 ${fresh.has(r.username) ? 'bg-neon-magenta/5' : ''}`}>
                  <Link to={profile(r.username)} onClick={close} className="flex-shrink-0" tabIndex={-1}>
                    <Avatar username={r.username} size={32} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200 break-words">
                      <Trans
                        i18nKey="notifications.friendRequest"
                        values={{ username: r.username }}
                        components={{ name: <Link to={profile(r.username)} onClick={close} className="font-semibold text-white hover:text-neon-cyan" /> }}
                      />
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                      {fresh.has(r.username) && <span className="w-1.5 h-1.5 rounded-full bg-neon-magenta" aria-hidden="true" />}
                      {timeAgo(r.createdAt, { lang: i18n.language })}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button type="button" disabled={busy === r.username} onClick={answer(acceptFriend, r.username)} className={btn.primary}>{t('friends.accept')}</button>
                      <button type="button" disabled={busy === r.username} onClick={answer(removeFriend, r.username)} className={btn.quiet}>{t('friends.decline')}</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link
            to={`${profile(user.username)}#friends`}
            onClick={close}
            className="block px-4 py-2.5 text-sm text-center text-neon-cyan hover:bg-surface-lighter border-t border-surface-lighter"
          >
            {t('notifications.allFriends')}
          </Link>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
