import { useEffect, useState } from 'react';

/**
 * Adding SingSpree to the home screen (public/manifest.json). Chromium offers
 * it through beforeinstallprompt, which fires once early in the page's life,
 * so it is caught at startup (watchInstallPrompt in index.jsx) and kept for
 * the entry page's "Add to home screen" after a long party. iPhones and
 * iPads have no such event: they get the Share-menu hint instead. Elsewhere
 * (Firefox, an installed app) nothing is offered.
 */

let deferred = null;
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(); };

export function watchInstallPrompt() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // offered by our button, not the browser's own bar
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

const standalone = () => {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch { return false; }
};

const apple = () => {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

/** 'prompt' (the browser's dialog), 'ios' (the Share-menu hint) or null */
export function installMode() {
  if (typeof window === 'undefined' || standalone()) return null;
  if (deferred) return 'prompt';
  return apple() ? 'ios' : null;
}

/** The browser's install dialog; resolves to 'accepted' or 'dismissed' */
export async function promptInstall() {
  const e = deferred;
  if (!e) return 'dismissed';
  deferred = null;
  notify();
  e.prompt();
  try { return (await e.userChoice)?.outcome ?? 'dismissed'; } catch { return 'dismissed'; }
}

export function useInstallMode() {
  const [mode, setMode] = useState(installMode);
  useEffect(() => {
    const fn = () => setMode(installMode());
    listeners.add(fn);
    fn();
    return () => listeners.delete(fn);
  }, []);
  return mode;
}
