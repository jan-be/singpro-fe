import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * A second browser window whose content this page renders, the way Google
 * Slides opens its presenter view: the party page stays fullscreen on the TV
 * and the queue lives in a window on the laptop screen.
 *
 * The window is opened blank (same origin) and the party page renders into it
 * through a React portal. So there is one React tree, one party state, one
 * WebSocket: the window is not a second player in the party, needs no sync
 * protocol, and every queue action runs the same handler as in the page.
 *
 * This file keeps the window's life: open (or bring an open one to the front),
 * rebuild its document after a reload, notice when it is closed, and close it
 * when the page itself goes away.
 */

/**
 * Whether this device can put a second window next to the page. Phones,
 * tablets and TV browsers open a "window" as another tab, or not at all, so
 * the button would only take people away from the party there.
 */
export function canPopOut(env = typeof window !== 'undefined' ? window : undefined) {
  if (!env || typeof env.open !== 'function') return false;
  const nav = env.navigator ?? {};
  const ua = nav.userAgent ?? '';
  if (/Android|iPhone|iPad|iPod|Mobi|Silk|CrKey|SMART-TV|SmartTV|Tizen|Web0S|webOS|HbbTV|BRAVIA|AFT[A-Z]|PlayStation|Xbox/i.test(ua)) return false;
  // iPadOS asks for desktop pages as a Mac; its touch screen gives it away
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return false;
  // A mouse or a trackpad: a desktop, where windows can go to another screen
  try {
    const mq = env.matchMedia?.('(any-pointer: fine)');
    if (mq && !mq.matches) return false;
  } catch { /* no media queries: judge by the user agent alone */ }
  return true;
}

// Window size: the last one the user left it at, within the screen
const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;

export function popoutFeatures(saved, screen, fallback = { width: 480, height: 760 }) {
  const maxW = screen?.availWidth || Infinity;
  const maxH = screen?.availHeight || Infinity;
  const clamp = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, v)));
  const w = Number.isFinite(saved?.width) ? saved.width : fallback.width;
  const h = Number.isFinite(saved?.height) ? saved.height : fallback.height;
  return `popup,width=${clamp(w, MIN_WIDTH, maxW)},height=${clamp(h, MIN_HEIGHT, maxH)}`;
}

function readSize(storage, key) {
  try {
    const v = JSON.parse(storage?.getItem(key) ?? 'null');
    return v && Number.isFinite(v.width) && Number.isFinite(v.height) ? v : null;
  } catch { return null; }
}

function writeSize(storage, key, size) {
  try { storage?.setItem(key, JSON.stringify(size)); } catch { /* private mode: forget it */ }
}

/** The window's document, or null once it went somewhere we may not read. */
const docOf = (win) => { try { return win.document ?? null; } catch { return null; } };

/**
 * Stylesheets of `fromDoc` copied into `toDoc` and kept in step: Tailwind is
 * one sheet in production, but the dev server swaps style text on every edit
 * and a lazily loaded chunk can add a sheet. Returns a function that stops it.
 */
export function mirrorStyles(fromDoc, toDoc) {
  const clones = new Map();
  const sync = () => {
    for (const [orig, clone] of clones) {
      if (!orig.isConnected) { clone.remove(); clones.delete(orig); }
    }
    for (const orig of fromDoc.head.querySelectorAll('style, link[rel~="stylesheet"]')) {
      const clone = clones.get(orig);
      if (!clone) {
        const copy = toDoc.importNode(orig, true);
        if (orig.nodeName === 'LINK') copy.href = orig.href; // absolute: nothing to resolve against in about:blank
        toDoc.head.appendChild(copy);
        clones.set(orig, copy);
      } else if (orig.nodeName === 'STYLE' && clone.textContent !== orig.textContent) {
        clone.textContent = orig.textContent;
      }
    }
  };
  sync();
  const Observer = fromDoc.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const observer = new Observer(sync);
  observer.observe(fromDoc.head, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}

/**
 * Turn the popup's blank document into a page of this site: its language,
 * viewport, icon and styles, and an empty element for the portal.
 * Returns { container, dispose }.
 */
export function preparePopoutDocument(win, { title = '', sourceDoc = document, rootId = 'popout-root' } = {}) {
  const doc = win.document;
  // A window of that name still open from an earlier page holds its leftovers
  doc.head.textContent = '';
  doc.body.textContent = '';
  doc.documentElement.lang = sourceDoc.documentElement.lang || 'en';
  const viewport = doc.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  doc.head.appendChild(viewport);
  const icon = sourceDoc.querySelector('link[rel~="icon"]');
  if (icon) {
    const copy = doc.importNode(icon, true);
    copy.href = icon.href;
    doc.head.appendChild(copy);
  }
  doc.title = title;
  const stopMirror = mirrorStyles(sourceDoc, doc);
  const container = doc.createElement('div');
  container.id = rootId;
  doc.body.appendChild(container);
  return { container, dispose: stopMirror };
}

/**
 * The popup's lifecycle, framework-free (usePopout wraps it for React).
 *
 * State: { open, container, blocked }. `open` is true from a successful
 * window.open until the window is gone; `container` is the element to portal
 * into, null while the window's document is being replaced (a reload);
 * `blocked` says the browser refused the last attempt.
 *
 * Options:
 *   name      window name (a second open() finds the window by it)
 *   prepare   (win) => { container, dispose }: builds the popup's document
 *   host      the opener window (tests pass a fake)
 *   sizeKey   localStorage key remembering the window's size, optional
 */
export function createPopout({ name, prepare, host = window, sizeKey = null, pollMs = 250 }) {
  let win = null;
  let container = null;
  let dispose = null;
  let pollId = null;
  let size = null; // last seen inner size of the open window
  let state = { open: false, container: null, blocked: false };
  const listeners = new Set();
  const storage = (() => { try { return host.localStorage ?? null; } catch { return null; } })();

  const set = (patch) => {
    if (Object.keys(patch).every(k => state[k] === patch[k])) return;
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  const detach = () => {
    try { dispose?.(); } catch { /* the document is already gone */ }
    dispose = null;
    container = null;
  };

  const attach = () => {
    const doc = docOf(win);
    if (!doc?.body || doc.readyState === 'loading') return false; // not there yet: the next check tries again
    const built = prepare(win);
    container = built.container;
    dispose = built.dispose ?? null;
    // Closing and reloading both start with pagehide: drop the portal at once
    win.addEventListener('pagehide', onPopupHide);
    set({ container });
    return true;
  };

  const finish = ({ closeWindow = false } = {}) => {
    clearInterval(pollId);
    pollId = null;
    detach();
    const w = win;
    win = null;
    if (sizeKey && size) writeSize(storage, sizeKey, size);
    if (closeWindow) { try { w?.close(); } catch { /* already closed */ } }
    set({ open: false, container: null });
  };

  // Runs on a timer while the window is open: closed windows are noticed,
  // reloaded ones rebuilt, and the size kept for next time.
  const check = () => {
    if (!win) return;
    if (win.closed) { finish(); return; }
    const doc = docOf(win);
    if (!doc) { finish({ closeWindow: true }); return; } // navigated away from us
    if (win.innerWidth > 0 && win.innerHeight > 0) size = { width: win.innerWidth, height: win.innerHeight };
    if (container && container.ownerDocument === doc && container.isConnected) return;
    // A reload replaced the document (the container went with it): build it again
    if (container || dispose) { detach(); set({ container: null }); }
    attach();
  };

  function onPopupHide() {
    detach();
    set({ container: null });
    // `closed` turns true only after pagehide
    setTimeout(check, 50);
  }

  const popout = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Open the window, or bring the open one to the front. Call it straight
     * from a click handler: browsers only allow pop-ups on a user gesture.
     * Returns 'opened', 'focused' or 'blocked'.
     */
    open() {
      if (win && !win.closed) {
        try { win.focus(); } catch { /* */ }
        return 'focused';
      }
      if (win) finish(); // closed a moment ago and the timer has not seen it yet
      let w = null;
      try {
        w = host.open('', name, popoutFeatures(sizeKey ? readSize(storage, sizeKey) : null, host.screen));
      } catch { w = null; }
      if (!w || w.closed) {
        set({ blocked: true });
        return 'blocked';
      }
      win = w;
      size = null;
      set({ open: true, blocked: false });
      attach();
      pollId = setInterval(check, pollMs);
      try { w.focus(); } catch { /* */ }
      return 'opened';
    },

    /** Close the window (the portal goes back to the page). */
    close() {
      if (win) finish({ closeWindow: true });
    },

    /** Bring the open window to the front; false when there is none. */
    focus() {
      if (!win || win.closed) return false;
      try { win.focus(); } catch { /* */ }
      return true;
    },

    dismissBlocked() {
      if (state.blocked) set({ blocked: false });
    },

    /**
     * Tie the window to the page: when the page goes away (closed, reloaded,
     * navigated) the window closes with it; it could only show a dead copy.
     * Returns the function that unties it and closes the window, for an
     * effect's cleanup (leaving the party page within the app).
     */
    start() {
      const onHostHide = () => popout.close();
      host.addEventListener('pagehide', onHostHide);
      return () => {
        host.removeEventListener('pagehide', onHostHide);
        popout.close();
      };
    },
  };
  return popout;
}

/**
 * React binding: [state, popout] for a window that lives as long as the
 * calling component. See createPopout for both.
 */
export function usePopout({ name, title, sizeKey }) {
  const [popout] = useState(() => createPopout({
    name,
    sizeKey,
    prepare: (win) => preparePopoutDocument(win, { title, rootId: `${name}-root` }),
  }));
  const state = useSyncExternalStore(popout.subscribe, popout.getSnapshot, popout.getSnapshot);
  useEffect(() => popout.start(), [popout]);
  return [state, popout];
}
