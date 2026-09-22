// debugLog.js — the console a phone does not have. `?debug` (or ?debug=1)
// on any URL turns it on for this browser, `?debug=0` off; the choice lives
// in localStorage so it survives the join → party navigation. While on,
// page errors, unhandled rejections, console.error/warn and the notes the
// audio code leaves behind (a rejected play(), a stem that failed to decode)
// land in a ring buffer that DebugOverlay shows and copies to the clipboard.

const KEY = 'singpro_debug';
const MAX_ENTRIES = 200;

const entries = [];
const listeners = new Set();
let hooksInstalled = false;

/** Call once at startup: a ?debug= parameter updates the stored choice. */
export function syncDebugFlagFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('debug');
    if (v === null) return;
    if (v === '0' || v === 'false' || v === 'off') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, '1');
  } catch { /* */ }
}

export function isDebugEnabled() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** One line for the log: an Error by name and message, an object as JSON. */
export function formatValue(v) {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function debugLog(tag, ...args) { push('log', tag, args); }
export function debugError(tag, ...args) { push('error', tag, args); }

// A repeat of the last entry (a play() that keeps being refused every
// half second) counts up instead of pushing the useful lines out.
function push(level, tag, args) {
  const msg = args.map(formatValue).join(' ');
  const last = entries[entries.length - 1];
  if (last && last.level === level && last.tag === tag && last.msg === msg) {
    last.count += 1;
    last.time = Date.now();
  } else {
    entries.push({ time: Date.now(), level, tag, msg, count: 1 });
    if (entries.length > MAX_ENTRIES) entries.shift();
  }
  for (const fn of listeners) fn();
}

export function getDebugEntries() { return entries.slice(); }

export function clearDebugEntries() {
  entries.length = 0;
  for (const fn of listeners) fn();
}

/** Called after every change; returns the unsubscribe. */
export function subscribeDebug(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The log as text, oldest first, for the clipboard. */
export function formatDebugEntries(list = entries) {
  return list.map(e =>
    `${new Date(e.time).toISOString().slice(11, 23)} ${e.level === 'error' ? '!' : ' '} [${e.tag}] ${e.msg}${e.count > 1 ? ` ×${e.count}` : ''}`
  ).join('\n');
}

/** Route what the page would only have told a devtools console into the log. */
export function installDebugHooks() {
  if (hooksInstalled || typeof window === 'undefined') return;
  hooksInstalled = true;
  window.addEventListener('error', e => {
    const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '';
    debugError('window', `${e.message}${where}`);
  });
  window.addEventListener('unhandledrejection', e => debugError('promise', e.reason));
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      push(level === 'warn' ? 'log' : 'error', 'console', args);
    };
  }
}
