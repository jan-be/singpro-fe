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

/** What canPopOut reads of the window (`window`, or a test's stand-in). */
export interface PopOutEnv {
  open?: unknown;
  navigator?: { userAgent?: string; maxTouchPoints?: number };
  matchMedia?: (query: string) => { matches: boolean };
}

/** A window's size, as remembered. */
export interface PopupSize {
  width: number;
  height: number;
}

/** What popoutFeatures reads of the screen. */
export interface PopupScreen {
  availWidth?: number;
  availHeight?: number;
}

/** What createPopout uses of the popup: a Window (in tests a stand-in). */
export interface PopupWindow {
  readonly closed: boolean;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly document: { readonly body: unknown; readonly readyState: string } | null;
  focus(): void;
  close(): void;
  addEventListener(type: 'pagehide', listener: () => void): void;
}

/** What createPopout uses of the page's window (`window`, or a test's stand-in). */
export interface PopupHost<W extends PopupWindow = Window> {
  open(url: string, target: string, features: string): W | null;
  readonly screen?: PopupScreen;
  readonly localStorage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

/** The element the popup's content is portalled into: one of the popup's document. */
export interface PopupContainer {
  readonly ownerDocument: unknown;
  readonly isConnected: boolean;
}

/** The popup's state (see createPopout). */
export interface PopoutState<C = HTMLDivElement> {
  open: boolean;
  container: C | null;
  blocked: boolean;
}

export interface PopoutOptions<W extends PopupWindow, C extends PopupContainer> {
  name: string;
  prepare(win: W): { container: C; dispose?: (() => void) | null };
  host?: PopupHost<W>;
  sizeKey?: string | null;
  pollMs?: number;
}

/** The popup's lifecycle (createPopout). */
export interface Popout<C = HTMLDivElement> {
  getSnapshot(): PopoutState<C>;
  subscribe(listener: () => void): () => void;
  open(): 'opened' | 'focused' | 'blocked';
  close(): void;
  focus(): boolean;
  dismissBlocked(): void;
  start(): () => void;
}

/**
 * Whether this device can put a second window next to the page. Phones,
 * tablets and TV browsers open a "window" as another tab, or not at all, so
 * the button would only take people away from the party there.
 */
export function canPopOut(env: PopOutEnv | undefined = typeof window !== 'undefined' ? window : undefined) {
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

export function popoutFeatures(saved: PopupSize | null | undefined, screen?: PopupScreen | null, fallback: PopupSize = { width: 480, height: 760 }) {
  const maxW = screen?.availWidth || Infinity;
  const maxH = screen?.availHeight || Infinity;
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
  const w = Number.isFinite(saved?.width) ? saved!.width : fallback.width;
  const h = Number.isFinite(saved?.height) ? saved!.height : fallback.height;
  return `popup,width=${clamp(w, MIN_WIDTH, maxW)},height=${clamp(h, MIN_HEIGHT, maxH)}`;
}

function readSize(storage: Pick<Storage, 'getItem'> | null, key: string): PopupSize | null {
  try {
    const v = JSON.parse(storage?.getItem(key) ?? 'null');
    return v && Number.isFinite(v.width) && Number.isFinite(v.height) ? v : null;
  } catch { return null; }
}

function writeSize(storage: Pick<Storage, 'setItem'> | null, key: string, size: PopupSize) {
  try { storage?.setItem(key, JSON.stringify(size)); } catch { /* private mode: forget it */ }
}

/** The window's document, or null once it went somewhere we may not read. */
const docOf = (win: PopupWindow) => { try { return win.document ?? null; } catch { return null; } };

/**
 * Stylesheets of `fromDoc` copied into `toDoc` and kept in step: Tailwind is
 * one sheet in production, but the dev server swaps style text on every edit
 * and a lazily loaded chunk can add a sheet. Returns a function that stops it.
 */
export function mirrorStyles(fromDoc: Document, toDoc: Document): () => void {
  const clones = new Map<Element, Element>();
  const sync = () => {
    for (const [orig, clone] of clones) {
      if (!orig.isConnected) { clone.remove(); clones.delete(orig); }
    }
    for (const orig of fromDoc.head.querySelectorAll('style, link[rel~="stylesheet"]')) {
      const clone = clones.get(orig);
      if (!clone) {
        const copy = toDoc.importNode(orig, true);
        if (orig.nodeName === 'LINK') (copy as HTMLLinkElement).href = (orig as HTMLLinkElement).href; // absolute: nothing to resolve against in about:blank
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
export function preparePopoutDocument(win: Window, { title = '', sourceDoc = document, rootId = 'popout-root' }: { title?: string; sourceDoc?: Document; rootId?: string } = {}) {
  const doc = win.document;
  // A window of that name still open from an earlier page holds its leftovers
  doc.head.textContent = '';
  doc.body.textContent = '';
  doc.documentElement.lang = sourceDoc.documentElement.lang || 'en';
  const viewport = doc.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  doc.head.appendChild(viewport);
  const icon = sourceDoc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
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
export function createPopout<C extends PopupContainer>(options: PopoutOptions<Window, C> & { host?: undefined }): Popout<C>;
export function createPopout<W extends PopupWindow, C extends PopupContainer>(options: PopoutOptions<W, C> & { host: PopupHost<W> }): Popout<C>;
export function createPopout({ name, prepare, host = window, sizeKey = null, pollMs = 250 }: PopoutOptions<PopupWindow, PopupContainer>): Popout<PopupContainer> {
  let win: PopupWindow | null = null;
  let container: PopupContainer | null = null;
  let dispose: (() => void) | null = null;
  let pollId: number | null = null;
  let size: PopupSize | null = null; // last seen inner size of the open window
  let state: PopoutState<PopupContainer> = { open: false, container: null, blocked: false };
  const listeners = new Set<() => void>();
  const storage = (() => { try { return host.localStorage ?? null; } catch { return null; } })();

  const set = (patch: Partial<PopoutState<PopupContainer>>) => {
    if ((Object.keys(patch) as (keyof typeof patch)[]).every(k => state[k] === patch[k])) return;
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  const detach = () => {
    try { dispose?.(); } catch { /* the document is already gone */ }
    dispose = null;
    container = null;
  };

  const attach = () => {
    const doc = docOf(win!);
    if (!doc?.body || doc.readyState === 'loading') return false; // not there yet: the next check tries again
    const built = prepare(win!);
    container = built.container;
    dispose = built.dispose ?? null;
    // Closing and reloading both start with pagehide: drop the portal at once
    win!.addEventListener('pagehide', onPopupHide);
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

  const popout: Popout<PopupContainer> = {
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
      let w: PopupWindow | null = null;
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
export function usePopout({ name, title, sizeKey }: { name: string; title?: string; sizeKey?: string | null }): [PopoutState<HTMLDivElement>, Popout<HTMLDivElement>] {
  const [popout] = useState(() => createPopout({
    name,
    sizeKey,
    prepare: (win) => preparePopoutDocument(win, { title, rootId: `${name}-root` }),
  }));
  const state = useSyncExternalStore(popout.subscribe, popout.getSnapshot, popout.getSnapshot);
  useEffect(() => popout.start(), [popout]);
  return [state, popout];
}
