import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import { useAuth } from '../logic/AuthContext';
import {
  lookupEmail, startEmailCode, verifyEmailCode, loginPassword, loginPasskey, registerPasskey,
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
const secondaryClass = 'w-full py-2.5 rounded-lg border border-neon-cyan/40 text-neon-cyan font-semibold hover:bg-neon-cyan/10 hover:border-neon-cyan transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const linkClass = 'text-sm text-gray-400 hover:text-neon-cyan transition-colors cursor-pointer';
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/**
 * Sign in or sign up (/login and /register are the same page): the address
 * and one button. After the click the account decides what comes next: a
 * passkey prompt when it has one, the password field when it set one (with
 * "send me a code instead"), otherwise a mailed six-digit code, which signs
 * in or, for a new address, asks for a display name and creates the account.
 * Links from the mail (/login?email=…&code=…) verify by themselves; a new
 * account is offered a passkey before leaving.
 */
const AuthPage = () => {
  const { t, i18n } = useTranslation();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const nextParam = params.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  const supported = passkeysSupported();
  const [step, setStep] = useState(params.get('code') ? 'code' : 'start'); // start | password | code | name | passkey
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
  const run = async (fn) => {
    setError(null); setBusy(true);
    try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  // Let the browser offer saved passkeys inside the e-mail field
  useEffect(() => {
    if (!supported || step !== 'start') return;
    let active = true;
    passkeyAutofillSupported().then(ok => {
      if (!ok || !active) return;
      loginPasskey({ useBrowserAutofill: true }).then(user => { if (active) done(user, false); }).catch(() => { /* aborted by a manual attempt or navigation */ });
    });
    return () => { active = false; };
  }, [supported, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCode = async () => {
    const r = await startEmailCode(email.trim(), i18n.language);
    setDevCode(r.devCode ?? null);
    setCode('');
    setNotice(step === 'code' ? t('auth.codeResent') : null);
    setStep('code');
  };

  /** The one button: passkey → password → code, whichever the account has. */
  const proceed = (e) => {
    e.preventDefault();
    if (!looksLikeEmail(email)) return;
    run(async () => {
      const account = await lookupEmail(email.trim());
      if (account.hasPasskey && supported) {
        try { done(await loginPasskey({ email: email.trim() }), false); return; }
        catch (err) { if (!(isCancelled(err) || err?.code === 'no_passkeys')) throw err; } // dismissed: fall through
      }
      if (account.hasPassword) { setPassword(''); setStep('password'); return; }
      await sendCode();
    });
  };

  const verify = (name) => {
    if (!/^\d{6}$/.test(code.trim())) return;
    run(async () => {
      try {
        const r = await verifyEmailCode(email.trim(), code.trim(), name);
        if (r.needsUsername) { setStep('name'); return; }
        done(r.user, r.created);
      } catch (err) {
        if (err?.code === 'username_taken' || err?.code === 'username_invalid') { setStep('name'); setError(errorMessage(t, err)); return; }
        throw err;
      }
    });
  };

  // Opened from the link in the mail: verify straight away
  const autoVerified = useRef(false);
  useEffect(() => {
    if (!autoVerified.current && params.get('email') && params.get('code')) { autoVerified.current = true; verify(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const title = step === 'passkey' ? t('auth.passkeyOfferTitle') : (step === 'name' ? t('auth.createAccount') : t('auth.title'));
  const errorLine = error && <div className="text-red-400 text-sm text-center" role="alert">{error}</div>;
  const changeAddress = (
    <button type="button" onClick={() => { setStep('start'); setCode(''); setPassword(''); setError(null); setNotice(null); }} className={linkClass}>
      {t('auth.changeEmail')}
    </button>
  );

  return (
    <WrapperPage>
      <div className="max-w-md mx-auto py-8">
        <div className="gradient-border rounded-xl p-px">
          <div className="bg-surface-light rounded-xl p-8">
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan to-neon-purple text-center mb-2 leading-normal">
              {title}
            </h1>

            {/* ── Start: the address and one button ── */}
            {step === 'start' && (
              <form onSubmit={proceed} className="space-y-4 mt-4">
                <div>
                  <label htmlFor="auth-email" className="block text-sm text-gray-400 mb-1">{t('auth.email')}</label>
                  <input id="auth-email" type="email" value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                    autoComplete="email webauthn" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} autoFocus className={inputClass} />
                  <p className="text-xs text-gray-500 mt-1">{t('auth.oneButtonHint')}</p>
                </div>
                {errorLine}
                <button type="submit" disabled={busy || !looksLikeEmail(email)} className={primaryClass}>
                  {busy ? t('auth.working') : t('auth.continue')}
                </button>
              </form>
            )}

            {/* ── Password: the account set one; a code is one click away ── */}
            {step === 'password' && (
              <form onSubmit={(e) => { e.preventDefault(); if (password) run(async () => done(await loginPassword(email.trim(), password), false)); }} className="space-y-4 mt-4">
                <p className="text-sm text-gray-300 text-center truncate">{email.trim()}</p>
                <div>
                  <label htmlFor="auth-password" className="block text-sm text-gray-400 mb-1">{t('auth.password')}</label>
                  <input id="auth-password" type="password" value={password} onChange={e => { setPassword(e.target.value); setError(null); }}
                    autoComplete="current-password" autoFocus className={inputClass} />
                </div>
                {errorLine}
                <button type="submit" disabled={busy || !password} className={primaryClass}>
                  {busy ? t('auth.working') : t('auth.signIn')}
                </button>
                <button type="button" onClick={() => run(sendCode)} disabled={busy} className={secondaryClass}>
                  {t('auth.sendCodeInstead')}
                </button>
                <div className="flex justify-center">{changeAddress}</div>
              </form>
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
                {errorLine}
                <button type="submit" disabled={busy || code.trim().length !== 6} className={primaryClass}>
                  {busy ? t('auth.working') : t('auth.continue')}
                </button>
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
                  <button type="button" onClick={() => run(sendCode)} disabled={busy} className={linkClass}>{t('auth.sendAgain')}</button>
                  {changeAddress}
                </div>
              </form>
            )}

            {/* ── Name: a new address (or a taken name) ── */}
            {step === 'name' && (
              <form onSubmit={(e) => { e.preventDefault(); if (username.trim()) verify(username.trim()); }} className="space-y-4 mt-4">
                <p className="text-sm text-gray-300 text-center">{t('auth.noAccountForEmail', { email: email.trim() })}</p>
                <div>
                  <label htmlFor="auth-username" className="block text-sm text-gray-400 mb-1">{t('auth.displayName')}</label>
                  <input id="auth-username" type="text" value={username} onChange={e => { setUsername(e.target.value); setError(null); }}
                    autoComplete="nickname" autoCapitalize="none" spellCheck={false} maxLength={20} autoFocus className={inputClass} />
                  <p className="text-xs text-gray-500 mt-1">{t('auth.usernameHint')}</p>
                </div>
                {errorLine}
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
                {errorLine}
                <button type="button" onClick={() => run(async () => { setUser(await registerPasskey()); leave(); })} disabled={busy} className={primaryClass}>
                  <PasskeyIcon />{busy ? t('auth.working') : t('profile.addPasskey')}
                </button>
                <button type="button" onClick={leave} disabled={busy} className={linkClass}>{t('auth.notNow')}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </WrapperPage>
  );
};

export default AuthPage;
