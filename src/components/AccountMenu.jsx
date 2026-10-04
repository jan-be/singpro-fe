import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../logic/AuthContext';
import Avatar from './Avatar';
import NotificationBell from './NotificationBell';

/** The menu's way into the sections of your own profile (ProfilePage section ids). */
const SECTIONS = [
  { hash: '', label: 'profile.myProfile' },
  { hash: 'achievements', label: 'achievements.title' },
  { hash: 'friends', label: 'friends.title' },
  { hash: 'account', label: 'profile.account' },
];

/**
 * Top-right of the page header: "Sign in" when signed out; signed in, the
 * notification bell (NotificationBell) and the avatar with a small menu
 * (profile, achievements, friends, account, sign out). The cluster is the
 * bell panel's anchor.
 */
const AccountMenu = () => {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (loading) return <div className="w-7 h-7" aria-hidden="true" />;

  if (!user) {
    const next = location.pathname === '/' ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;
    return (
      <Link
        to={`/login${next}`}
        className="btn btn-sm btn-ghost no-underline"
      >
        {t('auth.signIn')}
      </Link>
    );
  }

  return (
    <div className="relative flex items-center gap-1">
      <NotificationBell />
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(p => !p)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full pl-0.5 pr-2 py-0.5 hover:bg-white/5 transition-colors cursor-pointer max-w-[12rem]"
        >
          <Avatar username={user.username} />
          <span className="text-sm text-gray-200 truncate hidden sm:inline">{user.username}</span>
        </button>
        {open && (
          <div className="pop absolute right-0 top-full mt-2 w-52 p-1.5 z-50">
            {SECTIONS.map(({ hash, label }) => (
              <Link
                key={label}
                to={`/u/${encodeURIComponent(user.username)}${hash ? `#${hash}` : ''}`}
                onClick={() => {
                  setOpen(false);
                  // Already on the profile: the page only scrolls when the hash changes
                  const target = hash ? document.getElementById(hash) : null;
                  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  else if (!hash) window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="menu-item no-underline"
              >
                {t(label)}
              </Link>
            ))}
            <button
              type="button"
              onClick={async () => { setOpen(false); await logout(); navigate('/'); }}
              className="menu-item mt-1 text-white/55 hover:text-red-300 hover:bg-red-500/10"
            >
              {t('auth.signOut')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountMenu;
