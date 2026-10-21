import { describe, it, expect, beforeEach } from 'vitest';
import {
  syncDebugFlagFromUrl, isDebugEnabled, formatValue,
  debugLog, debugError, getDebugEntries, clearDebugEntries, subscribeDebug, formatDebugEntries,
} from './debugLog';

// vitest runs in node: minimal localStorage and window.location stand-ins
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: unknown) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  } as unknown as Storage;
  globalThis.window = { location: { search: '' } } as unknown as Window & typeof globalThis;
  clearDebugEntries();
});

describe('debug flag', () => {
  it('is off until ?debug, and ?debug=0 turns it off again', () => {
    expect(isDebugEnabled()).toBe(false);
    syncDebugFlagFromUrl();
    expect(isDebugEnabled()).toBe(false);
    window.location.search = '?debug';
    syncDebugFlagFromUrl();
    expect(isDebugEnabled()).toBe(true);
    window.location.search = '?song=x';
    syncDebugFlagFromUrl();
    expect(isDebugEnabled()).toBe(true); // no parameter: unchanged
    window.location.search = '?debug=0';
    syncDebugFlagFromUrl();
    expect(isDebugEnabled()).toBe(false);
  });
});

describe('debug log', () => {
  it('formats errors, strings and objects on one line', () => {
    expect(formatValue(new TypeError('boom'))).toBe('TypeError: boom');
    expect(formatValue('plain')).toBe('plain');
    expect(formatValue({ code: 4 })).toBe('{"code":4}');
    expect(formatValue(undefined)).toBe('undefined');
  });

  it('collapses a repeated entry into a count and notifies subscribers', () => {
    let calls = 0;
    const unsubscribe = subscribeDebug(() => { calls += 1; });
    const err = new DOMException('not allowed', 'NotAllowedError');
    debugLog('stems', 'play() rejected:', err);
    debugLog('stems', 'play() rejected:', err);
    debugError('stems', 'karaoke failed: code 4');
    unsubscribe();
    const list = getDebugEntries();
    expect(list.map(e => [e.level, e.tag, e.msg, e.count])).toEqual([
      ['log', 'stems', 'play() rejected: NotAllowedError: not allowed', 2],
      ['error', 'stems', 'karaoke failed: code 4', 1],
    ]);
    expect(calls).toBe(3);
    const text = formatDebugEntries();
    expect(text).toMatch(/^\d\d:\d\d:\d\d\.\d\d\d {3}\[stems\] play\(\) rejected: NotAllowedError: not allowed ×2\n/);
    expect(text).toMatch(/\n\d\d:\d\d:\d\d\.\d\d\d ! \[stems\] karaoke failed: code 4$/);
  });

  it('keeps the newest 200 entries', () => {
    for (let i = 0; i < 250; i++) debugLog('n', String(i));
    const list = getDebugEntries();
    expect(list).toHaveLength(200);
    expect(list[0].msg).toBe('50');
    expect(list[199].msg).toBe('249');
  });
});
