import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../logic/AuthContext';

const ShieldIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

/** Next to the account menu in the page header, for admins only: the way to /admin. */
const AdminLink = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user?.isAdmin) return null;
  const active = pathname === '/admin';
  return (
    <Link
      to="/admin"
      aria-label={t('admin.title')}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm font-semibold transition-all ${
        active ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10' : 'border-neon-magenta/40 text-neon-magenta hover:bg-neon-magenta/10 hover:border-neon-magenta'}`}
    >
      <ShieldIcon />
      <span className="hidden sm:inline">{t('admin.title')}</span>
    </Link>
  );
};

export default AdminLink;
