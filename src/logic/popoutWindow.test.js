import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canPopOut, popoutFeatures, createPopout } from './popoutWindow.js';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const env = ({ ua = CHROME_WIN, touch = 0, finePointer = true, open = () => null, matchMedia = true } = {}) => ({
  open,
  navigator: { userAgent: ua, maxTouchPoints: touch },
  ...(matchMedia ? { matchMedia: (q) => ({ matches: q === '(any-pointer: fine)' ? finePointer : false }) } : {}),
});

describe('canPopOut', () => {
  it('offers the window on a desktop browser with a mouse or trackpad', () => {
    expect(canPopOut(env())).toBe(true);
    expect(canPopOut(env({ ua: SAFARI_MAC }))).toBe(true);
  });

  it('hides it on phones, tablets and TV browsers, where a window is just another tab', () => {
    expect(canPopOut(env({ ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' }))).toBe(false);
    expect(canPopOut(env({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }))).toBe(false);
    expect(canPopOut(env({ ua: 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7285) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.0 like Chrome/112.0 Safari/537.36' }))).toBe(false);
    expect(canPopOut(env({ ua: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.0 TV Safari/537.36' }))).toBe(false);
  });

  it('sees through an iPad that asks for the desktop site', () => {
    expect(canPopOut(env({ ua: SAFARI_MAC, touch: 5 }))).toBe(false);
  });

  it('hides it on a touch-only screen', () => {
    expect(canPopOut(env({ finePointer: false }))).toBe(false);
  });

  it('goes by the user agent alone without media queries, and needs window.open', () => {
    expect(canPopOut(env({ matchMedia: false }))).toBe(true);
    expect(canPopOut({ navigator: { userAgent: CHROME_WIN } })).toBe(false);
    expect(canPopOut(undefined)).toBe(false);
  });
});

describe('popoutFeatures', () => {
  const screen = { availWidth: 1920, availHeight: 1040 };

  it('opens a popup of a laptop-friendly size by default', () => {
    expect(popoutFeatures(null, screen)).toBe('popup,width=480,height=760');
  });

  it('reopens at the size the window was left at, within the screen and a usable minimum', () => {
    expect(popoutFeatures({ width: 700, height: 900 }, screen)).toBe('popup,width=700,height=900');
    expect(popoutFeatures({ width: 4000, height: 3000 }, screen)).toBe('popup,width=1920,height=1040');
    expect(popoutFeatures({ width: 100, height: 100 }, screen)).toBe('popup,width=320,height=360');
  });
});

// --- The lifecycle, with fake windows ---

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};

const fakeDoc = () => ({ body: {}, readyState: 'complete' });

const fakePopup = () => {
  const win = new EventTarget();
  win.closed = false;
  win.innerWidth = 480;
  win.innerHeight = 760;
  win.document = fakeDoc();
  win.focus = vi.fn();
  win.close = vi.fn(() => { win.closed = true; });
  return win;
};

const fakeHost = (popup) => Object.assign(new EventTarget(), {
  open: vi.fn(() => popup),
  screen: { availWidth: 1920, availHeight: 1040 },
  localStorage: memoryStorage(),
});

// Builds a "document": the container belongs to the document it was made for
const fakePrepare = () => vi.fn((win) => {
  const doc = win.document;
  const container = { ownerDocument: doc, get isConnected() { return win.document === doc; } };
  return { container, dispose: vi.fn() };
});

describe('createPopout', () => {
  let popup, host, prepare, popout;

  beforeEach(() => {
    vi.useFakeTimers();
    popup = fakePopup();
    host = fakeHost(popup);
    prepare = fakePrepare();
    popout = createPopout({ name: 'singpro-queue', prepare, host, sizeKey: 'size' });
  });
  afterEach(() => vi.useRealTimers());

  it('opens a named blank window and hands out the container to render into', () => {
    const changes = vi.fn();
    popout.subscribe(changes);
    expect(popout.open()).toBe('opened');
    expect(host.open).toHaveBeenCalledWith('', 'singpro-queue', 'popup,width=480,height=760');
    expect(prepare).toHaveBeenCalledWith(popup);
    const s = popout.getSnapshot();
    expect(s.open).toBe(true);
    expect(s.blocked).toBe(false);
    expect(s.container.ownerDocument).toBe(popup.document);
    expect(changes).toHaveBeenCalled();
  });

  it('brings the open window to the front instead of opening a second one', () => {
    popout.open();
    popup.focus.mockClear();
    expect(popout.open()).toBe('focused');
    expect(host.open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(popout.focus()).toBe(true);
  });

  it('says so when the browser blocks the window, and forgets it on the next success', () => {
    host.open.mockReturnValueOnce(null);
    expect(popout.open()).toBe('blocked');
    expect(popout.getSnapshot()).toMatchObject({ open: false, blocked: true, container: null });
    expect(popout.focus()).toBe(false);
    expect(popout.open()).toBe('opened');
    expect(popout.getSnapshot().blocked).toBe(false);
  });

  it('treats a window that is closed at once as blocked', () => {
    host.open.mockReturnValueOnce({ closed: true });
    expect(popout.open()).toBe('blocked');
  });

  it('drops the portal when the user closes the window, and notices it is gone', () => {
    popout.open();
    popup.dispatchEvent(new Event('pagehide'));
    expect(popout.getSnapshot().container).toBe(null); // at once: the document is going away
    popup.closed = true;
    vi.advanceTimersByTime(100);
    expect(popout.getSnapshot()).toMatchObject({ open: false, container: null });
  });

  it('notices a closed window by polling even without pagehide', () => {
    popout.open();
    popup.closed = true;
    vi.advanceTimersByTime(300);
    expect(popout.getSnapshot().open).toBe(false);
  });

  it('rebuilds the document after the window was reloaded', () => {
    popout.open();
    const first = popout.getSnapshot().container;
    popup.dispatchEvent(new Event('pagehide'));
    popup.document = { body: null, readyState: 'loading' }; // the reload is under way
    vi.advanceTimersByTime(60);
    expect(popout.getSnapshot()).toMatchObject({ open: true, container: null });
    popup.document = fakeDoc(); // the new blank document is there
    vi.advanceTimersByTime(300);
    const again = popout.getSnapshot().container;
    expect(again).not.toBe(null);
    expect(again).not.toBe(first);
    expect(again.ownerDocument).toBe(popup.document);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('rebuilds even when the reload was not announced with pagehide', () => {
    popout.open();
    popup.document = fakeDoc();
    vi.advanceTimersByTime(300);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(popout.getSnapshot().container.ownerDocument).toBe(popup.document);
  });

  it('lets a window go that navigated somewhere it cannot read', () => {
    popout.open();
    Object.defineProperty(popup, 'document', { get() { throw new Error('SecurityError'); } });
    vi.advanceTimersByTime(300);
    expect(popout.getSnapshot().open).toBe(false);
    expect(popup.close).toHaveBeenCalled();
  });

  it('closes the window when the page goes away', () => {
    const stop = popout.start();
    popout.open();
    host.dispatchEvent(new Event('pagehide'));
    expect(popup.close).toHaveBeenCalled();
    expect(popout.getSnapshot()).toMatchObject({ open: false, container: null });
    stop();
  });

  it('closes the window when the page component unmounts, and lets go of the page', () => {
    const stop = popout.start();
    popout.open();
    stop();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popout.getSnapshot().open).toBe(false);
    // no longer tied to the page
    const second = fakePopup();
    host.open.mockReturnValueOnce(second);
    popout.open();
    host.dispatchEvent(new Event('pagehide'));
    expect(second.close).not.toHaveBeenCalled();
  });

  it('close() releases the document it built', () => {
    popout.open();
    const { dispose } = prepare.mock.results[0].value;
    popout.close();
    expect(dispose).toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
    expect(popout.getSnapshot().open).toBe(false);
  });

  it('opens a new window after the old one was closed, even before the poll saw it', () => {
    popout.open();
    popup.closed = true;
    const second = fakePopup();
    host.open.mockReturnValueOnce(second);
    expect(popout.open()).toBe('opened');
    expect(popout.getSnapshot().container.ownerDocument).toBe(second.document);
  });

  it('remembers the size the window was left at', () => {
    popout.open();
    popup.innerWidth = 820;
    popup.innerHeight = 600;
    vi.advanceTimersByTime(300);
    popup.closed = true;
    vi.advanceTimersByTime(300);
    const second = fakePopup();
    host.open.mockReturnValueOnce(second);
    popout.open();
    expect(host.open).toHaveBeenLastCalledWith('', 'singpro-queue', 'popup,width=820,height=600');
  });
});
