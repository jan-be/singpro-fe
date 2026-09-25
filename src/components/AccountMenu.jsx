import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../logic/AuthContext';
import Avatar from './Avatar';
import NotificationBell from './NotificationBell';

/**
 * Top-right of the page header: "Sign in" when signed out; signed in, the
 * notification bell (NotificationBell) and the avatar with a small menu
 * (profile, friends, sign out). The cluster is the bell panel's anchor.
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
        className="px-3 py-1.5 rounded-lg border border-neon-cyan/40 text-neon-cyan text-sm font-semibold hover:bg-neon-cyan/10 hover:border-neon-cyan transition-all"
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
          <div className="absolute right-0 top-full mt-2 w-48 bg-surface-light border border-surface-lighter rounded-lg shadow-xl py-1 z-50">
            <Link to={`/u/${encodeURIComponent(user.username)}`} onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-gray-200 hover:bg-surface-lighter hover:text-white">
              {t('profile.myProfile')}
            </Link>
            <Link to={`/u/${encodeURIComponent(user.username)}#friends`} onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-gray-200 hover:bg-surface-lighter hover:text-white">
              {t('friends.title')}
            </Link>
            <button
              type="button"
              onClick={async () => { setOpen(false); await logout(); navigate('/'); }}
              className="w-full text-left px-4 py-2 text-sm text-gray-400 hover:bg-surface-lighter hover:text-red-400 cursor-pointer border-t border-surface-lighter"
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
