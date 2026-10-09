import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import Avatar from '../components/Avatar';
import { useAvatarEditor } from '../components/AvatarEditor';
import { useAuth } from '../logic/AuthContext';
import {
  lookupEmail, startEmailCode, verifyEmailCode, loginPassword, loginPasskey, registerPasskey, uploadAvatar,
  passkeysSupported, passkeyAutofillSupported, isCancelled,
} from '../logic/authApi';
import { staysAfterSignIn, uploadSignupPicture } from '../logic/signupPicture';

/** Translated message for an ApiError (falls back to the server's English text). */
export const errorMessage = (t, e) => t(`auth.errors.${e?.code ?? 'network'}`, { defaultValue: e?.message || t('auth.errors.network') });

const CameraIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
  </svg>
);

const PasskeyIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="10" cy="7" r="4" />
    <path d="M3 21v-2a5 5 0 0 1 5-5h3" />
    <circle cx="17.5" cy="15.5" r="2.5" />
    <path d="M19.5 17.5 22 20l-1.5 1.5L19 20" />
  </svg>
);

const inputClass = 'field h-12 px-4';
// The six digits: big and spaced; the extra left padding makes up for the spacing after the last digit
const codeInputClass = 'field h-14 pl-[calc(1rem+0.4em)] pr-4 text-center font-mono text-2xl font-semibold tracking-[0.4em]';
const labelClass = 'block text-xs font-medium text-white/55 mb-1.5';
const hintClass = 'text-xs text-white/45 mt-1.5';
const primaryClass = 'btn btn-primary btn-lg w-full';
const secondaryClass = 'btn btn-ghost w-full';
const linkClass = 'text-sm text-white/55 hover:text-white underline decoration-white/20 underline-offset-4 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const smallLinkClass = linkClass.replace('text-sm', 'text-xs');
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/**
 * Sign in or sign up (/login and /register are the same page): the address
 * and one button. After the click the account decides what comes next: a
 * passkey prompt when it has one, the password field when it set one (with
 * "send me a code instead"), otherwise a mailed six-digit code, which signs
 * in or, for a new address, asks for a display name and creates the account.
 * A profile picture can be picked next to the name: held here until the
 * account exists, then uploaded (logic/signupPicture.js). Links from the mail
 * (/login?email=…&code=…) verify by themselves; a new account is offered a
 * passkey before leaving.
 */
const AuthPage = () => {
  const { t, i18n } = useTranslation();
  const { user: me, setUser } = useAuth();
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
  // The new account's picture, picked next to the name: { blob, url } until the account exists
  const [picture, setPicture] = useState(null);
  const [pictureFailed, setPictureFailed] = useState(false);
  const doneRef = useRef(false);

  // The preview's object URL of a picture replaced, removed or left behind is let go
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url); }, [picture]);
  const editor = useAvatarEditor({
    onPicked: (blob) => setPicture({ blob, url: URL.createObjectURL(blob) }),
    onError: (text) => setError(text),
  });

  const leave = () => { if (!doneRef.current) { doneRef.current = true; navigate(next, { replace: true }); } };
  const done = (user, created, pictureLost = false) => {
    setUser(user);
    setPictureFailed(pictureLost);
    // A new account: offer the shortcut for next time, and say so if its picture did not save
    if (staysAfterSignIn({ created, passkeys: supported, pictureFailed: pictureLost })) setStep('passkey');
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
        // Signed in from here on, whatever the picture does
        const { user, failed } = r.created ? await uploadSignupPicture(r.user, picture?.blob, uploadAvatar) : { user: r.user, failed: null };
        done(user, r.created, Boolean(failed));
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

  const title = step === 'passkey' ? (supported ? t('auth.passkeyOfferTitle') : t('auth.welcome', { name: me?.username ?? username.trim() })) : (step === 'name' ? t('auth.createAccount') : t('auth.title'));
  const errorLine = error && <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 text-red-300 text-sm text-center" role="alert">{error}</div>;
  const changeAddress = (
    <button type="button" onClick={() => { setStep('start'); setCode(''); setPassword(''); setError(null); setNotice(null); }} className={linkClass}>
      {t('auth.changeEmail')}
    </button>
  );

  return (
    <WrapperPage>
      <div className="max-w-md mx-auto sm:py-6">
        <div className="relative overflow-hidden rounded-3xl bg-panel border border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]">
          {/* stage light from above */}
          <div className="absolute inset-x-0 top-0 h-48 pointer-events-none bg-[radial-gradient(360px_180px_at_50%_0%,rgba(255,79,216,0.16),transparent_70%)]" aria-hidden="true" />
          <div className="relative p-6 sm:p-8">
            <h1 className="text-[1.75rem] sm:text-3xl font-bold tracking-[-0.02em] text-white text-center mb-2 leading-tight text-balance">
              {title}
            </h1>

            {/* ── Start: the address and one button ── */}
            {step === 'start' && (
              <form onSubmit={proceed} className="space-y-5 mt-6">
                <div>
                  <label htmlFor="auth-email" className={labelClass}>{t('auth.email')}</label>
                  <input id="auth-email" type="email" value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                    autoComplete="email webauthn" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} autoFocus className={inputClass} />
                  <p className={hintClass}>{t('auth.oneButtonHint')}</p>
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
                <p className="text-sm text-white/65 text-center truncate">{email.trim()}</p>
                <div>
                  <label htmlFor="auth-password" className={labelClass}>{t('auth.password')}</label>
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
                <div className="flex justify-center pt-1">{changeAddress}</div>
              </form>
            )}

            {/* ── Code: six digits from the mail ── */}
            {step === 'code' && (
              <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-4 mt-4">
                <p className="text-sm text-white/65 text-center break-words">{t('auth.codeSentTo', { email: email.trim() })}</p>
                {devCode && <p className="text-xs text-amber-300/80 text-center">{t('auth.devCode', { code: devCode })}</p>}
                <div>
                  <label htmlFor="auth-code" className={labelClass}>{t('auth.code')}</label>
                  <input id="auth-code" type="text" value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                    inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus
                    className={codeInputClass} />
                </div>
                {notice && <div className="rounded-xl bg-emerald-400/10 border border-emerald-400/20 px-3.5 py-2.5 text-emerald-200 text-sm text-center">{notice}</div>}
                {errorLine}
                <button type="submit" disabled={busy || code.trim().length !== 6} className={primaryClass}>
                  {busy ? t('auth.working') : t('auth.continue')}
                </button>
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 pt-1">
                  <button type="button" onClick={() => run(sendCode)} disabled={busy} className={linkClass}>{t('auth.sendAgain')}</button>
                  {changeAddress}
                </div>
              </form>
            )}

            {/* ── Name: a new address (or a taken name) ── */}
            {step === 'name' && (
              <form onSubmit={(e) => { e.preventDefault(); if (username.trim()) verify(username.trim()); }} className="space-y-4 mt-4">
                <p className="text-sm text-white/65 text-center break-words">{t('auth.noAccountForEmail', { email: email.trim() })}</p>
                <div>
                  <label htmlFor="auth-username" className={labelClass}>{t('auth.displayName')}</label>
                  <div className="flex items-center gap-3">
                    {/* The picture, optional: the initial (in the name's colour) until one is picked */}
                    <button type="button" onClick={editor.choose} disabled={busy || editor.busy} className="relative flex rounded-full flex-shrink-0 group"
                      aria-label={picture ? t('avatar.change') : t('avatar.add')} title={picture ? t('avatar.change') : t('avatar.add')}>
                      <Avatar username={username.trim()} preview={picture?.url} size={48} className="text-xl transition-opacity group-hover:opacity-85" />
                      <span aria-hidden="true" className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full fill-hot grid place-items-center ring-2 ring-panel">
                        <CameraIcon />
                      </span>
                    </button>
                    <input id="auth-username" type="text" value={username} onChange={e => { setUsername(e.target.value); setError(null); }}
                      autoComplete="nickname" autoCapitalize="none" spellCheck={false} maxLength={20} autoFocus className={`${inputClass} min-w-0 flex-1`} />
                  </div>
                  <p className={hintClass}>{t('auth.usernameHint')}</p>
                  <button type="button" onClick={picture ? () => setPicture(null) : editor.choose} disabled={busy || editor.busy}
                    className={`${smallLinkClass} mt-1.5`} data-testid="signup-picture">
                    {picture ? t('auth.removePicture') : t('auth.addPicture')}
                  </button>
                </div>
                {errorLine}
                <button type="submit" disabled={busy || !username.trim()} className={primaryClass}>
                  {busy ? t('auth.working') : t('auth.createAccount')}
                </button>
              </form>
            )}

            {/* ── After creating the account: the passkey offer, and word of a picture that did not save ── */}
            {step === 'passkey' && (
              <div className="space-y-4 mt-4 text-center">
                {pictureFailed && (
                  <div className="rounded-xl bg-amber-400/10 border border-amber-400/25 px-3.5 py-2.5 text-amber-100 text-sm" role="status" data-testid="picture-not-saved">
                    {t('auth.pictureNotSaved')}
                  </div>
                )}
                {supported ? (
                  <>
                    <p className="text-sm text-white/70">{t('auth.passkeyOfferText')}</p>
                    <p className="text-xs text-white/45">{t('auth.passkeyHint')}</p>
                    {errorLine}
                    <button type="button" onClick={() => run(async () => { setUser(await registerPasskey()); leave(); })} disabled={busy} className={primaryClass}>
                      <PasskeyIcon />{busy ? t('auth.working') : t('profile.addPasskey')}
                    </button>
                    <button type="button" onClick={leave} disabled={busy} className={linkClass}>{t('auth.notNow')}</button>
                  </>
                ) : (
                  <button type="button" onClick={leave} className={primaryClass}>{t('auth.continue')}</button>
                )}
              </div>
            )}
          </div>
        </div>
        {step === 'name' && editor.ui}
      </div>
    </WrapperPage>
  );
};

export default AuthPage;
