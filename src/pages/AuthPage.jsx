import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import { useAuth } from '../logic/AuthContext';
import {
  startEmailCode, verifyEmailCode, loginPassword, loginPasskey, registerPasskey,
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
const primaryClass = 'w-full py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-purple text-white font-bold text-lg hover:shadow-[0_0_25px_rgba(0,229,255,0.4)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2';
const linkClass = 'text-sm text-gray-400 hover:text-neon-cyan transition-colors cursor-pointer';
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/**
 * Sign in (/login) and create account (/register). The e-mail address is the
 * identity: a six-digit code sent to it signs you in and, the first time,
 * creates the account with a display name. Passkeys (also via the browser's
 * autofill on the sign-in page) and an optional password are the shortcuts.
 * Links in the code mail open /login?email=…&code=… and verify by themselves.
 */
const AuthPage = ({ mode }) => {
  const { t, i18n } = useTranslation();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isRegister = mode === 'register';
  const nextParam = params.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const nextQuery = nextParam ? `?next=${encodeURIComponent(nextParam)}` : '';

  const supported = passkeysSupported();
  const [step, setStep] = useState(params.get('code') ? 'code' : 'start'); // start | code | name | passkey
  const [method, setMethod] = useState('code'); // start step: code | password
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [devCode, setDevCode] = useState(null);
  const doneRef = useRef(false);

  const leave = () => { if (!doneRef.current) { doneRef.current = true; navigate(next, { replace: true }); } };
  const done = (user, created) => {
    setUser(user);
    if (created && supported) setStep('passkey'); // offer the shortcut for next time
    else leave();
  };
  const fail = (e) => { if (!isCancelled(e)) setError(errorMessage(t, e)); };

  // Sign-in page: let the browser offer saved passkeys inside the e-mail field
  useEffect(() => {
    if (isRegister || !supported || step !== 'start') return;
    let active = true;
    passkeyAutofillSupported().then(ok => {
      if (!ok || !active) return;
      loginPasskey({ useBrowserAutofill: true }).then(user => { if (active) done(user, false); }).catch(() => { /* aborted by a manual attempt or navigation */ });
    });
    return () => { active = false; };
  }, [isRegister, supported, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCode = async () => {
    setError(null);
    if (!looksLikeEmail(email) || (isRegister && !username.trim())) return;
    setBusy(true);
    try {
      const r = await startEmailCode(email.trim(), i18n.language);
      setDevCode(r.devCode ?? null);
      setCode('');
      setNotice(step === 'code' ? t('auth.codeResent') : null);
      setStep('code');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const verify = async (name) => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return;
    setBusy(true);
    try {
      const r = await verifyEmailCode(email.trim(), code.trim(), name ?? (isRegister ? username.trim() : undefined));
      if (r.needsUsername) { setStep('name'); return; }
      done(r.user, r.created);
    } catch (e) {
      if (e?.code === 'username_taken' || e?.code === 'username_invalid') { setStep('name'); setError(errorMessage(t, e)); return; }
      fail(e);
    } finally { setBusy(false); }
  };

  // Opened from the link in the mail: verify straight away
  const autoVerified = useRef(false);
  useEffect(() => {
    if (!autoVerified.current && params.get('email') && params.get('code')) { autoVerified.current = true; verify(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const withPassword = async (e) => {
    e.preventDefault();
    setError(null);
    if (!looksLikeEmail(email) || !password) return;
    setBusy(true);
    try { done(await loginPassword(email.trim(), password), false); } catch (e2) { fail(e2); } finally { setBusy(false); }
  };

  const withPasskey = async () => {
    setError(null);
    setBusy(true);
    try { done(await loginPasskey({ email: looksLikeEmail(email) ? email.trim() : undefined }), false); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const addPasskey = async () => {
    setError(null);
    setBusy(true);
    try { setUser(await registerPasskey()); leave(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const title = step === 'passkey' ? t('auth.passkeyOfferTitle') : (isRegister || step === 'name' ? t('auth.createAccount') : t('auth.signIn'));

  return (
    <WrapperPage>
      <div className="max-w-md mx-auto py-8">
        <div className="gradient-border rounded-xl p-px">
          <div className="bg-surface-light rounded-xl p-8">
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan to-neon-purple text-center mb-2 leading-normal">
              {title}
            </h1>

            {/* ── Start: address (+ display name when creating), code / password / passkey ── */}
            {step === 'start' && (
              <>
                {isRegister && (
                  <ul className="text-sm text-gray-300 space-y-1.5 my-5">
                    {['scores', 'friends', 'profile'].map(k => (
                      <li key={k} className="flex gap-2"><span className="text-yellow-400">★</span><span>{t(`auth.benefits.${k}`)}</span></li>
                    ))}
                  </ul>
                )}
                <form onSubmit={method === 'password' ? withPassword : (e) => { e.preventDefault(); sendCode(); }} className="space-y-4 mt-4">
                  {isRegister && (
                    <div>
                      <label htmlFor="auth-username" className="block text-sm text-gray-400 mb-1">{t('auth.displayName')}</label>
                      <input id="auth-username" type="text" value={username} onChange={e => { setUsername(e.target.value); setError(null); }}
                        autoComplete="nickname" autoCapitalize="none" spellCheck={false} maxLength={20} autoFocus className={inputClass} />
                      <p className="text-xs text-gray-500 mt-1">{t('auth.usernameHint')}</p>
                    </div>
                  )}
                  <div>
                    <label htmlFor="auth-email" className="block text-sm text-gray-400 mb-1">{t('auth.email')}</label>
                    <input id="auth-email" type="email" value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                      autoComplete={isRegister ? 'email' : 'email webauthn'} inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254}
                      autoFocus={!isRegister} className={inputClass} />
                    {isRegister && <p className="text-xs text-gray-500 mt-1">{t('auth.emailHint')}</p>}
                  </div>
                  {method === 'password' && (
                    <div>
                      <label htmlFor="auth-password" className="block text-sm text-gray-400 mb-1">{t('auth.password')}</label>
                      <input id="auth-password" type="password" value={password} onChange={e => { setPassword(e.target.value); setError(null); }}
                        autoComplete="current-password" className={inputClass} />
                    </div>
                  )}

                  {error && <div className="text-red-400 text-sm text-center" role="alert">{error}</div>}

                  {method === 'password' ? (
                    <button type="submit" disabled={busy || !looksLikeEmail(email) || !password} className={primaryClass}>
                      {busy ? t('auth.working') : t('auth.signIn')}
                    </button>
                  ) : (
                    <button type="submit" disabled={busy || !looksLikeEmail(email) || (isRegister && !username.trim())} className={primaryClass}>
                      {busy ? t('auth.working') : t('auth.sendCode')}
                    </button>
                  )}

                  {!isRegister && (
                    <div className="flex flex-col items-center gap-2 pt-1">
                      {supported && (
                        <button type="button" onClick={withPasskey} disabled={busy} className={`${linkClass} flex items-center gap-1.5`}>
                          <PasskeyIcon size={16} />{t('auth.signInWithPasskey')}
                        </button>
                      )}
                      <button type="button" onClick={() => { setMethod(m => (m === 'password' ? 'code' : 'password')); setError(null); }} className={linkClass}>
                        {method === 'password' ? t('auth.forgotPassword') : t('auth.usePassword')}
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}

            {/* ── Code: six digits from the mail ── */}
            {step === 'code' && (
              <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-4 mt-4">
                <p className="text-sm text-gray-300 text-center">{t('auth.codeSentTo', { email: email.trim() })}</p>
                {devCode && <p className="text-xs text-yellow-400/80 text-center">{t('auth.devCode', { code: devCode })}</p>}
                <div>
                  <label htmlFor="auth-code" className="block text-sm text-gray-400 mb-1">{t('auth.code')}</label>
                  <input id="auth-code" type="text" value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                    inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus
                    className={`${inputClass} text-center text-2xl font-mono tracking-[0.5em]`} />
                </div>
                {notice && <div className="text-neon-green text-sm text-center">{notice}</div>}
                {error && <div className="text-red-400 text-sm text-center" role="alert">{error}</div>}
                <button type="submit" disabled={busy || code.trim().length !== 6} className={primaryClass}>
                  {busy ? t('auth.working') : t('auth.continue')}
                </button>
                <div className="flex justify-center gap-6">
                  <button type="button" onClick={sendCode} disabled={busy} className={linkClass}>{t('auth.sendAgain')}</button>
                  <button type="button" onClick={() => { setStep('start'); setCode(''); setError(null); setNotice(null); }} className={linkClass}>{t('auth.changeEmail')}</button>
                </div>
              </form>
            )}

            {/* ── Name: a new address on the sign-in page (or a taken name) ── */}
            {step === 'name' && (
              <form onSubmit={(e) => { e.preventDefault(); verify(username.trim()); }} className="space-y-4 mt-4">
                <p className="text-sm text-gray-300 text-center">{t('auth.noAccountForEmail', { email: email.trim() })}</p>
                <div>
                  <label htmlFor="auth-username" className="block text-sm text-gray-400 mb-1">{t('auth.displayName')}</label>
                  <input id="auth-username" type="text" value={username} onChange={e => { setUsername(e.target.value); setError(null); }}
                    autoComplete="nickname" autoCapitalize="none" spellCheck={false} maxLength={20} autoFocus className={inputClass} />
                  <p className="text-xs text-gray-500 mt-1">{t('auth.usernameHint')}</p>
                </div>
                {error && <div className="text-red-400 text-sm text-center" role="alert">{error}</div>}
                <button type="submit" disabled={busy || !username.trim()} className={primaryClass}>
                  {busy ? t('auth.working') : t('auth.createAccount')}
                </button>
              </form>
            )}

            {/* ── Passkey offer after creating the account ── */}
            {step === 'passkey' && (
              <div className="space-y-4 mt-4 text-center">
                <p className="text-sm text-gray-300">{t('auth.passkeyOfferText')}</p>
                <p className="text-xs text-gray-500">{t('auth.passkeyHint')}</p>
                {error && <div className="text-red-400 text-sm" role="alert">{error}</div>}
                <button type="button" onClick={addPasskey} disabled={busy} className={primaryClass}>
                  <PasskeyIcon />{busy ? t('auth.working') : t('profile.addPasskey')}
                </button>
                <button type="button" onClick={leave} disabled={busy} className={linkClass}>{t('auth.notNow')}</button>
              </div>
            )}

            {(step === 'start') && (
              <p className="text-sm text-gray-400 text-center mt-6">
                {isRegister ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
                <Link to={isRegister ? `/login${nextQuery}` : `/register${nextQuery}`} className="text-neon-cyan hover:text-neon-magenta font-semibold">
                  {isRegister ? t('auth.signIn') : t('auth.createAccount')}
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>
    </WrapperPage>
  );
};

export default AuthPage;
