import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import { useAuth } from '../logic/AuthContext';
import {
  loginPasskey, registerPasskey, loginPassword, registerPassword,
  passkeysSupported, passkeyAutofillSupported, isCancelled,
} from '../logic/authApi';

/** Translated message for an ApiError (falls back to the server's English text). */
export const errorMessage = (t, e) => t(`auth.errors.${e?.code ?? 'network'}`, { defaultValue: e?.message || t('auth.errors.network') });

const PasskeyIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="10" cy="7" r="4" />
    <path d="M3 21v-2a5 5 0 0 1 5-5h3" />
    <circle cx="17.5" cy="15.5" r="2.5" />
    <path d="M19.5 17.5 22 20l-1.5 1.5L19 20" />
  </svg>
);

const inputClass = 'w-full px-4 py-3 rounded-lg bg-surface border border-surface-lighter text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan focus:shadow-[0_0_10px_rgba(0,229,255,0.2)] transition-all';

/**
 * Sign in (/login) and create account (/register). Passkeys are the primary
 * path; a password is the fallback. On the sign-in page the browser's passkey
 * autofill is armed as well, so a saved passkey shows up in the username
 * field's suggestions.
 */
const AuthPage = ({ mode }) => {
  const { t } = useTranslation();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isRegister = mode === 'register';
  const nextParam = params.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const nextQuery = nextParam ? `?next=${encodeURIComponent(nextParam)}` : '';

  const supported = passkeysSupported();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(!supported);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const doneRef = useRef(false);

  const done = (user) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setUser(user);
    navigate(next, { replace: true });
  };
  const fail = (e) => { if (!isCancelled(e)) setError(errorMessage(t, e)); };

  // Sign-in page: let the browser offer saved passkeys inside the username field
  useEffect(() => {
    if (isRegister || !supported) return;
    let active = true;
    passkeyAutofillSupported().then(ok => {
      if (!ok || !active) return;
      loginPasskey({ useBrowserAutofill: true }).then(user => { if (active) done(user); }).catch(() => { /* aborted by a manual attempt or navigation */ });
    });
    return () => { active = false; };
  }, [isRegister, supported]); // eslint-disable-line react-hooks/exhaustive-deps

  const withPasskey = async () => {
    setError(null);
    if (isRegister && !username.trim()) return;
    setBusy(true);
    try {
      const user = isRegister
        ? await registerPasskey({ username: username.trim() })
        : await loginPasskey({ username: username.trim() || undefined });
      done(user);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const withPassword = async (e) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      const user = isRegister
        ? await registerPassword(username.trim(), password)
        : await loginPassword(username.trim(), password);
      done(user);
    } catch (e2) { fail(e2); } finally { setBusy(false); }
  };

  return (
    <WrapperPage>
      <div className="max-w-md mx-auto py-8">
        <div className="gradient-border rounded-xl p-px">
          <div className="bg-surface-light rounded-xl p-8">
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan to-neon-purple text-center mb-2 leading-normal">
              {isRegister ? t('auth.createAccount') : t('auth.signIn')}
            </h1>

            {isRegister && (
              <ul className="text-sm text-gray-300 space-y-1.5 my-5">
                {['scores', 'friends', 'profile'].map(k => (
                  <li key={k} className="flex gap-2"><span className="text-yellow-400">★</span><span>{t(`auth.benefits.${k}`)}</span></li>
                ))}
              </ul>
            )}

            <form onSubmit={usePassword ? withPassword : (e) => { e.preventDefault(); withPasskey(); }} className="space-y-4 mt-4">
              <div>
                <label htmlFor="auth-username" className="block text-sm text-gray-400 mb-1">{t('auth.username')}</label>
                <input
                  id="auth-username"
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError(null); }}
                  autoComplete={isRegister ? 'username' : 'username webauthn'}
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={20}
                  autoFocus
                  className={inputClass}
                />
                {isRegister && <p className="text-xs text-gray-500 mt-1">{t('auth.usernameHint')}</p>}
              </div>

              {usePassword && (
                <div>
                  <label htmlFor="auth-password" className="block text-sm text-gray-400 mb-1">{t('auth.password')}</label>
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(null); }}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    minLength={isRegister ? 8 : undefined}
                    className={inputClass}
                  />
                  {isRegister && <p className="text-xs text-gray-500 mt-1">{t('auth.passwordHint')}</p>}
                </div>
              )}

              {error && <div className="text-red-400 text-sm text-center" role="alert">{error}</div>}

              {usePassword ? (
                <button
                  type="submit"
                  disabled={busy || !username.trim() || !password}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-purple text-white font-bold text-lg hover:shadow-[0_0_25px_rgba(0,229,255,0.4)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? t('auth.working') : (isRegister ? t('auth.createWithPassword') : t('auth.signInWithPassword'))}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={busy || (isRegister && !username.trim())}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-purple text-white font-bold text-lg hover:shadow-[0_0_25px_rgba(0,229,255,0.4)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <PasskeyIcon />
                  {busy ? t('auth.working') : (isRegister ? t('auth.createWithPasskey') : t('auth.signInWithPasskey'))}
                </button>
              )}

              {!usePassword && <p className="text-xs text-gray-500 text-center">{t('auth.passkeyHint')}</p>}

              {supported && (
                <button
                  type="button"
                  onClick={() => { setUsePassword(p => !p); setError(null); }}
                  className="w-full text-sm text-gray-400 hover:text-neon-cyan transition-colors cursor-pointer"
                >
                  {usePassword ? t('auth.usePasskeyInstead') : t('auth.usePasswordInstead')}
                </button>
              )}
            </form>

            <p className="text-sm text-gray-400 text-center mt-6">
              {isRegister ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
              <Link to={isRegister ? `/login${nextQuery}` : `/register${nextQuery}`} className="text-neon-cyan hover:text-neon-magenta font-semibold">
                {isRegister ? t('auth.signIn') : t('auth.createAccount')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </WrapperPage>
  );
};

export default AuthPage;
